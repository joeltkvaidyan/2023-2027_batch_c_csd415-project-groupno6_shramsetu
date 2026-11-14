# -*- coding: utf-8 -*-
"""Locate exact text spans of the wrong claims in ShramSetu_Final.pdf."""
import pymupdf

PDF = r"C:\Users\joeljiya\Downloads\ShramSetu_Final.pdf"

NEEDLES = [
    "mailbox",
    "SMTP",
    "SQLModel",
    "PostgreSQL",
    "SQLite",
    "Labour Department",
    "Police Department",
    "React Native",
    "Expo",
    "NativeWind",
    "LangChain",
    "Sentence Transformers",
    "FAISS",
    "Groq",
    "Whisper",
    "FastAPI",
]

doc = pymupdf.open(PDF)
for pno in range(len(doc)):
    page = doc[pno]
    words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,word_no
    text = page.get_text()
    for needle in NEEDLES:
        if needle.lower() in text.lower():
            # find hit rects via search_for (handles phrase across spans)
            rects = page.search_for(needle)
            lines = [l.strip() for l in text.splitlines() if needle.lower() in l.lower()]
            print(f"\n== p{pno+1} '{needle}': {len(rects)} rect(s)")
            for l in lines[:3]:
                print("   line:", l[:120])
doc.close()
