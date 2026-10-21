"""ShramSetu AI microservice (FastAPI, port 8100).

Internal API consumed only by the Node.js backend:
  POST /ask        {question, language}         → ChatAnswer JSON (RAG + Groq)
  GET  /speak      ?text=&language=             → audio/wav (local MMS VITS)
  POST /transcribe ?language= (multipart: file) → {text} (local faster-whisper)
  GET  /health     → liveness + warm-up state (always 200)
  GET  /health/live  → liveness only (always 200)
  GET  /health/ready → readiness (503 while the boot warm-up is still running)

Access control:
  - Every route except the three health paths requires X-Internal-Key when
    AI_INTERNAL_KEY is set (the Node server sends it from its own env).
  - Per-IP rate limiting and request-size caps guard against abuse.
  - Text sent to EXTERNAL providers (Groq, Google) is scrubbed for
    mobile/Aadhaar numbers first (app/services/pii.py).

COLD START: the port opens before the models are loaded, so the service tracks
its own warm-up state (app/core/warmup.py). /health says whether it is warming
or ready, /health/ready gates on it, and /ask waits a bounded time rather than
hanging until the Node proxy aborts. See app/core/warmup.py for the full story.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from app.core.config import settings
from app.core import warmup
from app.services import rag_service, stt_service, tts_service
from app.services.pii import strip_pii

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("shramsetu.ai")

# This box has 4 cores; torch sometimes defaults to fewer intra-op threads
# here. Use all of them for Coqui TTS / Whisper / IndicTrans2 — must run
# BEFORE any model loads (incl. the TTS preload thread below).
try:
    import os as _os

    import torch as _torch

    _torch.set_num_threads(max(1, _os.cpu_count() or 1))
    logger.info("torch intra-op threads = %d", _torch.get_num_threads())
except Exception:  # pragma: no cover - torch missing / already initialized
    pass

# Optional shared Redis rate-limit store (multi-container). Falls back to
# per-process in-memory when the `redis` package or REDIS_URL is absent.
try:
    import redis as _redis  # type: ignore
    _REDIS_URL = settings.REDIS_URL if hasattr(settings, "REDIS_URL") else None
    _redis_client = _redis.Redis.from_url(_REDIS_URL) if _REDIS_URL else None
except Exception:
    _redis_client = None

LANGS = {"en", "hi", "bn", "te", "ta", "ml"}

# Health/readiness probes. These are the only unauthenticated paths: a container
# orchestrator has no way to present the Node server's internal key, and a
# readiness probe must never be the thing that fails.
_OPEN_PATHS = frozenset({"/health", "/health/live", "/health/ready"})

# ── Boot warm-up ─────────────────────────────────────────────────────
# Prewarming used to run at MODULE IMPORT, which meant merely importing `main`
# (an eval script, a test, a REPL) kicked off three multi-hundred-megabyte model
# loads. It now runs in the ASGI lifespan startup hook instead, so importing the
# module is free and only a real server boot pays for it. The loads themselves
# are unchanged fire-and-forget background threads; what is new is that each one
# reports into the warm-up registry, so /health can tell the truth.
#
# Order still matters: RAG first, because it is the heavy local half of every
# /ask and warming it ahead of the others is what keeps the first question after
# a restart inside the Node proxy's abort window.
@asynccontextmanager
async def lifespan(_app: FastAPI):
    # TTS is local now (MMS VITS) — prewarmed below alongside the rest.
    from app.services import translation_service

    # Materialize the transformers import tree ON THIS THREAD before the
    # prewarm threads below start racing each other into it. transformers
    # ships a lazy module whose top-level __init__ is not safe to populate
    # concurrently: two threads doing `from transformers import AutoConfig`
    # / `AutoTokenizer` while a third is still executing transformers'
    # __init__ hit a half-initialized module and raise a transient
    # "cannot import name …" — which the warm-up registry then records as a
    # permanent component failure. A completed top-level import makes every
    # later lazy getattr a plain sys.modules lookup.
    import sentence_transformers  # noqa: F401
    from transformers import AutoConfig, AutoTokenizer, VitsModel  # noqa: F401

    rag_service.prewarm()
    # IndicTrans2: load + int8-quantize at boot in a background thread so the
    # first Indic /ask skips a cold model load that used to stall the endpoint
    # for minutes on a RAM-constrained box.
    translation_service.prewarm()
    # faster-whisper: the STT path, and a cold load mid-demo would add ~8s on
    # top of the ~6s CPU transcription.
    stt_service.prewarm()
    tts_service.prewarm()
    logger.info("Boot warm-up started; poll /health/ready for real readiness")
    yield
    logger.info("Shutting down")


app = FastAPI(title="ShramSetu AI Service", version="1.0.0", lifespan=lifespan)


# ── Service-to-service auth + abuse guards ──────────────────────────
_MAX_BODY_MB = 25  # covers the largest /transcribe upload (MAX_AUDIO_MB=15)


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


_hits: dict[str, deque] = defaultdict(lambda: deque(maxlen=256))


def _rate_limit_ok(ip: str) -> bool:
    """Per-IP rate limit. Uses Redis when available (shared across
    containers), otherwise falls back to per-process in-memory."""
    now = time.monotonic()

    if _redis_client is not None:
        try:
            key = f"ai:ratelimit:{ip}"
            count = _redis_client.incr(key)
            if count == 1:
                _redis_client.expire(key, 60)
            return count <= settings.AI_RATE_LIMIT_PER_MIN
        except Exception:
            # Redis failure — fall back to in-memory rather than failing open/closed.
            pass

    window = _hits[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= settings.AI_RATE_LIMIT_PER_MIN:
        return False
    window.append(now)
    return True


@app.middleware("http")
async def guard_middleware(request: Request, call_next):
    path = request.url.path

    # Health is intentionally open (container probes, verify scripts).
    if path not in _OPEN_PATHS:
        expected = settings.AI_INTERNAL_KEY
        # Only enforce when a key is configured: the docstring contract (and
        # the tests' registry fixture) treat an EMPTY key as "auth disabled",
        # e.g. for local/self-hosted runs where the Node gateway fronts this
        # service. An unset key must never lock the whole service out.
        if expected and request.headers.get("X-Internal-Key") != expected:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)

        # Per-IP rate limit.
        ip = _client_ip(request)
        if not _rate_limit_ok(ip):
            return JSONResponse({"detail": "Rate limit exceeded, slow down."}, status_code=429)

        # Request-size cap (headers only; body streams are validated per-route).
        try:
            length = int(request.headers.get("content-length") or 0)
        except ValueError:
            length = 0
        if length > _MAX_BODY_MB * 1024 * 1024:
            return JSONResponse({"detail": "Request body too large"}, status_code=413)

    return await call_next(request)

def _run_blocking(fn, *args):
    """Run a CPU-bound model call (whisper/coqui/indictrans2) on the
    threadpool so the event loop stays responsive during inference."""
    return asyncio.get_running_loop().run_in_executor(None, lambda: fn(*args))


@app.get("/health")
def health():
    """Liveness + warm-up state, always HTTP 200.

    `status` stays "ok" whenever the process is up, so existing consumers
    (server/scripts/verify.mjs, start-all.ps1) keep working. `state` is the
    honest answer to "can it answer yet?" and `ready` is its boolean form.
    """
    return {
        "status": "ok",
        "service": "shramsetu-ai",
        "ready": warmup.REGISTRY.is_ready(),
        "warmup": warmup.REGISTRY.snapshot(),
    }


@app.get("/health/live")
def health_live():
    """Liveness only. Never fails while the process is up — a warming service
    must not be killed and restarted, because that restarts the very load it
    was waiting on."""
    return {"status": "alive", "service": "shramsetu-ai"}


@app.get("/health/ready")
def health_ready():
    """Readiness. 503 while the required warm-up is still running, 200 once
    /ask can actually answer. This is what start-all.ps1 and any deploy script
    should wait on, and it closes the audit finding that this service had no
    liveness/readiness split."""
    snap = warmup.REGISTRY.snapshot()
    if not snap["ready"]:
        return JSONResponse(
            {
                "status": snap["state"],
                "service": "shramsetu-ai",
                "ready": False,
                "detail": "Boot warm-up in progress; /ask is not serving yet."
                if snap["state"] == "warming"
                else "A required component failed to load; /ask will retry on demand.",
                "warmup": snap,
            },
            status_code=503,
            headers={"Retry-After": "5"},
        )
    return {"status": "ready", "service": "shramsetu-ai", "ready": True, "warmup": snap}


@app.post("/ask")
def ask(payload: dict):
    question = str(payload.get("question") or "").strip()
    language = payload.get("language") or "en"
    if language not in LANGS:
        language = "en"
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="question too long")

    # A request can outrun the boot warm-up. Waiting a bounded time keeps the
    # good case (it finishes and we answer), while the bound is what stops the
    # request from hanging until the Node proxy aborts at 120s: past it we
    # return a fast 503 and the worker gets the localised "still starting"
    # message instead of a timeout.
    if not warmup.REGISTRY.is_ready():
        logger.info("/ask arrived during warm-up (%s); waiting up to %.0fs",
                    warmup.REGISTRY.warming(), settings.WARMUP_WAIT_SECONDS)
        if not warmup.REGISTRY.wait_until_ready(settings.WARMUP_WAIT_SECONDS):
            snap = warmup.REGISTRY.snapshot()
            logger.warning("/ask giving up during warm-up: %s", snap["warming"] or snap["failed"])
            return JSONResponse(
                {
                    "detail": "AI service is still starting up. Please try again in a moment.",
                    "warming": snap["warming"],
                    "failed": snap["failed"],
                    "ready": False,
                },
                status_code=503,
                headers={"Retry-After": "5"},
            )

    # Scrub PII BEFORE the question reaches retrieval, the Groq LLM or any
    # translation provider (the whole pipeline is downstream of this call).
    question = strip_pii(question)

    # Blocking on purpose: embeddings + FAISS + translation + LLM.
    # FastAPI runs sync endpoints on the threadpool — exactly right for this.
    return rag_service.answer_question(question, language)


@app.get("/speak")
async def speak(
    text: str = Query(""),
    language: str = Query("en"),
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="No text provided")
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="Text too long to speak")
    text = strip_pii(text)
    language = language.split("-")[0].lower()
    try:
        audio, media_type = await _run_blocking(tts_service.synthesize_speech, text, language)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return Response(content=audio, media_type=media_type)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: Optional[str] = Query(None)):
    content = await file.read()
    filename = file.filename or "audio.webm"
    logger.info("[transcribe] file=%s size=%d lang=%s", filename, len(content), language)

    if not content or len(content) < 500:
        raise HTTPException(status_code=400, detail="Audio too short — record for at least 1 second.")
    if len(content) > settings.MAX_AUDIO_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file too large")

    try:
        text = await _run_blocking(stt_service.transcribe_audio, content, filename, language)
        logger.info("[transcribe] result=%r", text[:80] if text else "(empty)")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"text": text.strip()}
