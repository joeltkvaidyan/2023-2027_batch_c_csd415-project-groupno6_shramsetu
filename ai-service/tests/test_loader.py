"""Tests for rag/loader.py — header parsing and superseded-doc skipping."""
from rag.loader import parse_document_file, load_all_documents, chunk_text, _load_verified_registry
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "rag" / "sample_docs"


def test_parse_document_file_reads_new_headers():
    doc = parse_document_file(DOCS / "code-on-wages-2019.txt")
    assert doc.title.startswith("Code on Wages, 2019")
    assert doc.status == "current"
    assert doc.source_url.startswith("https://www.pib.gov.in/")
    assert doc.last_verified == "2026-10-01"


def test_parse_superseded_doc_keeps_status():
    doc = parse_document_file(DOCS / "minimum-wages-act.txt")
    assert doc.status == "superseded"
    assert doc.last_verified == "2026-10-01"


def test_load_all_documents_skips_superseded():
    """Strict-gated load: superseded docs and docs quarantined with
    'needs review' metadata never load; the four current-Code documents and
    every registry-verified doc (e.g. the 2026 additions) do. Every loaded
    document must cite a registry-verified URL or title."""
    all_txt = sorted(DOCS.glob("*.txt"))
    docs = load_all_documents(str(DOCS))
    loaded_names = {d.filename for d in docs}

    # Nothing loads that is not a source document.
    assert loaded_names <= {p.name for p in all_txt}
    # Repealed Acts (marked superseded) never load.
    assert "minimum-wages-act.txt" not in loaded_names
    # 'needs review' metadata stays quarantined (KB-curation debt, gap report).
    assert "health-and-safety-workers.txt" not in loaded_names
    # Current-law docs load — gated through verified-sources.json.
    assert "code-on-wages-2019.txt" in loaded_names
    assert "code-on-social-security-2020.txt" in loaded_names
    assert "construction-osh-code-2020.txt" in loaded_names
    assert "industrial-relations-code-2020.txt" in loaded_names
    assert "heat-stress-advisory.txt" in loaded_names

    # The gate is real: loaded docs must cite registry-verified sources.
    registry = _load_verified_registry()
    verified_urls = {
        str(e.get("url")).strip().lower()
        for e in registry.get("entries", [])
        if e.get("status") == "verified" and e.get("url")
    }
    verified_titles = {
        str(e.get("title")).strip().lower()
        for e in registry.get("entries", [])
        if e.get("status") == "verified" and e.get("title")
    }
    for doc in docs:
        assert (
            doc.source_url.strip().lower() in verified_urls
            or doc.title.strip().lower() in verified_titles
        ), f"{doc.filename} loaded without a registry-verified source"


def test_load_all_documents_missing_dir_returns_empty():
    assert load_all_documents(str(DOCS.parent / "does-not-exist")) == []


def test_chunk_text_windows_overlap():
    words = [f"w{i}" for i in range(800)]
    text = " ".join(words)
    chunks = chunk_text(text, chunk_size=700, overlap=120)
    assert len(chunks) >= 2
    first = chunks[0].split()
    second = chunks[1].split()
    assert first[:1] == ["w0"]
    # step = chunk_size - overlap = 580: chunk 2 starts at w580, and the
    # words w580..w699 appear in BOTH chunks (the overlap window).
    assert second[0] == "w580"
    assert "w580" in first
    assert "w699" in second


def test_chunk_text_empty_is_safe():
    assert chunk_text("") == []
