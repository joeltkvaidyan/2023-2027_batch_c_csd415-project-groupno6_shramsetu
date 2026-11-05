"""Corpus honesty checks: every doc carries provenance headers, repealed Acts
are marked superseded, and the current-Code documents exist and cite PIB.

These tests are the automation behind the Phase 3 rule "don't invent facts —
cite an official source". They run offline over rag/sample_docs/*.txt.
"""
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "rag" / "sample_docs"

# Retired on purpose: each of these was the near-duplicate half of a topic that
# now has exactly one document (see test_deduped_topics_are_single_sourced).
# Keeping the merge honest is the job of that test, not of a second document.
DEDUPED_AWAY = {
    "construction-osh-code-2020.txt": "osh-code-2020.txt",
    "minimum-wages-act.txt": "code-on-wages-2019.txt",
    "pm-kisan.txt": "pm-kisan-samman-nidhi.txt",
}

LANGUAGE_SUFFIX = re.compile(r"-(hindi|bengali|tamil|telugu|malayalam)\.txt$")

REPEALED_ACT_DOCS = {
    "minimum-wages-hindi.txt",
    "payment-of-wages-act.txt",
    "equal-remuneration-act.txt",
    "contract-labour-act.txt",
    "interstate-migrant-workmen-act.txt",
    "bocw-act.txt",
    "building-workers-welfare-cess.txt",
    "workers-compensation.txt",
    "maternity-benefit-act.txt",
    "unorganised-workers-social-security.txt",
}

CURRENT_CODE_DOCS = [
    "code-on-wages-2019.txt",
    "code-on-social-security-2020.txt",
    "osh-code-2020.txt",
    "industrial-relations-code-2020.txt",
]


def _header(text: str) -> str:
    return text.partition("---")[0]


def _body(path: Path) -> str:
    return path.read_text(encoding="utf-8").partition("---")[2]


def _shingles(text: str, width: int = 5) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(tokens[i : i + width]) for i in range(max(0, len(tokens) - width + 1))}


def test_all_docs_have_status_header():
    for path in sorted(DOCS.glob("*.txt")):
        header = _header(path.read_text(encoding="utf-8"))
        assert "STATUS:" in header, f"{path.name} missing STATUS header"


def test_valid_status_values_only():
    for path in sorted(DOCS.glob("*.txt")):
        header = _header(path.read_text(encoding="utf-8"))
        status = next(
            ln.split(":", 1)[1].strip() for ln in header.splitlines() if ln.startswith("STATUS:")
        )
        assert status in {"current", "superseded", "active", "draft"}, path.name


def test_no_blanket_placeholder_date_remains():
    for path in sorted(DOCS.glob("*.txt")):
        header = _header(path.read_text(encoding="utf-8"))
        assert "LAST_UPDATED: 2025-04-01" not in header, f"{path.name} still has blanket date"


def test_active_docs_carry_source_url_and_verification():
    for path in sorted(DOCS.glob("*.txt")):
        text = path.read_text(encoding="utf-8")
        header = _header(text)
        status = next(
            ln.split(":", 1)[1].strip() for ln in header.splitlines() if ln.startswith("STATUS:")
        )
        if status == "superseded":
            continue
        assert "SOURCE_URL:" in header, f"{path.name} missing SOURCE_URL"
        assert "LAST_VERIFIED:" in header, f"{path.name} missing LAST_VERIFIED"


def test_repealed_acts_are_superseded_and_flagged_historical():
    for name in REPEALED_ACT_DOCS:
        text = (DOCS / name).read_text(encoding="utf-8")
        header = _header(text)
        assert "STATUS: superseded" in header, f"{name} must be marked superseded"
        assert "REPEALED" in text, f"{name} must carry the historical notice"
        assert "21 November 2025" in text, f"{name} must state the repeal date"
        assert "pib.gov.in" in text, f"{name} must cite the PIB source"


def test_current_code_docs_exist_and_cite_pib():
    for name in CURRENT_CODE_DOCS:
        path = DOCS / name
        assert path.exists(), f"{name} is missing"
        text = path.read_text(encoding="utf-8")
        header = _header(text)
        assert "STATUS: current" in header, f"{name} must be current"
        assert "21 November 2025" in text, f"{name} must state the commencement date"
        assert "pib.gov.in" in text, f"{name} must cite the PIB source"


def test_deduped_topics_are_single_sourced():
    """One topic, one document. The merge must not lose the facts that made the
    second copy worth having, so each successor is checked for them."""
    merged_facts = {
        "osh-code-2020.txt": ["Welfare Board", "cess", "passbook", "21 November 2025"],
        "code-on-wages-2019.txt": ["floor wage", "overtime", "14400", "Minimum Wages Act, 1948"],
        "pm-kisan-samman-nidhi.txt": ["landholding", "DBT", "155261", "landless"],
    }
    for removed, survivor in DEDUPED_AWAY.items():
        assert not (DOCS / removed).exists(), f"{removed} came back — merge it into {survivor}"
        assert (DOCS / survivor).exists(), f"{survivor} is missing"
        text = (DOCS / survivor).read_text(encoding="utf-8").lower()
        for fact in merged_facts[survivor]:
            assert fact.lower() in text, f"{survivor} lost '{fact}' when {removed} was merged in"


def test_no_near_duplicate_documents():
    """Two English documents that say the same thing split retrieval and let the
    model answer from the wrong (often repealed) one. 5-word shingle Jaccard.

    Language variants are excluded: they are translations, so they deliberately
    repeat the English content."""
    docs = {p.name: _shingles(_body(p)) for p in sorted(DOCS.glob("*.txt")) if not LANGUAGE_SUFFIX.search(p.name)}
    worst = (0.0, "", "")
    offenders = []
    names = sorted(docs)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            union = docs[a] | docs[b]
            if not union:
                continue
            score = len(docs[a] & docs[b]) / len(union)
            if score > worst[0]:
                worst = (score, a, b)
            if score >= 0.5:
                offenders.append(f"{a} ~ {b} ({score:.2f})")
    assert not offenders, "near-duplicate corpus documents: " + "; ".join(offenders)
    print(f"closest English pair: {worst[1]} ~ {worst[2]} = {worst[0]:.2f}")
