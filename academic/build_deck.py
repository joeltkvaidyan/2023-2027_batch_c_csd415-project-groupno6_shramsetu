# -*- coding: utf-8 -*-
"""Rebuild the ShramSetu final review deck with code-verified content.

Corrections vs the original deck (verified against the repo on 2026-10-12):
- Slide 8  architecture diagram: now the REAL polyglot stack (React PWA ->
  Express+MongoDB -> FastAPI AI service -> Groq/Gemini, faster-whisper, MMS TTS)
  instead of the stale FastAPI/SQLModel single-backend design.
- Slide 6/13 grievance routing: 'routes to jurisdiction-scoped officials
  (Labour Department / Police roles by filing jurisdiction), with in-app
  notification + status workflow' instead of 'SMTP mailbox'.
- Slide 9  use case diagram redrawn (workers/officials/superadmin + RAG actor).
- Slide 16 software requirements: Node/Express + MongoDB stack, in-app
  notification inbox (no SMTP claim).
- Slides 17-24: measurable results (hit@1 94%, hit@3 98%, 12/13 refusals,
  10/10 live-LLM safety, 49+92+50 test suites, E2E 34 checks).

Usage:
  python shramsetu/scripts/build_deck.py [--pdf]
Writes: shramsetu/docs/ShramSetu_Final_corrected.pptx and .pdf (next to it)
"""
from __future__ import annotations

import os
import sys

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor

# ── 16:9 geometry ────────────────────────────────────────────────────────────
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

EMPH = Pt(24)      # section titles
TITLE = Pt(22)     # slide titles
SUB = Pt(14)       # subtitle
BODY = Pt(14)
SMALL = Pt(11)
TINY = Pt(9)

# Palette
C_DARK = RGBColor.from_string("0F2A43")   # deep navy
C_ORANGE = RGBColor.from_string("F2762E")
C_LIGHT = RGBColor.from_string("F7F4EF")   # warm paper
C_TEXT = RGBColor.from_string("20303C")
C_MUT = RGBColor.from_string("5C6B78")
C_GREEN = RGBColor.from_string("147D64")

MAIN = [
    ("Fadhl Mohammed Nalakath", "CHN23CS076", None),
    ("Hasibul Ansari", "CHN23CS092", None),
    ("Joel TK Vaidyan", "CHN23CS103", None),
    ("Madhav Rammohan", "CHN23CS122", None),
]
GUIDE = ["Smt. Simi Susan Samuel", "Smt. Geetha S", "Smt. Suvarna Dev"]  # per COM-probe
DEPT = "Department of Computer Science and Engineering"
COLLEGE = "College of Engineering Chengannur"
YEAR = "October 2026"


def blank(prs: Presentation):
    return prs.slides.add_slide(prs.slide_layouts[6])


def tb(slide, x, y, w, h, text="", size=BODY, color=C_TEXT, bold=False,
       align=None, font="Calibri", italic=False, bullet=False, spacing=None):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = text
    r.font.size = size
    r.font.color.rgb = color
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font
    if align is not None:
        p.alignment = align
    if bullet:
        p.text = "\u2022  " + text
        p.font.size = size
        p.font.color.rgb = color
    if spacing:
        box.top = spacing
    return box


def para(slide, x, y, w, h, lines, size=BODY, color=C_TEXT, first_bold=False,
         line_gap=6, font="Calibri", space_after=4):
    """lines: list of str OR (str, bold) tuples."""
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    first = True
    for ln in lines:
        bold = False
        if isinstance(ln, tuple):
            ln, bold = ln
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        r = p.add_run()
        r.text = ("• " if bold and ln.startswith("- ") is False and first_bold else "") + ln
        r.font.size = size
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = font
        p.space_after = Pt(space_after)
    return box


def bullet_box(slide, x, y, w, h, items, size=BODY, color=C_TEXT, gap=6, bold_first=False):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    first = True
    for it in items:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        if isinstance(it, tuple):
            head, rest = it
            r = p.add_run()
            r.text = head + "  "
            r.font.bold = True
            r.font.size = size
            r.font.color.rgb = color
            r.font.name = "Calibri"
            r2 = p.add_run()
            r2.text = rest
            r2.font.size = size
            r2.font.color.rgb = color
            r2.font.name = "Calibri"
        else:
            r = p.add_run()
            r.text = "•  " + it
            r.font.size = size
            r.font.color.rgb = color
            r.font.name = "Calibri"
        p.space_after = Pt(gap)
    return box


def section_bar(slide, label, y=Inches(0.45)):
    bar = slide.shapes.add_shape(1, Inches(0.6), y, Inches(2.4), Inches(0.42))  # rectangle
    bar.fill.solid()
    bar.fill.fore_color.rgb = C_ORANGE
    bar.line.fill.background()
    tf = bar.text_frame
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = label
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = RGBColor.from_string("FFFFFF")
    r.font.name = "Calibri"


def slide_title(slide, text, y=Inches(1.0)):
    tb(slide, Inches(0.6), y, Inches(12.1), Inches(0.7), text, size=TITLE,
       color=C_DARK, bold=True)


def footer(slide, idx, total):
    if total == 0:
        return  # real page numbers are added by footer_all()
    tb(slide, Inches(0.6), Inches(7.02), Inches(6.0), Inches(0.3),
       f"ShramSetu — Final Review  ·  {DEPT}, {COLLEGE}", size=TINY, color=C_MUT)
    tb(slide, Inches(11.9), Inches(7.02), Inches(0.9), Inches(0.3),
       f"{idx} / {total}", size=TINY, color=C_MUT, align=2)


def card(slide, x, y, w, h, fill=None, line=None):
    fill = fill or C_LIGHT
    line = line or "E4DED2"
    if isinstance(fill, str):
        fill = RGBColor.from_string(fill)
    if isinstance(line, str):
        line = RGBColor.from_string(line)
    c = slide.shapes.add_shape(1, x, y, w, h)
    c.fill.solid()
    c.fill.fore_color.rgb = fill
    c.line.color.rgb = line
    c.line.width = Pt(0.75)
    c.shadow.inherit = False
    return c


# ── Slide builders ──────────────────────────────────────────────────────────

def s_title(prs, n, total):
    s = blank(prs)
    bg = s.shapes.add_shape(1, 0, 0, SLIDE_W, SLIDE_H)
    bg.fill.solid(); bg.fill.fore_color.rgb = C_DARK; bg.line.fill.background()
    tb(s, Inches(1.0), Inches(2.0), Inches(11.3), Inches(1.4),
       "ShramSetu", size=Pt(54), color=RGBColor.from_string("FFFFFF"), bold=True, font="Georgia")
    tb(s, Inches(1.0), Inches(3.2), Inches(11.3), Inches(0.8),
       "AI-First Multilingual Welfare Platform for Migrant Workers",
       size=Pt(26), color=RGBColor.from_string("E8D9C8"))
    tb(s, Inches(1.0), Inches(4.15), Inches(11.3), Inches(0.5),
       "Final Semester Review  ·  " + YEAR, size=Pt(16), color=RGBColor.from_string("B9C4CE"))
    names = "   ·   ".join(f"{n_}" for n_, _, _ in MAIN)
    ids = "   ·   ".join(i for _, i, _ in MAIN)
    tb(s, Inches(1.0), Inches(5.05), Inches(11.5), Inches(0.45), names, size=Pt(15),
       color=RGBColor.from_string("FFFFFF"), bold=True)
    tb(s, Inches(1.0), Inches(5.55), Inches(11.5), Inches(0.4), ids, size=Pt(13),
       color=RGBColor.from_string("B9C4CE"))
    tb(s, Inches(1.0), Inches(6.15), Inches(11.5), Inches(0.75),
       f"Guide: {GUIDE[0]}   |   Co-guides: {GUIDE[1]}, {GUIDE[2]}\n{DEPT}, {COLLEGE}",
       size=Pt(12), color=RGBColor.from_string("B9C4CE"))
    return s


def s_outline(prs, n, total):
    s = blank(prs)
    slide_title(s, "Outline")
    items = ["Introduction", "Problem Statement", "Literature Review",
             "Proposed Solution", "System Architecture", "Use Case Diagram",
             "Data Flow Diagrams (Level 0 / 0.1)", "Methodology",
             "Functional & Non-Functional Requirements", "Hardware & Software Requirements",
             "Results & Tests", "Conclusion", "Future Scope", "References"]
    half = (len(items) + 1) // 2
    cols = [items[:half], items[half:]]
    x = Inches(0.9)
    for ci, col in enumerate(cols):
        box = s.shapes.add_textbox(Inches(0.9) + ci * Inches(6.0), Inches(2.0),
                                   Inches(5.6), Inches(4.6))
        tf = box.text_frame; tf.word_wrap = True
        first = True
        for i, it in enumerate(col):
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            r = p.add_run(); r.text = f"{ci*half + i + 1}.  {it}"
            r.font.size = Pt(17); r.font.color.rgb = C_TEXT; r.font.name = "Calibri"
            p.space_after = Pt(10)
    footer(s, n, total)
    return s


def s_intro(prs, n, total):
    s = blank(prs)
    section_bar(s, "INTRODUCTION")
    slide_title(s, "Migrant workers fall through the cracks of welfare support")
    # Left: problem/motivation
    card(s, Inches(0.6), Inches(2.1), Inches(5.9), Inches(4.3))
    tb(s, Inches(0.95), Inches(2.3), Inches(5.2), Inches(0.4), "Background",
       size=Pt(15), color=C_ORANGE, bold=True)
    bullet_box(s, Inches(0.95), Inches(2.8), Inches(5.3), Inches(3.4), [
        "Welfare information is scattered across official portals and offices.",
        "Language and digital-literacy barriers limit access.",
        "Workers rarely know the correct grievance channel.",
        "General chatbots answer without citing any source.",
    ], size=Pt(14))
    tb(s, Inches(0.95), Inches(5.75), Inches(5.2), Inches(0.5),
       "Motivation:  make rights and welfare guidance easy to reach — multilingual, mobile-first, source-grounded.",
       size=Pt(12), color=C_MUT, italic=True)
    # Right: scope/objectives
    card(s, Inches(6.8), Inches(2.1), Inches(5.9), Inches(4.3), fill="FDF9F3")
    tb(s, Inches(7.15), Inches(2.3), Inches(5.2), Inches(0.4), "Scope & Objectives",
       size=Pt(15), color=C_ORANGE, bold=True)
    bullet_box(s, Inches(7.15), Inches(2.8), Inches(5.4), Inches(3.4), [
        "One worker-facing access point (PWA, six languages).",
        "Official-source question answering — every answer cites its document.",
        "Worker-owned records: document wallet, employment & wage diary.",
        "Grievance filing routed to jurisdiction-scoped officials.",
    ], size=Pt(14))
    footer(s, n, total)
    return s


def s_problem(prs, n, total):
    s = blank(prs)
    section_bar(s, "PROBLEM STATEMENT")
    slide_title(s, "The gap the platform closes")
    problems = [
        ("Scattered sources", "Scheme, law and portal information lives in different departments and formats."),
        ("Language barrier", "Most official content exists only in English or Hindi."),
        ("Untrusted answers", "Generic chatbots may give confident but unsupported answers."),
        ("Unknown channels", "Workers cannot identify where to raise a grievance, or track it afterwards."),
    ]
    for i, (h, d) in enumerate(problems):
        x = Inches(0.6) + (i % 2) * Inches(6.2)
        y = Inches(2.0) + (i // 2) * Inches(1.75)
        card(s, x, y, Inches(5.9), Inches(1.55))
        tb(s, x + Inches(0.35), y + Inches(0.18), Inches(5.2), Inches(0.4), h,
           size=Pt(16), color=C_DARK, bold=True)
        tb(s, x + Inches(0.35), y + Inches(0.62), Inches(5.2), Inches(0.85), d,
           size=Pt(13), color=C_TEXT)
    band = card(s, Inches(0.6), Inches(5.75), Inches(12.1), Inches(0.95), fill=C_DARK, line=C_DARK)
    tb(s, Inches(0.95), Inches(5.95), Inches(11.4), Inches(0.6),
       "ShramSetu:  one entry point  →  answers grounded in indexed official documents  →  explicit no-match when evidence is insufficient  →  tracked grievance routing.",
       size=Pt(14), color=RGBColor.from_string("FFFFFF"))
    footer(s, n, total)
    return s


def s_lit1(prs, n, total):
    s = blank(prs)
    section_bar(s, "LITERATURE REVIEW  (1/2)")
    slide_title(s, "Prior worker-support systems")
    rows = [
        ("Migrant Care (2025)", "Next.js, Convex, Firebase auth, multilingual UI, complaint alerts.",
         "Registration 300 ms; complaint submission 450 ms; language switch < 100 ms.",
         "No voice input or offline mode."),
        ("Enhancing Oversight & Support (2026)", "Next.js, Python, MySQL; QR profiles, insurance, job search, grievance redressal.",
         "No explicit accuracy metrics; administration-focused.",
         "Limited performance transparency."),
        ("Job Bridge (2025)", "Web job portal, Flask, MySQL, AI skill matching, Google Translate.",
         "Qualitative improvements reported; no numerical accuracy.",
         "Basic matching; untested scalability."),
    ]
    y0 = Inches(2.0)
    widths = [Inches(2.6), Inches(3.9), Inches(3.0), Inches(2.7)]
    heads = ["Paper", "Methodology", "Reported evaluation", "Gap / relevance"]
    x = Inches(0.6)
    for w, h in zip(widths, heads):
        tb(s, x, y0, w, Inches(0.4), h, size=Pt(13), color=C_ORANGE, bold=True)
        x += w
    y = Inches(2.5)
    for name, meth, ev, gap in rows:
        x = Inches(0.6)
        vals = [name, meth, ev, gap]
        for w, v in zip(widths, vals):
            tb(s, x, y, w, Inches(1.3), v, size=Pt(12))
            x += w
        y += Inches(1.45)
    footer(s, n, total)
    return s


def s_lit2(prs, n, total):
    s = blank(prs)
    section_bar(s, "LITERATURE REVIEW  (2/2)")
    slide_title(s, "RAG and e-government systems — what they lack")
    rows = [
        ("RAG-Based QA for Personalized Databases (2024)", "SQL, Chroma, LangChain, MongoDB history; RAGAS model/embedding comparisons.",
         "Faithfulness 0.51, relevancy 0.86, precision 0.79 (best combo).",
         "Single organisation's data; motivates source-grounded evidence."),
        ("E-Government Chatbots (2023)", "PRISMA review, deployed chatbot survey, Dialogflow prototypes.",
         "Task completion 100% vs 66.7% portal baseline in one test.",
         "Validation need; motivates tested grounding."),
        ("AI-Powered Local Worker Marketplace (2026)", "React, Node.js, Supabase, Redis, Socket.IO; rule-based chatbot.",
         "91%+ intent accuracy; response time 340 ms → 82 ms with Redis.",
         "Rule-based only; motivates RAG with citations."),
    ]
    y0 = Inches(2.0)
    widths = [Inches(2.6), Inches(3.9), Inches(3.0), Inches(2.7)]
    heads = ["Paper", "Methodology", "Reported evaluation", "Gap / relevance"]
    x = Inches(0.6)
    for w, h in zip(widths, heads):
        tb(s, x, y0, w, Inches(0.4), h, size=Pt(13), color=C_ORANGE, bold=True)
        x += w
    y = Inches(2.5)
    for name, meth, ev, gap in rows:
        x = Inches(0.6)
        for w, v in zip(widths, [name, meth, ev, gap]):
            tb(s, x, y, w, Inches(1.3), v, size=Pt(12))
            x += w
        y += Inches(1.45)
    footer(s, n, total)
    return s


def s_solution(prs, n, total):
    s = blank(prs)
    section_bar(s, "PROPOSED SOLUTION  (1/2)")
    slide_title(s, "System approach — ask, retrieve, ground, refuse")
    steps = [
        "Select language and authenticate (OTP / password, JWT).",
        "Ask questions by text or voice.",
        "Retrieve relevant passages from indexed official documents (FAISS).",
        "Generate an answer constrained to retrieved evidence (similarity gate + BM25/RRF + LLM).",
        "Show source metadata — or return an explicit no-match when evidence is insufficient.",
    ]
    y = Inches(1.95)
    for i, st in enumerate(steps, 1):
        num = s.shapes.add_shape(9, Inches(0.7), y, Inches(0.5), Inches(0.5))  # oval
        num.fill.solid(); num.fill.fore_color.rgb = C_ORANGE; num.line.fill.background()
        tfn = num.text_frame; pn = tfn.paragraphs[0]; rn = pn.add_run()
        rn.text = str(i); rn.font.size = Pt(16); rn.font.bold = True; rn.font.color.rgb = RGBColor.from_string("FFFFFF")
        tb(s, Inches(1.4), y + Inches(0.03), Inches(6.4), Inches(0.5), st, size=Pt(14.5))
        y += Inches(0.78)
    # right: modules
    card(s, Inches(8.1), Inches(1.95), Inches(4.6), Inches(4.6), fill="FDF9F3")
    tb(s, Inches(8.45), Inches(2.15), Inches(4.0), Inches(0.4), "Supporting modules", size=Pt(15),
       color=C_ORANGE, bold=True)
    bullet_box(s, Inches(8.45), Inches(2.65), Inches(4.0), Inches(3.7), [
        "Encrypted worker document wallet (AES-256-GCM, wrapped keys).",
        "Portable employment & salary (wage diary) records.",
        "Grievance submission with validated attachments.",
        "Category-aware routing to jurisdiction-scoped officials.",
        "Source traceability + PII-stripped privacy controls.",
    ], size=Pt(12.5))
    footer(s, n, total)
    return s


def s_principles(prs, n, total):
    s = blank(prs)
    section_bar(s, "PROPOSED SOLUTION  (2/2)")
    slide_title(s, "Core design principles")
    cards = [
        ("Mobile-first PWA", "React + TypeScript, installable, code-split (entry JS 592 → 406 kB)."),
        ("Six languages", "English, Hindi, Bengali, Telugu, Tamil, Malayalam — parity-tested bundles."),
        ("Two separate corpora", "Public government knowledge is indexed; private worker documents stay encrypted under the worker's account."),
        ("Explicit no-match", "Retrieval threshold (0.45) refuses off-topic questions before the LLM; insufficient evidence => 'could not find', never a guess."),
        ("Informational support only", "Official verification and legal decisions remain with the authorities — stated on every answer."),
    ]
    y = Inches(2.0)
    for h, d in cards:
        card(s, Inches(0.9), y, Inches(11.5), Inches(0.88))
        tb(s, Inches(1.25), y + Inches(0.12), Inches(3.4), Inches(0.6), h, size=Pt(15),
           color=C_DARK, bold=True)
        tb(s, Inches(4.8), y + Inches(0.14), Inches(7.4), Inches(0.65), d, size=Pt(12.5))
        y += Inches(1.02)
    footer(s, n, total)
    return s


def s_arch(prs, n, total):
    s = blank(prs)
    section_bar(s, "SYSTEM ARCHITECTURE")
    slide_title(s, "Three-service, polyglot architecture (as built)")
    # Three boxes in a chain + DB below
    def svcbox(x, y, w, h, title, lines, fill, line):
        b = card(s, x, y, w, h, fill=fill, line=line)
        tb(s, x + Inches(0.25), y + Inches(0.12), w - Inches(0.4), Inches(0.35),
           title, size=Pt(14), color=C_DARK, bold=True)
        bullet_box(s, x + Inches(0.25), y + Inches(0.55), w - Inches(0.45), h - Inches(0.7),
                   lines, size=Pt(11), gap=3)
        return b
    y = Inches(2.0)
    svcbox(Inches(0.6), y, Inches(3.7), Inches(2.3), "Frontend  ·  PWA",
           ["React 18 + TypeScript", "Vite + Tailwind", "i18n: 6 languages",
            "16 lazy-loaded pages", "Talks only to /api (JWT)"], "FDF9F3", "E4DED2")
    svcbox(Inches(4.8), y, Inches(3.7), Inches(2.3), "API server  ·  :8000",
           ["Node 22 + Express 4", "Mongoose 8 → MongoDB", "OTP/JWT auth, rate limits",
            "Fail-closed jurisdiction scoping", "AES-256-GCM document wallet"], "FDF9F3", "E4DED2")
    svcbox(Inches(9.0), y, Inches(3.7), Inches(2.3), "AI service  ·  :8100",
           ["Python 3.10 + FastAPI", "FAISS + multilingual embeddings", "0.45 gate → BM25/RRF → Groq",
            "STT faster-whisper + TTS local", "PII stripped pre-provider"], "FDF9F3", "E4DED2")
    # arrows
    for x1 in (4.35, 8.55):
        ar = s.shapes.add_shape(13, Inches(x1), y + Inches(1.0), Inches(0.42), Inches(0.3))
        ar.fill.solid(); ar.fill.fore_color.rgb = C_ORANGE; ar.line.fill.background()
    tb(s, Inches(4.25), y + Inches(1.4), Inches(0.6), Inches(0.3), "JWT", size=Pt(10), color=C_MUT, align=1)
    tb(s, Inches(8.45), y + Inches(1.4), Inches(0.75), Inches(0.3), "X-Internal-Key", size=Pt(10),
       color=C_MUT, align=1)
    # DB row
    db = card(s, Inches(4.8), Inches(4.75), Inches(3.7), Inches(1.15), fill="E8F0FE", line="4285F4")
    tb(s, Inches(5.05), Inches(4.9), Inches(3.3), Inches(0.9),
       "MongoDB :27017 — workers, grievances, documents, wages, notifications, audit log",
       size=Pt(12), color=C_DARK)
    ar = s.shapes.add_shape(3, Inches(6.45), Inches(4.42), Inches(0.3), Inches(0.3))
    ar.fill.solid(); ar.fill.fore_color.rgb = RGBColor.from_string("4285F4"); ar.line.fill.background()
    # external providers
    ext = card(s, Inches(9.0), Inches(4.75), Inches(3.7), Inches(1.15), fill="FEF7E0", line="F9AB00")
    tb(s, Inches(9.25), Inches(4.9), Inches(3.3), Inches(0.9),
       "External: Groq (LLM) → Gemini fallback · local Whisper STT · local MMS/IndicParler TTS",
       size=Pt(12), color=C_DARK)
    # key design points
    card(s, Inches(0.6), Inches(4.75), Inches(3.7), Inches(1.15), fill="F3FAF7", line="BFE3D4")
    tb(s, Inches(0.85), Inches(4.9), Inches(3.3), Inches(0.9),
       "Design: browser never calls the AI service; provider keys stay server-side; AI service is stateless (no DB).",
       size=Pt(11.5), color=C_DARK)
    tb(s, Inches(0.6), Inches(6.15), Inches(12.1), Inches(0.7),
       "Requests: Browser ──JWT──▶ Express (auth → rate-limit → route) ──Mongoose──▶ MongoDB   ·   Express ──X-Internal-Key──▶ FastAPI (PII strip → translate → FAISS → gate → Groq)",
       size=Pt(11), color=C_MUT)
    footer(s, n, total)
    return s


def s_usecase(prs, n, total):
    s = blank(prs)
    section_bar(s, "USE CASE DIAGRAM")
    slide_title(s, "Actors and their verified capabilities")

    def actor(x, y, name, items, fill="FDF9F3"):
        card(s, x, y, Inches(5.9), Inches(2.25), fill=fill)
        tb(s, x + Inches(0.3), y + Inches(0.1), Inches(5.3), Inches(0.35), name,
           size=Pt(15), color=C_DARK, bold=True)
        bullet_box(s, x + Inches(0.3), y + Inches(0.5), Inches(5.5), Inches(1.7),
                   items, size=Pt(11.5), gap=2)

    actor(Inches(0.6), Inches(2.0), "Worker", [
        "Register (OTP) · choose language · ask by text or voice · hear answers",
        "Upload documents (encrypted wallet) · wage diary · QR ID",
        "File & track grievances · read notifications",
    ])
    actor(Inches(6.8), Inches(2.0), "Government official", [
        "Dashboard scoped by state / district (fail-closed, 404 on out-of-scope)",
        "Act on grievances within workflow + SLA",
        "Send notifications to own jurisdiction only (403 otherwise)",
    ])
    actor(Inches(0.6), Inches(4.45), "Superadmin",
          ["Full access + audit logs + officials monitoring"])
    actor(Inches(6.8), Inches(4.45), "RAG assistant (system)",
          ["Retrieve from official corpus · enforce 0.45 gate",
           "Answer with citations or refuse (grounded = false)"], fill="F3FAF7")
    tb(s, Inches(0.6), Inches(6.75), Inches(12.1), Inches(0.4),
       "Every edge maps to a tested route in server/src/routes/ (49 server tests · 92 AI tests · 50 frontend tests).",
       size=Pt(11), color=C_MUT, italic=True)
    footer(s, n, total)
    return s


def s_dfd0(prs, n, total):
    s = blank(prs)
    section_bar(s, "DATA FLOW — LEVEL 0")
    slide_title(s, "Context diagram")
    def dfdbox(x, y, w, h, name, fill="FDF9F3", line="E4DED2"):
        b = card(s, x, y, w, h, fill=fill, line=line)
        tb(s, x + Inches(0.25), y + Inches(0.55), w - Inches(0.5), Inches(0.4), name,
           size=Pt(14), color=C_DARK, bold=True, align=1)
        return b
    dfdbox(Inches(0.8), Inches(2.3), Inches(3.1), Inches(1.3), "Worker")
    dfdbox(Inches(0.8), Inches(4.3), Inches(3.1), Inches(1.3), "Official / Admin")
    dfdbox(Inches(5.1), Inches(3.3), Inches(3.1), Inches(1.5), "ShramSetu\nplatform", fill=C_DARK, line=C_DARK)
    tb(s, Inches(5.1), Inches(3.45), Inches(3.1), Inches(0.4), "ShramSetu platform",
       size=Pt(14), color=RGBColor.from_string("FFFFFF"), bold=True, align=1)
    dfdbox(Inches(9.4), Inches(2.3), Inches(3.1), Inches(1.3), "Official document corpus (RAG)")
    dfdbox(Inches(9.4), Inches(4.3), Inches(3.1), Inches(1.3), "AI providers · notification inbox")
    # flows
    flows = [
        (Inches(3.9), Inches(2.75), "questions, uploads, grievances"),
        (Inches(3.9), Inches(4.85), "reviews, notifications, scope filters"),
        (Inches(8.2), Inches(2.75), "retrieve passages (cited)"),
        (Inches(8.2), Inches(4.85), "LLM · STT · TTS calls"),
    ]
    for x, yy, label in flows:
        ar = s.shapes.add_shape(13 if x < Inches(8) else 12, x, yy, Inches(1.2), Inches(0.28))
        ar.fill.solid(); ar.fill.fore_color.rgb = C_ORANGE; ar.line.fill.background()
        tb(s, x - Inches(0.3), yy + Inches(0.32), Inches(1.9), Inches(0.3), label,
           size=Pt(9.5), color=C_MUT, align=1)
    footer(s, n, total)
    return s


def s_dfd01(prs, n, total):
    s = blank(prs)
    section_bar(s, "DATA FLOW — LEVEL 0.1")
    slide_title(s, "Main processes inside the platform")
    procs = [
        ("1 · Access & identity", "OTP / JWT authentication, language profile"),
        ("2 · Assistant (RAG)", "PII strip → translate → FAISS → 0.45 gate → Groq answer + citations"),
        ("3 · Records", "Document wallet (AES-256-GCM) · wage diary · QR ID"),
        ("4 · Grievances", "Category capture → jurisdiction-scoped official queue → status + SLA"),
        ("5 · Notifications", "In-app inbox scoped per worker · audit log for officials"),
    ]
    y = Inches(2.0)
    for h, d in procs:
        card(s, Inches(0.9), y, Inches(11.5), Inches(0.85))
        tb(s, Inches(1.25), y + Inches(0.13), Inches(3.6), Inches(0.55), h, size=Pt(15),
           color=C_DARK, bold=True)
        tb(s, Inches(5.0), y + Inches(0.16), Inches(7.2), Inches(0.6), d, size=Pt(12.5))
        y += Inches(0.98)
    footer(s, n, total)
    return s


def s_method(prs, n, total):
    s = blank(prs)
    section_bar(s, "METHODOLOGY")
    slide_title(s, "Ten steps — as implemented")
    col1 = [
        ("1", "Language + access", "choose language; OTP / JWT authentication"),
        ("2", "Query intake", "typed question or faster-whisper voice transcription"),
        ("3", "Knowledge prep", "extract, clean, chunk, index with provenance (source URL, verified date, status)"),
        ("4", "Semantic retrieval", "embed query, FAISS top-k over 62 active docs"),
        ("5", "Evidence check", "0.45 similarity gate; explicit no-match when below"),
    ]
    col2 = [
        ("6", "Grounded response", "LLM answers from context with source, department, freshness"),
        ("7", "Worker records", "encrypted wallet + employment + wage entries"),
        ("8", "Grievance workflow", "category, description, evidence → jurisdiction-scoped official queue"),
        ("9", "Persistence & security", "authenticated APIs; owner-based access; PII stripped pre-provider"),
        ("10", "Evaluation", "retrieval, grounding, refusals, multilingual, security, latency"),
    ]
    for ci, col in enumerate([col1, col2]):
        x = Inches(0.7) + ci * Inches(6.25)
        y = Inches(2.0)
        for num, h, d in col:
            n_ = s.shapes.add_shape(9, x, y, Inches(0.42), Inches(0.42))
            n_.fill.solid(); n_.fill.fore_color.rgb = C_ORANGE; n_.line.fill.background()
            tfn = n_.text_frame; pn = tfn.paragraphs[0]; rn = pn.add_run()
            rn.text = num; rn.font.size = Pt(13); rn.font.bold = True; rn.font.color.rgb = RGBColor.from_string("FFFFFF")
            tb(s, x + Inches(0.55), y - Inches(0.03), Inches(5.3), Inches(0.35), h,
               size=Pt(14), color=C_DARK, bold=True)
            tb(s, x + Inches(0.55), y + Inches(0.3), Inches(5.4), Inches(0.55), d,
               size=Pt(11.5), color=C_TEXT)
            y += Inches(0.92)
    footer(s, n, total)
    return s


def s_requirements(prs, n, total):
    s = blank(prs)
    section_bar(s, "REQUIREMENTS")
    slide_title(s, "Functional & non-functional")
    card(s, Inches(0.6), Inches(1.95), Inches(5.9), Inches(4.6))
    tb(s, Inches(0.95), Inches(2.1), Inches(5.2), Inches(0.4), "Functional",
       size=Pt(15), color=C_ORANGE, bold=True)
    bullet_box(s, Inches(0.95), Inches(2.6), Inches(5.4), Inches(3.9), [
        "Register / authenticate workers and officials; preferred language.",
        "Answer text and voice questions from indexed official sources.",
        "Show source details; refuse explicitly on insufficient evidence.",
        "Secure upload and management of personal documents.",
        "Maintain employment and salary (wage) records.",
        "Evidence-backed grievances routed by category + jurisdiction.",
    ], size=Pt(12.5))
    card(s, Inches(6.8), Inches(1.95), Inches(5.9), Inches(4.6), fill="FDF9F3")
    tb(s, Inches(7.15), Inches(2.1), Inches(5.2), Inches(0.4), "Non-functional",
       size=Pt(15), color=C_ORANGE, bold=True)
    bullet_box(s, Inches(7.15), Inches(2.6), Inches(5.4), Inches(3.9), [
        "Security — JWT sessions, hashed credentials, owner-based access, fail-closed scoping.",
        "Privacy — private files separate from the public RAG corpus; PII stripped before providers.",
        "Reliability — refuse != failure; health liveness/readiness split.",
        "Usability — mobile-first, multilingual, voice accessible.",
        "Maintainability — modular client / API / data / AI services.",
        "Traceability — source metadata and index dates preserved.",
    ], size=Pt(12.5))
    footer(s, n, total)
    return s


def s_hw(prs, n, total):
    s = blank(prs)
    section_bar(s, "HARDWARE REQUIREMENTS")
    slide_title(s, "Enough to build and demo on commodity hardware")
    bullet_box(s, Inches(0.9), Inches(2.1), Inches(11.5), Inches(4.3), [
        "Client device — Android / iOS phone or any modern desktop browser (PWA).",
        "Development system — 64-bit multi-core PC (React/TS + Python builds + model loading).",
        "Backend host — CPU-only server: Node 22 (API) + Python 3.10 (AI service) + MongoDB.",
        "Storage — persistent volume for app data, uploaded documents (AES-256-GCM at rest) and the indexed corpus / FAISS index.",
        "Network — internet for provider calls (Groq) ; STT and TTS run locally, no key needed.",
    ], size=Pt(14.5), gap=10)
    footer(s, n, total)
    return s


def s_sw(prs, n, total):
    s = blank(prs)
    section_bar(s, "SOFTWARE REQUIREMENTS")
    slide_title(s, "Stack as built (each line verified in the repo)")
    rows = [
        ("Web client", "React 18 + TypeScript + Vite + Tailwind CSS — PWA, code-split"),
        ("Backend / API", "Node.js 22 + Express 4 + JWT auth + helmet + per-route rate limits"),
        ("Persistence", "MongoDB (Mongoose 8) — embedded dev instance or Docker volume in production"),
        ("Retrieval & AI", "LangChain, Sentence-Transformers (multilingual MiniLM), FAISS, Groq LLM (Gemini fallback)"),
        ("Speech", "faster-whisper STT (local, per-language checkpoints) · AI4Bharat IndicParler-TTS with local MMS VITS fallback"),
        ("Notifications", "In-app worker inbox + government broadcast (FCM token endpoint ready for real push)"),
        ("Quality tooling", "pytest (92), vitest (49 server + 50 frontend), 34 live E2E checks, RAG eval harness"),
    ]
    y = Inches(2.05)
    for h, d in rows:
        tb(s, Inches(1.0), y, Inches(2.6), Inches(0.5), h, size=Pt(14), color=C_DARK, bold=True)
        tb(s, Inches(3.8), y, Inches(8.6), Inches(0.6), d, size=Pt(13))
        y += Inches(0.66)
    footer(s, n, total)
    return s


def s_results_head(prs, n, total, page=1):
    s = blank(prs)
    section_bar(s, "RESULTS")
    if page == 1:
        slide_title(s, "Retrieval evaluation — headline numbers")
        metric_cards = [
            ("hit@1", "94 %", "46 / 49 factual questions answered from the right document"),
            ("hit@3", "98 %", "48 / 49 — correct document inside the top three"),
            ("Refusals", "12 / 13", "off-topic & prompt-injection questions refused at the 0.45 gate (92 %)"),
        ]
        for i, (h, v, d) in enumerate(metric_cards):
            x = Inches(0.7) + i * Inches(4.1)
            card(s, x, Inches(2.1), Inches(3.8), Inches(2.2), fill="F3FAF7", line="BFE3D4")
            tb(s, x + Inches(0.3), Inches(2.3), Inches(3.2), Inches(0.5), h,
               size=Pt(16), color=C_MUT, bold=True)
            tb(s, x + Inches(0.3), Inches(2.75), Inches(3.2), Inches(0.9), v,
               size=Pt(40), color=C_GREEN, bold=True)
            tb(s, x + Inches(0.3), Inches(3.7), Inches(3.25), Inches(0.6), d,
               size=Pt(11.5), color=C_TEXT)
        card(s, Inches(0.7), Inches(4.75), Inches(12.0), Inches(1.7), fill="FDF9F3")
        tb(s, Inches(1.0), Inches(4.9), Inches(11.4), Inches(0.4),
           "Corpus & harness", size=Pt(14), color=C_ORANGE, bold=True)
        tb(s, Inches(1.0), Inches(5.35), Inches(11.5), Inches(1.0),
           "62 active official documents indexed (11 repealed, marked superseded, kept out of retrieval) · multilingual 70-question suite across all six languages · hybrid dense + BM25/RRF ranking · reproducible run: python eval/run_eval.py (~30 s, no API key needed in retrieval-only mode)",
           size=Pt(12.5), color=C_TEXT)
    elif page == 2:
        slide_title(s, "Safety, tests and honest limits")
        card(s, Inches(0.6), Inches(1.95), Inches(5.9), Inches(2.1), fill="F3FAF7", line="BFE3D4")
        tb(s, Inches(0.9), Inches(2.05), Inches(5.4), Inches(0.4), "End-to-end safety (live LLM)",
           size=Pt(14), color=C_DARK, bold=True)
        tb(s, Inches(0.9), Inches(2.5), Inches(5.4), Inches(1.4),
           "10 / 10: every off-topic, prompt-injection and compound 'reveal your secrets + do X' request refused by the grounded flag with zero system errors (RESULTS_FULL.md).",
           size=Pt(12))
        card(s, Inches(6.8), Inches(1.95), Inches(5.9), Inches(2.1))
        tb(s, Inches(7.1), Inches(2.05), Inches(5.4), Inches(0.4), "Test suites (all green in CI)",
           size=Pt(14), color=C_DARK, bold=True)
        tb(s, Inches(7.1), Inches(2.5), Inches(5.4), Inches(1.4),
           "Server 49 · AI service 92 · frontend 50 · 34 live end-to-end checks incl. wage round trip + paid-day lock + jurisdiction 403/404. CI gates all four.",
           size=Pt(12))
        card(s, Inches(0.6), Inches(4.3), Inches(12.1), Inches(2.2), fill="FEF7E0", line="F9AB00")
        tb(s, Inches(0.95), Inches(4.45), Inches(11.3), Inches(0.4),
           "Honest limits — stated before you ask", size=Pt(14), color=C_DARK, bold=True)
        bullet_box(s, Inches(0.95), Inches(4.9), Inches(11.3), Inches(1.55), [
            "The one remaining hit@3 miss is a measured translation failure (MGNREGA name mangled) — hand-translated query retrieves the right doc at 0.641 top-1; fixed via translation, not by lowering the 0.45 gate.",
            "8 in-domain 'unanswerable' questions are refused by the LLM's grounded flag; retrieval-only mode cannot measure them (live-LLM run pending in chunks).",
            "No real SMS gateway (dev OTP prints to terminal), in-memory rate limits, ~30 s cold start bounded at 90 s.",
        ], size=Pt(11.5), gap=4)
    footer(s, n, total)
    return s


def s_conclusion(prs, n, total):
    s = blank(prs)
    section_bar(s, "CONCLUSION")
    slide_title(s, "One platform, evidence-first")
    bullet_box(s, Inches(0.9), Inches(2.1), Inches(11.6), Inches(3.9), [
        "Every AI answer is either grounded in a cited, dated official document or explicitly refused — no guesses.",
        "Worker records live encrypted under the worker's own account (AES-256-GCM, wrapped keys).",
        "Grievances reach officials with enforceable, tested jurisdiction over the filing location.",
        "Six languages, voice in/out, PII stripped before any external provider call.",
        "The platform facilitates access — it deliberately does not replace official verification, legal advice, or authority decisions.",
    ], size=Pt(15), gap=10)
    card(s, Inches(0.9), Inches(5.9), Inches(11.6), Inches(0.9), fill=C_DARK, line=C_DARK)
    tb(s, Inches(1.25), Inches(6.05), Inches(11.0), Inches(0.6),
       '"It makes the evidence reachable — not the decision for you."',
       size=Pt(15), color=RGBColor.from_string("FFFFFF"), italic=True, align=1)
    footer(s, n, total)
    return s


def s_future(prs, n, total):
    s = blank(prs)
    section_bar(s, "FUTURE SCOPE")
    slide_title(s, "What we would do next, in order")
    items = [
        ("Translation layer for scheme names", "entity-aware glossary (MGNREGA, PMSBY…) across six languages — turns the one known hit@3 miss into a hit."),
        ("Live-LLM eval completion", "finish --full run so the 8 in-domain refusals have a measured number."),
        ("Reranking + stronger multilingual embeddings", "cross-encoder reranking of the FAISS top-24 pool."),
        ("Automated corpus refresh", "scheduled re-ingest with freshness alerts + superseded-law drift checks."),
        ("Real integrations", "SMS gateway for OTPs, FCM push, verified government API where available, offline sync."),
        ("Browser E2E suite + field evaluation", "Playwright over the OTP → grievance → resolution loop; grounding/usability study with workers."),
    ]
    y = Inches(2.0)
    for h, d in items:
        card(s, Inches(0.9), y, Inches(11.5), Inches(0.78))
        tb(s, Inches(1.2), y + Inches(0.08), Inches(4.6), Inches(0.6), h, size=Pt(13.5),
           color=C_DARK, bold=True)
        tb(s, Inches(6.0), y + Inches(0.1), Inches(6.2), Inches(0.6), d, size=Pt(11.5))
        y += Inches(0.87)
    footer(s, n, total)
    return s


def s_references(prs, n, total):
    s = blank(prs)
    section_bar(s, "REFERENCES")
    slide_title(s, "Cited works")
    refs = [
        "[1] V. Veeresh et al., \"Migrant Care: A Web-based Support System for Migrant Workers,\" Journal of Information Technology and Digital World, vol. 7, no. 1, pp. 42–55, 2025.",
        "[2] A. K., \"Enhancing Oversight and Support: A Web-Based Management System for Migrant Workers,\" International Journal of Creative and Open Research in Engineering and Management, vol. 2, no. 6, 2026.",
        "[3] Y. Vaishnavi and S. R. Kunchala, \"Job Bridge: An AI-Powered Platform Connecting Skilled Workers with Employment Opportunities,\" International Journal of Research Publication and Reviews, vol. 6, no. 8, pp. 5295–5301, 2025.",
        "[4] J. Byun, B. Kim, K.-A. Cha, and E. Lee, \"Design and Implementation of an Interactive Question-Answering System with Retrieval-Augmented Generation for Personalized Databases,\" Applied Sciences, vol. 14, p. 7995, 2024.",
        "[5] M. E. Cortés-Cediel et al., \"Trends and challenges of e-government chatbots,\" Government Information Quarterly, vol. 40, p. 101877, 2023.",
        "[6] Y. A. Palode et al., \"AI-Powered Local Worker & Service Marketplace,\" International Journal for Research in Applied Science & Engineering Technology, vol. 14, no. 4, 2026.",
    ]
    box = s.shapes.add_textbox(Inches(0.9), Inches(2.0), Inches(11.6), Inches(4.6))
    tf = box.text_frame; tf.word_wrap = True
    first = True
    for ref in refs:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        r = p.add_run(); r.text = ref
        r.font.size = Pt(13); r.font.color.rgb = C_TEXT; r.font.name = "Calibri"
        p.space_after = Pt(12)
    footer(s, n, total)
    return s


def build() -> Presentation:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    builders = [
        s_title, s_outline, s_intro, s_problem, s_lit1, s_lit2, s_solution,
        s_principles, s_arch, s_usecase, s_dfd0, s_dfd01, s_method,
        s_requirements, s_hw, s_sw, s_results_head,
    ]
    for b in builders:
        b(prs, 0, 0)
    s_results_head(prs, 0, 0, page=2)
    others = [s_conclusion, s_future, s_references]
    for b in others:
        b(prs, 0, 0)
    footer_all(prs)
    return prs


def footer_all(prs):
    total = len(prs.slides._sldIdLst)
    for n, s in enumerate(prs.slides, start=1):
        # find placeholder footers if any (None); we simply add page numbers
        if n == 1:
            continue
        tb(s, Inches(12.35), Inches(7.08), Inches(0.6), Inches(0.3), f"{n} / {total}",
           size=TINY, color=C_MUT, align=2)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "docs")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    pptx_path = os.path.join(out_dir, "ShramSetu_Final_corrected.pptx")
    prs = build()
    prs.save(pptx_path)
    print("saved", pptx_path)
    if "--pdf" in sys.argv:
        export_pdf(pptx_path, out_dir)


def export_pdf(pptx_path, out_dir):
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        app = win32com.client.DispatchEx("PowerPoint.Application")
        pres = app.Presentations.Open(pptx_path, WithWindow=False)
        pdf_path = os.path.join(out_dir, "ShramSetu_Final_corrected.pdf")
        pres.SaveAs(pdf_path, 32)  # ppSaveAsPDF
        pres.Close()
        app.Quit()
        print("saved", pdf_path)
        return pdf_path
    except Exception as e:
        print("PDF export failed:", e)
        return None


if __name__ == "__main__":
    main()
