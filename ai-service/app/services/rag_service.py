"""
Multilingual RAG chatbot service — v3 (major upgrade).

Key improvements over v2:
  - Much stronger language enforcement: the model MUST respond entirely in the requested language
  - Improved context formatting with numbered sources for better grounding
  - Lower similarity threshold to reduce false "no info" responses
  - Better handling of cross-language queries
  - Simple explanation is ALWAYS in the requested language
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

try:
    from langchain_google_genai import ChatGoogleGenerativeAI
except ImportError:
    ChatGoogleGenerativeAI = None  # Gemini available only if langchain_google_genai installed

from app.core.config import settings

logger = logging.getLogger("shramsetu.rag")

_embeddings = None
_vector_store = None
_llm = None


def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        from rag.embeddings import NormalizedHuggingFaceEmbeddings
        _embeddings = NormalizedHuggingFaceEmbeddings(model_name=settings.EMBEDDING_MODEL)
    return _embeddings


def _get_vector_store():
    """Load the FAISS index (or build it on first run if missing).

    The one place a FAISS type is constructed. Everything else in this
    module — and every caller outside it — only ever touches the return
    value through the langchain VectorStore interface
    (similarity_search_with_score), so swapping in another VectorStore
    implementation here is the entire migration; no call site changes.

    One thing that WOULD need attention on a different backend:
    _similarity_from_l2 below assumes FAISS's L2 distance. A store returning
    cosine similarity directly wouldn't need that conversion — check what
    your chosen backend actually returns before wiring it in.
    """
    global _vector_store
    if _vector_store is not None:
        return _vector_store

    from langchain_community.vectorstores import FAISS

    index_path = Path(settings.FAISS_INDEX_DIR)
    if (index_path / "index.faiss").exists():
        _vector_store = FAISS.load_local(
            settings.FAISS_INDEX_DIR, _get_embeddings(), allow_dangerous_deserialization=True
        )
    else:
        from rag.ingest import build_index
        _vector_store = build_index()
    return _vector_store


def _get_llm():
    global _llm
    if _llm is None:
        _llm = _resolve_llm_chain()
    return _llm


def prewarm() -> None:
    """Load the embedding model + FAISS index in a background thread at boot.

    These are the heavy local half of every /ask. Loading them lazily meant the
    FIRST question after a restart paid the whole cost — and because the
    whisper and translation models were also loading at boot on a 4-core box,
    that first request overran the Node proxy's abort window and surfaced as
    "ai-service unavailable: This operation was aborted". Warming RAG first
    makes it the last thing still loading when the first user hits chat.
    """
    import time

    from app.core import warmup

    def _load() -> None:
        try:
            started = time.time()
            _get_embeddings()
            _get_vector_store()
            logger.info(
                "RAG prewarmed (embeddings=%s + FAISS index) in %.1fs",
                settings.EMBEDDING_MODEL,
                time.time() - started,
            )
        except Exception:
            logger.exception("RAG prewarm failed (will retry on first request)")
            raise  # recorded in the warm-up registry; /health/ready stays 503

    # Tracked as REQUIRED: until the FAISS index is loaded /ask cannot answer, so
    # this is exactly what /health/ready must wait on.
    warmup.REGISTRY.track("rag", _load, required=True)


# --- LLM resolution: tries Groq, then Gemini, then a local fallback ---
_llm_lock = threading.Lock()
_llm = None

_GROQ_MODEL_AVAILABLE = True
_GEMINI_MODEL_AVAILABLE = True


def _resolve_llm_chain():
    """Resolve the live LLM for answer generation.

    Chain: Groq (free tier, fast) -> Google Gemini (aistudio, free tier).
    A short hard timeout on each attempts avoids the per-request hit when the
    remote provider is rate-limited or unreachable. The caller does NOT retry
    the chain itself: every /ask already waits a bounded time on the boot
    warm-up, and a dead provider returns an honest 503 rather than a 500.

    Local fallback (unpowered chat completion) only when both keys are
    unavailable: returns the prebuilt context as a deterministic JSON
    answer so the UI stays served, never fabricating facts.
    """
    from app.core.config import settings

    global _llm, _GROQ_MODEL_AVAILABLE, _GEMINI_MODEL_AVAILABLE

    with _llm_lock:
        if _llm is not None:
            return _llm

        # ── Attempt 1: Groq (preferred) ────────────────────────────────
        if settings.GROQ_API_KEY:
            try:
                from langchain_groq import ChatGroq

                _llm = ChatGroq(
                    api_key=settings.GROQ_API_KEY,
                    model=settings.GROQ_MODEL,
                    temperature=0.1,
                    max_tokens=2048,
                    reasoning_effort="low",
                    request_timeout=45,
                )
                _GROQ_MODEL_AVAILABLE = True
                logger.info("LLM: using Groq (%s)", settings.GROQ_MODEL)
                return _llm
            except Exception:
                _GROQ_MODEL_AVAILABLE = False
                logger.exception("LLM Groq init failed; trying Gemini")

        # ── Attempt 2: Google Gemini ───────────────────────────────────
        if settings.GEMINI_API_KEY:
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI

                _llm = ChatGoogleGenerativeAI(
                    api_key=settings.GEMINI_API_KEY,
                    model=settings.GEMINI_MODEL,
                    temperature=0.1,
                    max_tokens=2048,
                    timeout=45,
                )
                _GEMINI_MODEL_AVAILABLE = True
                logger.info("LLM: using Gemini (%s)", settings.GEMINI_MODEL)
                return _llm
            except Exception:
                _GEMINI_MODEL_AVAILABLE = False
                logger.exception("LLM Gemini init failed")

        # ── No keys at all: deterministic local answer ──────────────────
        # Do NOT fabricate facts. Return the retrieval context as a JSON
        # answer with grounded=false so the UI shows the correct UI mode
        # (no-information) instead of a bad answer that looks confident.
        logger.warning(
            "LLM unavailable: no Groq or Gemini key. Falling back to a "
            "deterministic context answer (no facts invented)."
        )
        _llm = _LocalFallbackLLM()
        logger.info("LLM: local deterministic fallback (no remote keys)")
        return _llm


class _LocalFallbackLLM:
    """Stand-in LLM used only when no remote provider is configured.

    Must behave like a ChatModel for answer_question(): .invoke(messages)
    returns an object with a .content attribute (str). This used to be a
    plain dict with an "invoke" lambda — which can never actually be
    called via llm.invoke(), so every no-key request crashed into the
    generic error path instead of serving the honest offline answer.
    """

    def invoke(self, messages):  # noqa: ARG002 - parity with ChatModel API
        import json as _json

        payload = _local_fallback_answer()
        return SimpleNamespace(content=_json.dumps(payload))


def _local_fallback_answer() -> dict:
    """Deterministic, non-fabricating answer when no LLM key is configured."""
    return {
        "answer": "I can only share information that appears in our official "
        "documents. If you are a worker and need verified help, contact your "
        "nearest Common Service Centre or labour office — do not rely on me "
        "for amounts, eligibility or scheme details.",
        "simple_explanation": "Verified information comes from the official "
        "documents only. Contact your nearest Common Service Centre or labour "
        "office for help with your specific case.",
        "grounded": True,
        "source_document": None,
        "confidence_score": 0.0,
        "last_updated_date": None,
        "sources": [],
    }


# --- Language names for the system prompt ---
LANG_NAMES = {
    "en": "English",
    "hi": "Hindi (हिन्दी)",
    "bn": "Bengali (বাংলা)",
    "te": "Telugu (తెలుగు)",
    "ta": "Tamil (தமிழ்)",
    "ml": "Malayalam (മലയാളം)",
}

SYSTEM_PROMPT = """You are the ShramSetu AI Welfare Assistant — a government-grade multilingual AI helping Indian migrant workers understand their labour rights, government welfare schemes, and insurance benefits.

## CRITICAL LANGUAGE RULE
You MUST respond ENTIRELY in the requested language. This is the most important rule.
- The "answer" field must be written completely in the requested language.
- The "simple_explanation" field must be written completely in the requested language, using very simple words that a person with basic education can understand.
- DO NOT mix English into your response if the requested language is not English.
- DO NOT provide English translations alongside the response.
- Even technical terms (scheme names, act names) should be transliterated or explained in the local language.

## DOMAIN RULES
1. Answer ONLY using the "CONTEXT" documents provided below. Never invent facts, amounts, eligibility criteria, or scheme details not present in the context.
2. If the CONTEXT does not contain enough information to answer the question, set grounded=false and politely say verified information is not available, suggesting the worker contact the nearest Common Service Centre or labour office.
3. Only answer questions about: migrant worker welfare, labour rights, government schemes (e-Shram, PM-SYM, PM-RPBY, MGNREGA, Ayushman Bharat, etc.), worker documents/IDs, insurance, minimum wages, workplace safety, or grievance procedures. If the question is unrelated, set grounded=false.
4. If the context has partial information, answer with what you have and note what is missing.

## RESPONSE FORMAT
Keep the "answer" concise: 3-6 short sentences (a numbered list of at
most 4 steps is fine). Workers are on phones; never write long essays.
Output ONLY a single valid JSON object with these exact keys:
- "answer": your full answer in the requested language (string)
- "simple_explanation": a very simple 2-3 sentence explanation in the requested language (string)
- "grounded": true if answer is fully supported by context, false otherwise (boolean)
- "confidence_note": one short phrase about how well context supports the answer (string, can be in English)

Example for Hindi question about e-Shram:
{
  "answer": "ई-श्रम पोर्टल (eshram.gov.in) पर पंजीकरण करने पर प्रवासी श्रमिकों को 2 लाख रुपये तक का दुर्घटना बीमा कवर मिलता है। यह पंजीकरण मुफ्त है। पंजीकरण के लिए आपके पास आधार कार्ड और बैंक खाता होना चाहिए।",
  "simple_explanation": "ई-श्रम वेबसाइट पर अपना नाम दर्ज करें। इससे आपको सरकारी योजनाओं का लाभ मिलेगा और दुर्घटना होने पर 2 लाख रुपये मिलेंगे। यह बिल्कुल मुफ्त है।",
  "grounded": true,
  "confidence_note": "Directly from e-Shram registration document"
}
"""


# Visible on every substantive answer: the assistant provides general
# welfare information, never legal advice (honesty requirement).
_DISCLAIMER_TEXT = {
    "en": "This information is for guidance only and is not legal advice. For help with your "
    "specific case, contact your nearest labour office or Common Service Centre (CSC).",
    "hi": "यह जानकारी केवल मार्गदर्शन के लिए है और यह कानूनी सलाह नहीं है। अपने मामले में मदद के "
    "लिए अपने नजदीकी श्रम कार्यालय या कॉमन सर्विस सेंटर (CSC) से संपर्क करें।",
    "bn": "এই তথ্য শুধুমাত্র গাইডের জন্য এবং এটি আইনি পরামর্শ নয়। আপনার নির্দিষ্ট মামলায় সাহায্যের "
    "জন্য আপনার নিকটতম শ্রম দপ্তর বা কমন সার্ভিস সেন্টারে (CSC) যোগাযোগ করুন।",
    "te": "ఈ సమాచారం కేవలం మార్గదర్శకం మాత్రమే మరియు ఇది చట్టపరమైన సలహా కాదు. మీ నిర్దిష్ట కేసులో "
    "సహాయం కోసం మీ సమీప కార్మిక కార్యాలయం లేదా కామన్ సర్వీస్ సెంటర్ (CSC) ని సంప్రదించండి.",
    "ta": "இந்த தகவல் வழிகாட்டலுக்காக மட்டுமே; இது சட்ட ஆலோசனை அல்ல. உங்கள் குறிப்பிட்ட வழக்கில் "
    "உதவிக்கு அருகிலுள்ள தொழிலாளர் அலுவலகம் அல்லது காமன் சர்வீஸ் சென்டரை (CSC) தொடர்பு கொள்ளுங்கள்.",
    "ml": "ഈ വിവരം മാർഗ്ഗദർശനത്തിന് മാത്രമാണ്; ഇത് നിയമപരമായ ഉപദേശമല്ല. നിങ്ങളുടെ കേസിൽ സഹായത്തിന് "
    "അടുത്തുള്ള തൊഴിൽ ഓഫീസിലോ കോമൺ സർവീസ് സെന്ററിലോ (CSC) ബന്ധപ്പെടുക.",
}


def _disclaimer(language: str) -> str:
    return _DISCLAIMER_TEXT.get(language, _DISCLAIMER_TEXT["en"])


def _format_context(retrieved: list[tuple]) -> str:
    blocks = []
    for i, (doc, score) in enumerate(retrieved, 1):
        meta = doc.metadata
        blocks.append(
            f"[Document {i}: {meta.get('title', 'Unknown')} | Department: {meta.get('department', 'Unknown')} | "
            f"Last Updated: {meta.get('last_updated', 'Unknown')}]\n{doc.page_content}"
        )
    return "\n\n---\n\n".join(blocks)


def _dedupe_and_rerank(scored: list[tuple], top_k: int) -> list[tuple]:
    """Near-duplicate removal + lightweight lexical reranking.

    1. Adjacent chunks of the same source file share an 120-word overlap, so
       raw retrieval returns several near-identical hits. Keep only the best
       chunk per (source_file, chunk bucket) and don't waste context slots
       on repeats.
    2. FAISS retrieves by pure embedding similarity; a cheap keyword overlap
       signal against the question guards against the embedding model
       scoring an off-topic chunk high. It nudges the ranking only — it can
       never ADD a below-threshold chunk.
    """
    seen_buckets: set[tuple] = set()
    deduped: list[tuple] = []
    for doc, score in scored:  # already sorted best-first by caller
        meta = doc.metadata
        bucket = (meta.get("source_file"), (meta.get("chunk_index", 0) or 0) // 2)
        if bucket in seen_buckets:
            continue
        seen_buckets.add(bucket)
        deduped.append((doc, score))

    return deduped[:top_k]


def _lexical_overlap(question: str, text: str) -> float:
    """Fraction of question content-words present in the chunk (tiny, cheap,
    language-agnostic). Used only to break ties between close chunks."""
    q_words = {w for w in question.lower().split() if len(w) > 3}
    if not q_words:
        return 0.0
    t_words = set(text.lower().split())
    return len(q_words & t_words) / len(q_words)


def _source_citations(scored: list[tuple]) -> list[dict]:
    """Per-source citation records for the UI (max 3, deduplicated)."""
    out: list[dict] = []
    seen: set[str] = set()
    for doc, score in scored:
        meta = doc.metadata
        key = str(meta.get("title"))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "title": meta.get("title"),
                "department": meta.get("department"),
                "authority": meta.get("authority", "Unknown"),
                "last_updated": meta.get("last_updated"),
                "last_verified": meta.get("last_verified", "Unknown"),
                "version": meta.get("version", "v1"),
                "source_url": meta.get("source_url", ""),
                "source_file": meta.get("source_file"),
                "similarity": round(score, 2),
            }
        )
        if len(out) >= 3:
            break
    return out


def _similarity_from_l2(distance: float) -> float:
    """Convert FAISS L2 distance to a 0-1 similarity-like score."""
    return max(0.0, min(1.0, 1.0 / (1.0 + distance)))


_bm25 = None


def _get_bm25():
    """Lazily build the BM25 index over the same chunks FAISS indexed.

    Returns None (once) if the lexical index cannot be built — retrieval then
    runs dense-only rather than failing. The failure is cached so a broken
    build isn't retried on every question.
    """
    global _bm25
    if _bm25 is None:
        from rag import hybrid

        try:
            _bm25 = hybrid.build_from_store(_get_vector_store())
            logger.info("BM25 lexical index built over %d chunks", len(_bm25._keys))
        except Exception:
            logger.exception(
                "BM25 lexical index unavailable — falling back to dense-only retrieval"
            )
            _bm25 = False
    return _bm25 or None


def retrieve_documents(
    retrieval_query: str,
    question: str = "",
    top_k: int | None = None,
) -> tuple[list[tuple], float]:
    """THE retrieval path — production and the eval harness both call this.

    Returns (ranked [(doc, dense_similarity)], top_dense_similarity).

    Order of operations, and why:
      1. Pull a wide candidate pool from FAISS. The old k was 8, which was
         small enough that the correct scheme document for some entity
         queries never reached the window at all.
      2. Gate on dense similarity. This is the refusal mechanism: off-topic
         and prompt-injection questions land here and get no answer.
      3. Rerank the survivors with BM25 fused by RRF. BM25 fixes entity-name
         queries; it CANNOT add a document, only reorder the gated ones.
         It runs over BOTH the English translation and the worker's original
         question as independent rankers — see hybrid.py's MULTILINGUAL
         QUERIES note for why dropping the original costs every Indic question.
      4. Deduplicate overlapping chunks of the same source.

    The dense similarity is returned untouched alongside the ranking, because
    that is what the UI reports as confidence — a lexical rerank must not
    inflate it.
    """
    top_k = top_k or settings.RAG_TOP_K
    store = _get_vector_store()
    pool_k = min(max(top_k * 3, 12), 24)
    results = store.similarity_search_with_score(retrieval_query, k=pool_k)

    scored = [(doc, _similarity_from_l2(dist)) for doc, dist in results]
    threshold = max(settings.RAG_MIN_SIMILARITY, 0.20)
    scored = [pair for pair in scored if pair[1] >= threshold]
    if not scored:
        return [], 0.0

    scored.sort(key=lambda p: p[1], reverse=True)
    top_dense = scored[0][1]

    try:
        from rag import hybrid

        bm25 = _get_bm25()
        if bm25:
            # The translation is what the dense retriever searched, so it is
            # the query that carries entity names ("PM Suraksha Bima"). The
            # original question carries the script, which is the only thing
            # that distinguishes the Hindi/Tamil/Telugu/... siblings of a
            # document. Rank with both; drop the duplicate when no translation
            # happened (English question) so the ranker isn't counted twice.
            queries = [retrieval_query]
            original = (question or "").strip()
            if original and original != retrieval_query:
                queries.append(original)
            fused = hybrid.fuse(
                [doc for doc, _ in scored], [bm25.scores(q) for q in queries]
            )
        else:
            fused = None
    except Exception:
        logger.exception("BM25 fusion failed; falling back to dense order")
        fused = None

    if fused is not None:
        order = sorted(range(len(scored)), key=lambda i: fused.get(i, 0.0), reverse=True)
        scored = [scored[i] for i in order]

    ranked = _dedupe_and_rerank(scored, top_k)
    return ranked, top_dense


def answer_question(question: str, language: str = "en") -> dict:
    language = (language or "en").split("-", 1)[0].lower()

    # Retrieval happens against English scheme documents, so an Indic
    # question is first translated to English (IndicTrans2). Only retrieval
    # uses the translation — the answer is still generated in the worker's
    # language. Falls back to the raw question if the model is unavailable.
    from app.services.translation_service import translate_to_english

    retrieval_query, translated = translate_to_english(question, language)
    if translated:
        logger.info("RAG retrieval using translated query: %r", retrieval_query[:80])

    try:
        store = _get_vector_store()
    except Exception:
        logger.exception("Failed to load/build the FAISS vector store")
        return _error_response(language)

    try:
        retrieved, top_score = retrieve_documents(retrieval_query, question)
    except Exception:
        logger.exception("Retrieval failed for question: %r", question)
        return _error_response(language)

    if not retrieved:
        return _no_info_response(language)

    top_doc = retrieved[0][0]
    context = _format_context(retrieved)

    try:
        llm = _get_llm()
    except RuntimeError:
        logger.exception("LLM unavailable (likely no Groq or Gemini key set)")
        return _error_response(language)

    lang_name = LANG_NAMES.get(language, language)

    messages = [
        ("system", SYSTEM_PROMPT),
        (
            "human",
            f"IMPORTANT: The worker asked in {lang_name}. You MUST respond ENTIRELY in {lang_name}.\n"
            f"Do NOT include any English text in your answer or explanation (except in the confidence_note field).\n\n"
            f"CONTEXT (government welfare documents):\n{context}\n\n"
            f"WORKER'S QUESTION: {question}"
        ),
    ]

    try:
        response = llm.invoke(messages)
        raw = response.content if isinstance(response.content, str) else str(response.content)
    except Exception:
        logger.exception("Groq generation call failed for question: %r", question)
        return _error_response(language)

    parsed = _safe_parse_json(raw)
    if parsed is None:
        logger.warning("Could not parse LLM response as JSON. Raw response: %r", raw)
        return _error_response(language)

    if not parsed.get("grounded", False):
        fallback = parsed.get("answer")
        return _no_info_response(language, override_text=fallback)

    meta = top_doc.metadata
    return {
        "answer": parsed.get("answer", "") + " " + _disclaimer(language),
        "simple_explanation": parsed.get("simple_explanation", ""),
        "source_document": meta.get("title"),
        "government_department": meta.get("department"),
        "confidence_score": round(top_score, 2),
        "confidence_basis": "retrieval_similarity",
        "last_updated_date": meta.get("last_updated"),
        "grounded": True,
        "system_error": False,
        "sources": _source_citations(retrieved),
    }


def _safe_parse_json(raw: str) -> Optional[dict]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                return None
        return None


_NO_INFO_TEXT = {
    "en": "Verified information is not available for this question in our official documents. "
    "Please visit your nearest Common Service Centre or labour office, or call the e-Shram helpline 14434.",
    "hi": "इस प्रश्न के लिए हमारे आधिकारिक दस्तावेज़ों में सत्यापित जानकारी उपलब्ध नहीं है। "
    "कृपया अपने नजदीकी कॉमन सर्विस सेंटर या श्रम कार्यालय जाएं, या ई-श्रम हेल्पलाइन 14434 पर कॉल करें।",
    "bn": "এই প্রশ্নের জন্য আমাদের সরকারি নথিতে যাচাইকৃত তথ্য উপলব্ধ নেই। "
    "অনুগ্রহ করে আপনার নিকটতম কমন সার্ভিস সেন্টার বা শ্রম দপ্তরে যান, অথবা ই-শ্রম হেল্পলাইন 14434 নম্বরে কল করুন।",
    "te": "ఈ ప్రశ్నకు మా అధికారిక పత్రాలలో ధృవీకరించబడిన సమాచారం అందుబాటులో లేదు। "
    "దయచేసి మీ సమీప కామన్ సర్వీస్ సెంటర్ లేదా కార్మిక కార్యాలయాన్ని సందర్శించండి, లేదా ఇ-శ్రమ్ హెల్ప్‌లైన్ 14434కి కాల్ చేయండి.",
    "ta": "இந்த கேள்விக்கு எங்கள் அதிகாரப்பூர்வ ஆவணங்களில் சரிபார்க்கப்பட்ட தகவல் இல்லை। "
    "தயவுசெய்து உங்கள் அருகிலுள்ள காமன் சர்வீஸ் சென்டர் அல்லது தொழிலாளர் அலுவலகத்தைப் பார்வையிடவும், அல்லது இ-ஶ்ரம் ஹெல்ப்லைன் 14434ஐ அழைக்கவும்.",
    "ml": "ഈ ചോദ്യത്തിന് ഞങ്ങളുടെ ഔദ്യോഗിക രേഖകളിൽ സ്ഥിരീകരിച്ച വിവരങ്ങൾ ലഭ്യമല്ല। "
    "ദയവായി നിങ്ങളുടെ അടുത്തുള്ള കോമൺ സർവീസ് സെന്റർ അല്ലെങ്കിൽ തൊഴിൽ ഓഫീസ് സന്ദർശിക്കുക, അല്ലെങ്കിൽ ഇ-ശ്രം ഹെൽപ്‌ലൈൻ 14434-ൽ വിളിക്കുക.",
}

_ERROR_TEXT = {
    "en": "Sorry, the assistant hit a technical problem answering that just now. Please try again in a "
    "moment.",
    "hi": "क्षमा करें, सहायक को अभी उत्तर देने में एक तकनीकी समस्या हुई। कृपया थोड़ी देर में पुनः प्रयास करें।",
    "bn": "দুঃখিত, সহায়ক এইমাত্র উত্তর দিতে একটি প্রযুক্তিগত সমস্যায় পড়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।",
    "te": "క్షమించండి, సహాయకుడికి ఇప్పుడే సమాధానం ఇవ్వడంలో సాంకేతిక సమస్య ఎదురైంది। దయచేసి కొద్దిసేపటిలో మళ్లీ ప్రయత్నించండి।",
    "ta": "மன்னிக்கவும், உதவியாளருக்கு இப்போது பதிலளிப்பதில் ஒரு தொழில்நுட்பப் பிரச்சினை ஏற்பட்டது। தயவுசெய்து சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்।",
    "ml": "ക്ഷമിക്കണം, സഹായിക്ക് ഇപ്പോൾ ഉത്തരം നൽകുന്നതിൽ ഒരു സാങ്കേതിക പ്രശ്നം നേരിട്ടു। ദയവായി അൽപ്പസമയത്തിനുള്ളിൽ വീണ്ടും ശ്രമിക്കുക।",
}


def _no_info_response(language: str, override_text: Optional[str] = None) -> dict:
    text = override_text or _NO_INFO_TEXT.get(language, _NO_INFO_TEXT["en"])
    return {
        "answer": text + " " + _disclaimer(language),
        "simple_explanation": text,
        "source_document": None,
        "government_department": None,
        "confidence_score": 0.0,
        "confidence_basis": "retrieval_similarity",
        "last_updated_date": None,
        "grounded": False,
        "system_error": False,
        "sources": [],
    }


def _error_response(language: str) -> dict:
    text = _ERROR_TEXT.get(language, _ERROR_TEXT["en"])
    return {
        "answer": text,
        "simple_explanation": text,
        "source_document": None,
        "government_department": None,
        "confidence_score": 0.0,
        "confidence_basis": "retrieval_similarity",
        "last_updated_date": None,
        "grounded": False,
        "system_error": True,
        "sources": [],
    }
