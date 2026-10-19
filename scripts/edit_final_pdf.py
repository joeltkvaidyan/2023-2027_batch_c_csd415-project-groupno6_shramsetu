# -*- coding: utf-8 -*-
"""Edit ShramSetu_Final.pdf (v2): white-out wrong claims, stamp verified corrections.

v1 lesson: search_for() cannot match phrases that wrap across lines, so every
needle below is a SINGLE rendered line (verified via get_text("text")).

Edits (page numbers are physical PDF pages):
  p7  "Category-based routing to Labour" + next line "or Police Department."
        -> "Category-based routing to jurisdiction-scoped officials."
  p14 "route to the appropriate authority mailbox."
        -> "queue for the jurisdiction-scoped official."
  p16 "Backend host: CPU-based server capable of running FastAPI,"
      "SQLModel, and the application services."
        -> "Backend host: CPU-based server capable of running Express,"
           "Node.js, MongoDB, and the Python AI service."
  p17 "Mobile client: React Native with Expo and NativeWind."
        -> "Mobile client: installable PWA (React + TypeScript); native client is future work."
  p17 "Backend/API: Python, FastAPI, SQLModel, and JWT-based"
        -> "Backend/API: Node.js + Express 4 + Mongoose 8, JWT-based"
  p17 "Persistence: PostgreSQL for production and SQLite for local"
        -> "Persistence: MongoDB for production and an embedded instance for local"
  p17 "Notifications: SMTP provider interface for grievance routing and email"
        -> "Notifications: in-app worker inbox per worker, official broadcasts, and push"

Left as-is (verified true in the build): LangChain, Sentence Transformers, FAISS,
Groq, Whisper rows; FastAPI on the AI-service rows; Web client row.
"""
import pymupdf

SRC = r"C:\Users\joeljiya\Downloads\ShramSetu_Final.pdf"
OUT = r"C:\Users\joeljiya\Downloads\ShramSetu_Final_corrected.pdf"

# needle(s) -> replacement stamped in place of the FIRST needle's line.
# Extra needles are redacted blank (they are continuation lines).
EDITS = [
    {
        "page": 7,
        "needles": ["Category-based routing to Labour", "or Police Department."],
        "replace": "Category-based routing to jurisdiction-scoped officials.",
    },
    {
        "page": 14,
        "needles": ["route to the appropriate authority mailbox."],
        "replace": "queue for the jurisdiction-scoped official.",
    },
    {
        "page": 16,
        "needles": ["Backend host: CPU-based server capable of running FastAPI,",
                    "SQLModel, and the application services."],
        "replace": "Backend host: CPU-based server capable of running Express,\nNode.js, MongoDB, and the Python AI service.",
    },
    {
        "page": 17,
        "needles": ["Mobile client: React Native with Expo and NativeWind."],
        "replace": "Mobile client: installable PWA (React + TypeScript); native client is future work.",
    },
    {
        "page": 17,
        "needles": ["Backend/API: Python, FastAPI, SQLModel, and JWT-based"],
        "replace": "Backend/API: Node.js + Express 4 + Mongoose 8, JWT-based",
    },
    {
        "page": 17,
        "needles": ["Persistence: PostgreSQL for production and SQLite for local"],
        "replace": "Persistence: MongoDB for production and an embedded instance for local",
    },
    {
        "page": 17,
        "needles": ["Notifications: SMTP provider interface for grievance routing and email"],
        "replace": "Notifications: in-app worker inbox per worker, official broadcasts, and push",
    },
]

TXT_COLOR = (0.10, 0.16, 0.23)  # slide text navy


def main():
    doc = pymupdf.open(SRC)
    applied = 0
    for edit in EDITS:
        page = doc[edit["page"] - 1]
        rects = []
        for needle in edit["needles"]:
            hits = page.search_for(needle)
            if not hits:
                print(f"!! MISS p{edit['page']}: {needle[:60]!r}")
                continue
            rects.append(hits[0])
            applied += 1
        if not rects:
            continue
        # redact all matched lines
        for r in rects:
            rr = pymupdf.Rect(r.x0 - 1.5, r.y0 - 1, r.x1 + 1.5, r.y1 + 1)
            page.add_redact_annot(rr, fill=(1, 1, 1))
        page.apply_redactions()
        # stamp replacement over the union area, auto-shrink to fit
        first = rects[0]
        last = rects[-1]
        area = pymupdf.Rect(first.x0, first.y0 - 1,
                            min(first.x0 + 420, page.rect.width - 12),
                            last.y1 + 2)
        text = edit["replace"]
        for fs in (10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7):
            rc = page.insert_textbox(area, text, fontsize=fs, fontname="helv",
                                     color=TXT_COLOR, align=0, lineheight=1.15)
            if rc >= 0:
                break
        print(f"p{edit['page']}: OK  ({len(edit['needles'])} line(s), stamp fs={fs}, fit rc={rc})")
    doc.save(OUT, garbage=4, deflate=True)
    doc.close()
    print(f"APPLIED {applied} line edits -> {OUT}")


if __name__ == "__main__":
    main()
