# ShramSetu AI microservice — production container.
#
# Build: docker build -t shramsetu-ai-service ./ai-service
# Run:     docker run -d --name shramsetu-ai-service --env-file .env -p 8100:8100 shramsetu-ai-service
#
# Runtime requirements (all passed through from the host):
#   GROQ_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY (optional translate),
#   HF_TOKEN (for the licensed IndicTrans2 model download).
# TTS and STT are fully local — no TTS/STT keys.

FROM python:3.12-slim AS builder

WORKDIR /build

# Compile wheels so the final image does not pay torch install time.
RUN pip install --no-cache-dir --upgrade pip uv

# Copy the dependency manifests first (best layer caching).
COPY requirements.txt requirements-dev.txt* ./

RUN uv pip install --system --no-cache -r requirements.txt && \
    uv pip install --system --no-cache -r requirements-dev.txt

FROM python:3.12-slim AS runtime

WORKDIR /app

# System deps: ffmpeg for faster-whisper audio decoding, curl for the
# compose healthcheck (python:3.12-slim ships neither).
RUN apt-get update && apt-get install -y --no-cache \
    ffmpeg \
    tesseract-ocr \
    libgomp1 \
    curl \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Copy the pre-built wheels + site-packages.
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy the application code (.dockerignore excludes venv/, models/, .env, ...).
COPY . .

# Sample docs for the RAG index (rag/index is volume-mounted at runtime;
# the index builds on first boot in the lifespan hook if missing).
COPY rag/rag.py ./rag/
COPY rag/sample_docs ./rag/sample_docs

# HTTPS for voice (optional): valid certs in ./certs, self-signed fallback.
RUN mkdir -p /app/certs && chmod 755 /app/certs

EXPOSE 8100

# uvicorn is the production ASGI server. The ASGI lifespan hook does the
# boot warm-up (embedding model + FAISS index + translation + whisper), so
# /health/ready stays at 503 until /ask can actually answer.
CMD ["uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8100", "--timeout-keep-alive", "60"]
