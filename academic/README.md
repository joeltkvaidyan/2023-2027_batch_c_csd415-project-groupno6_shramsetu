# academic/ — presentation material, not part of the product

Everything in this folder is university/hand-off material: the viva deck, the
question bank, the PDF-editing scripts used to correct the printed deck, and the
superseded FastAPI/SQLite-era documents.

Nothing here is imported, built, tested or deployed. `server/`, `frontend/` and
`ai-service/` never reference it.

| Path | What it is |
|---|---|
| `ShramSetu_Final_corrected.pdf` / `.pptx` | The submitted presentation deck |
| `build_deck.py` | Regenerates the `.pptx` from the checked-in architecture docs |
| `edit_final_pdf.py`, `find_pdf_claims.py` | One-off scripts that stamped corrections onto the original PDF |
| `VIVA_QA.md` | Likely examiner questions with defensible answers |
| `PRESENTATION_VIVA_NOTES.md` | Presenter notes, claim-by-claim sources |
| `archive/` | Superseded FastAPI/SQLite-era documents, each prefixed `ARCHIVED_` |

The scripts contain absolute paths from the machine the deck was produced on, so
they are kept for provenance rather than as runnable tooling.
