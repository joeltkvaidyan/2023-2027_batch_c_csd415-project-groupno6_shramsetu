"""ShramSetu AI service configuration.
All values are overridable via environment variables / .env file.

This microservice owns ONLY the AI stack: RAG (FAISS + SentenceTransformers
+ Groq), speech-to-text (faster-whisper) and text-to-speech (local Meta MMS
VITS). Auth, OTP, database, uploads and all CRUD live in the Node.js server
(shramsetu/server) which calls this service over HTTP.
"""

from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- App ---
    APP_NAME: str = "ShramSetu"
    ENV: str = "development"
    DEBUG: bool = True

    # --- Service-to-service auth ---
    # When set, every request except GET /health must carry the matching
    # X-Internal-Key header (the Node server sends it from AI_INTERNAL_KEY).
    # Leave empty only for throwaway local debugging.
    AI_INTERNAL_KEY: str
    # Per-IP request cap per minute (simple in-memory limiter; adequate for
    # the single-instance demo deployment).
    AI_RATE_LIMIT_PER_MIN: int = 120
    # Shared Redis rate-limit store (multi-container). Empty = per-process.
    REDIS_URL: str = ""

    # --- Groq (LLM provider for RAG chatbot) ---
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    # Gemini (Google) — automatic fallback when Groq is exhausted or rate-limited.
    # Get a free key at aistudio.google.com. One per-project key covers only
    # Gemini 2.0 flash; the code below switches the right model per provider.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"

    # --- OpenRouter (optional cloud STT/TTS proxy) ---
    # Optional: substitute for a direct cloud STT/TTS call. OpenRouter proxies
    # Groq + OpenAI + dozens of Whisper/TTS repos behind ONE key, and its
    # model ids (whisper-small, tts-1, etc.) match the Hugging Face repo ids
    # faster-whisper/transformers accept, so no SDK swap is needed.
    # Without it the service uses the local model or Groq's Whisper as the
    # cloud fallback. Get a free key at openrouter.ai/keys.
    OPENROUTER_API_KEY: str = ""
    # OpenRouter model ids. Whisper stays local-first; these are only used when
    # the local fine-tuned checkpoints are not configured / fail to load.
    OPENROUTER_WHISPER_MODEL: str = "whisper-small"  # or whisper-large-v3-turbo, gpt-4o-mini-tts
    OPENROUTER_TTS_MODEL: str = "gpt-4o-mini-tts"   # voice synthesis over OpenRouter

    # --- Google Cloud Translation (optional, fastest query-translation) ---
    # Plain API key (enable the Cloud Translation API). Falls back to
    # GOOGLE_API_KEY if unset; when neither is set the local IndicTrans2 /
    # NLLB engines are used. Free tier: 500k chars/month.
    GOOGLE_TRANSLATE_API_KEY: str = ""
    # Shared Google key used as the fallback when the dedicated Translate key
    # is unset (translation_service._google_api_key).
    GOOGLE_API_KEY: str = ""

    # --- Voice: speech-to-text ---
    # STT is fully LOCAL: faster-whisper (CTranslate2 port of OpenAI Whisper)
    # in-process on CPU. No cloud calls, no keys, no rate limits — accuracy
    # comes from the model size, not a provider chain.
    # Model size: small (default) / large-v3-turbo / large-v3 / medium / base.
    # Benchmark on the 8GB 4-core demo box (3.4s Hindi clip):
    #   small            ~6s/query  — interactive, consistent
    #   large-v3-turbo   28-47s/query — near large-v3 accuracy but CPU-bound;
    #                       set WHISPER_MODEL_SIZE=large-v3-turbo on a GPU
    #                       machine where it loads fast and answers <2s.
    WHISPER_MODEL_SIZE: str = "small"
    WHISPER_DEVICE: str = "cpu"        # "cpu" or "cuda"
    WHISPER_COMPUTE_TYPE: str = "int8"  # int8 = fast CPU inference
    # Larger model used ONLY for non-English requests. Malayalam/Tamil are
    # where `small` collapses into repeated-syllable garbage, so they get the
    # stronger model (lazy-loaded, cached alongside the base one). Empty =
    # every language uses WHISPER_MODEL_SIZE.
    # WHISPER_INDIC_MODEL is the single-model override; WHISPER_INDIC_MODELS
    # is the per-language map actually consulted first (fine-tuned OpenAI
    # Whisper checkpoints per language — loaded lazily for languages the
    # service actually hears, cached after first use).
    WHISPER_INDIC_MODEL: str = ""
    WHISPER_INDIC_MODELS: dict[str, str] = {
        # faster-whisper needs CTranslate2 `model.bin`, but the upstream HF
        # repos ship PyTorch weights only (`pytorch_model.bin`/`safetensors`) —
        # loading them by repo id 404s on model.bin and falls back to the
        # general model. That is exactly what happened to `hi`: it pointed at
        # a locally converted `models/whisper-hindi-medium-ct2` directory that
        # was never created (and whose path resolved inside `app/`), so every
        # Hindi request ran on the weak `small` model and /health reported a
        # permanent `stt_indic` warm-up failure.
        # `ukta-app/whisper-hindi-ct2` is a published int8 CT2 conversion of
        # vasista22/whisper-hindi-small (Speech Lab, IIT Madras) — a real
        # model.bin, ~248MB, same int8 dtype the box runs at, so it fits next
        # to the general model on the 7.7GB demo machine. Repo ids are
        # fetched into models/<org>/<name> as plain files by
        # stt_service._resolve_model_source (see why there).
        "hi": "ukta-app/whisper-hindi-ct2",
        "bn": "bengaliAI/tugstugi_bengaliai-regional-asr_whisper-medium",
        "te": "parambharat/whisper-small-te",
        "ta": "parambharat/whisper-small-ta",
        # `ml`: parambharat/whisper-small-ml ships PyTorch weights only (no
        # CT2 model.bin) so faster-whisper 404s and silently falls back to
        # `small`, which hallucinates repeated syllables in Malayalam and the
        # garbage-guard then 503s. CXDuncan/whisper-small-ml-ct2 is the CT2
        # conversion of a Malayalam fine-tune (IndicVoices) with model.bin.
        "ml": "CXDuncan/whisper-small-ml-ct2",
    }
    # Max audio accepted at /transcribe (MB) — bounds CPU time and memory.
    MAX_AUDIO_MB: int = 15

    # --- Voice: text-to-speech ---
    # Primary: local Meta MMS VITS — fast (~1.4-2.7s per sentence across all
    # six languages, measured). Fallback: AI4Bharat IndicParler-TTS (gated HF
    # repo — needs HF_TOKEN with the auto-approval accepted once; parler-tts
    # + espeak-ng required) — autoregressive at ~24s of CPU per second of
    # audio on this box, so it loads on demand only. Both run locally at
    # synthesis time — no provider keys. See app/services/tts_service.py.
    TTS_MODEL: str = "ai4bharat/indic-parler-tts"

    # --- Query translation (RAG retrieval aid) ---
    # IndicTrans2 translates Indic questions to English BEFORE retrieval so a
    # Hindi/Tamil/... query can match the English scheme documents. Answers
    # are still generated in the worker's language — this only improves recall.
    # License note: ai4bharat/indictrans2 models require a one-time license
    # acceptance on Hugging Face (free) + `huggingface-cli login`. While gated,
    # TRANSLATION_FALLBACK_MODEL (Meta NLLB-200, ungated) is used automatically.

    # --- Cloud speech/stt/tts fallback ladder (all optional) ---
    # Voice is LOCAL first (MMS -> Parler for TTS; faster-whisper for STT). If
    # the local path can't serve a language, these keys add a cloud hop that
    # the service will take instead of returning an error. Order is tried
    # lowest index first.
    #
    # STT ladder (per request):
    #   0. local faster-whisper fine-tuned checkpoint (WHISPER_INDIC_MODELS)
    #   1. local faster-whisper general model (WHISPER_MODEL_SIZE, default small)
    #   2. OpenRouter whisper     (OPENROUTER_API_KEY + OPENROUTER_WHISPER_MODEL)
    #   3. Groq whisper           (GROQ_API_KEY + GROQ_STT_MODEL)
    #   4. local general model (last resort, same as 1)
    #
    # TTS ladder (per request):
    #   0. local Meta MMS VITS
    #   1. IndicParler-TTS (ai4bharat/indic-parler-tts, gated HF)
    #   2. OpenRouter tts   (OPENROUTER_API_KEY + OPENROUTER_TTS_MODEL)
    #   3. Groq TTS         (GROQ_API_KEY + GROQ_TTS_MODEL)
    #   4. local MMS (last resort)
    #
    # Set a rung to empty to disable it. If all keys are empty the ladder is
    # purely local and the service never calls out.
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_WHISPER_MODEL: str = "whisper-small"  # e.g. whisper-small / whisper-large-v3-turbo
    OPENROUTER_TTS_MODEL: str = "gpt-4o-mini-tts"   # voice model on OpenRouter
    GROQ_STT_MODEL: str = "whisper-large-v3-turbo"
    GROQ_TTS_MODEL: str = "gpt-3.5-turbo"  # free tier has no TTS; rung disabled by default
    TRANSLATION_MODEL: str = "ai4bharat/indictrans2-indic-en-1B"
    # Dynamic int8 quantization for IndicTrans2 on CPU: ~4x smaller footprint
    # (~1 GB vs ~4 GB fp32) and usually faster linear-heavy inference. On a
    # RAM-constrained box this also stops the weights being paged out between
    # requests. Set TRANSLATION_QUANTIZE=false to keep full fp32 weights.
    TRANSLATION_QUANTIZE: bool = True
    TRANSLATION_FALLBACK_MODEL: str = "facebook/nllb-200-distilled-600M"
    # HTTP read timeout (seconds) for cloud translation calls (Google). A
    # timeout costs the whole per-request latency budget before the chain can
    # fall through.
    TRANSLATE_HTTP_TIMEOUT: int = 20
    TRANSLATION_ENABLED: bool = True
    # Which engine to use: "auto" = IndicTrans2 when loadable (license
    # accepted + HF token), else NLLB fallback. "indictrans2" / "nllb" force
    # one engine (used for quality comparisons); a forced engine that fails
    # to load means translation passes through (never crashes the chatbot).
    TRANSLATION_ENGINE: str = "auto"

    # --- RAG ---
    EMBEDDING_MODEL: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    FAISS_INDEX_DIR: str = "./rag/index"
    RAG_SOURCE_DOCS_DIR: str = "./rag/sample_docs"
    RAG_TOP_K: int = 6
    RAG_MIN_SIMILARITY: float = 0.45  # off-topic/injection questions score <=0.42, genuine hits >=0.47 (eval/RESULTS.md)
    RAG_GROUNDING_THRESHOLD: float = 0.30  # scoring.py: content-word overlap between answer and top context

    # --- Cold start ---
    # How long /ask waits for the boot warm-up to finish before answering with a
    # 503 instead. The Node proxy aborts at AI_TIMEOUT_MS (120s), so a value
    # below that is what turns a would-be proxy timeout into a fast, honest
    # "still starting" reply the worker can retry. Set 0 to fail fast.
    WARMUP_WAIT_SECONDS: float = 90.0

    # --- Languages supported by the platform ---
    SUPPORTED_LANGUAGES: List[str] = ["en", "hi", "bn", "te", "ta", "ml"]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
