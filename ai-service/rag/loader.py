"""Parses the plain-text government documents used to seed the RAG index.

File format (see sample_docs/*.txt):
    TITLE: ...
    DEPARTMENT: ...
    LAST_UPDATED: YYYY-MM-DD
    ---
    <body text>

This is intentionally simple/free of dependencies so any government
department document can be dropped into sample_docs/ as a .txt file and
picked up automatically on next index rebuild.
"""
from __future__ import annotations

import os
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass
class SourceDocument:
    """A parsed government document with full provenance metadata.

    Supported header keys (all optional except TITLE — missing ones get
    honest defaults rather than fabricated values, and 'superseded' status
    keeps stale documents from silently feeding the chatbot):
        TITLE / DEPARTMENT / LAST_UPDATED      (original format, unchanged)
        AUTHORITY        issuing authority, e.g. "Ministry of Labour & Employment"
        SOURCE_URL       official publication URL
        VERSION          document version tag, e.g. "v2.1"
        PUBLISHED_DATE   first publication date (YYYY-MM-DD)
        EFFECTIVE_DATE   date the rules take effect (YYYY-MM-DD)
        LAST_VERIFIED    date a human last verified content against the source
        STATUS           active | superseded | draft   (default: active)
    """

    title: str
    department: str
    last_updated: str
    body: str
    filename: str
    authority: str = "Unknown"
    source_url: str = ""
    version: str = "v1"
    published_date: str = "Unknown"
    effective_date: str = "Unknown"
    last_verified: str = "Unknown"
    status: str = "active"


def parse_document_file(path: Path) -> SourceDocument:
    text = path.read_text(encoding="utf-8")
    header, _, body = text.partition("---")
    meta: dict[str, str] = {}
    for line in header.strip().splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip().upper()] = val.strip()

    return SourceDocument(
        title=meta.get("TITLE", path.stem),
        department=meta.get("DEPARTMENT", "Unknown Department"),
        last_updated=meta.get("LAST_UPDATED", "Unknown"),
        body=body.strip(),
        filename=path.name,
        authority=meta.get("AUTHORITY", "Unknown"),
        source_url=meta.get("SOURCE_URL", ""),
        version=meta.get("VERSION", "v1"),
        published_date=meta.get("PUBLISHED_DATE", "Unknown"),
        effective_date=meta.get("EFFECTIVE_DATE", "Unknown"),
        last_verified=meta.get("LAST_VERIFIED", "Unknown"),
        status=meta.get("STATUS", "active").strip().lower(),
    )


def _load_verified_registry() -> dict:
    """Load verified-sources.json registry."""
    # Look in common locations
    for candidate in [
        Path(__file__).resolve().parents[2] / "docs" / "verified-sources.json",
        Path(__file__).resolve().parents[1] / "docs" / "verified-sources.json",
        Path("/workspace/chats/609c2fe3d62d4f4b212de23e/docs/verified-sources.json"),
    ]:
        if candidate.exists():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                pass
    return {"entries": []}


def load_all_documents(source_dir: str, require_verified: bool = True) -> List[SourceDocument]:
    """Load documents. Files with STATUS: superseded are skipped.
    If require_verified is True, also enforce verification gating against
    docs/verified-sources.json (skip unverified/outdated docs with needs review).
    """
    docs: List[SourceDocument] = []
    src = Path(source_dir)
    if not src.exists():
        return docs
    skipped: List[str] = []
    verified_urls = set()
    verified_titles = set()
    try:
        registry = _load_verified_registry()
        for e in registry.get("entries", []):
            if e.get("status") == "verified":
                if e.get("url"):
                    verified_urls.add(str(e.get("url")).strip().lower())
                if e.get("title"):
                    verified_titles.add(str(e.get("title")).strip().lower())
    except Exception:
        verified_urls = set()
        verified_titles = set()

    for path in sorted(src.glob("*.txt")):
        parsed = parse_document_file(path)
        if parsed.status == "superseded":
            skipped.append(f"{path.name} (superseded)")
            continue
        if require_verified:
            # Check for "needs review" markers
            if (parsed.source_url and "needs review" in str(parsed.source_url).lower()) or \
               (parsed.last_verified and "needs review" in str(parsed.last_verified).lower()) or \
               (parsed.authority and "needs review" in str(parsed.authority).lower()):
                skipped.append(f"{path.name} (needs_review_metadata)")
                continue
            # Must have a source URL if we have registry entries? Or be in verified set
            if verified_urls:
                if not parsed.source_url or str(parsed.source_url).strip().lower() not in verified_urls:
                    # Also allow if title matches
                    if parsed.title.strip().lower() not in verified_titles:
                        skipped.append(f"{path.name} (not_in_verified_registry)")
                        continue
        docs.append(parsed)
    if skipped:
        import logging

        logging.getLogger("shramsetu.rag").info(
            "Skipping documents: %s", ", ".join(skipped)
        )
    if require_verified and not docs:
        raise RuntimeError("No verified documents loaded after gating")
    return docs


def chunk_text(text: str, chunk_size: int = 700, overlap: int = 120) -> List[str]:
    """Simple word-based sliding-window chunker (dependency-free)."""
    words = text.split()
    if not words:
        return []
    chunks = []
    step = max(chunk_size - overlap, 1)
    for start in range(0, len(words), step):
        chunk = " ".join(words[start : start + chunk_size])
        if chunk:
            chunks.append(chunk)
        if start + chunk_size >= len(words):
            break
    return chunks
