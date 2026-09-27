"""
Render the UstaadAssist backend guide from a simple text source into a PDF.

Mini-language used by the .md source files:

    # Heading 1        -> chapter heading (starts a new page)
    ## Heading 2       -> section heading
    ### Heading 3      -> sub-heading
    #### Heading 4     -> small run-in heading
    plain text         -> paragraph (blank line separates)
    - item             -> bullet
    1. item            -> numbered-looking bullet (rendered as given)
    |a|b|c|            -> table row; the first row of a run is the header
    ```                -> start/end a code block
    !NOTE text         -> highlighted callout
    !WARN text         -> highlighted warning callout
    ---                -> horizontal rule
    PAGEBREAK          -> force a new page

Inline: *bold* and `code`.
"""

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

# ------------------------------------------------------------------ palette

INK = colors.HexColor("#14181F")
MUTED = colors.HexColor("#5A6472")
ACCENT = colors.HexColor("#1F6F5C")
ACCENT_SOFT = colors.HexColor("#E8F2EF")
CODE_BG = colors.HexColor("#F5F6F8")
CODE_BORDER = colors.HexColor("#DFE3E8")
RULE = colors.HexColor("#D8DDE4")
WARN_BG = colors.HexColor("#FDF2E7")
WARN_BORDER = colors.HexColor("#E8A75C")

BODY_FONT = "Helvetica"
BOLD_FONT = "Helvetica-Bold"
MONO_FONT = "Courier"

styles = getSampleStyleSheet()


def style(name, **kw):
    base = dict(
        name=name,
        fontName=BODY_FONT,
        fontSize=9.6,
        leading=14.4,
        textColor=INK,
        alignment=TA_LEFT,
        spaceBefore=0,
        spaceAfter=0,
    )
    base.update(kw)
    return ParagraphStyle(**base)


S = {
    "h1": style("h1", fontName=BOLD_FONT, fontSize=21, leading=25, textColor=ACCENT,
                spaceAfter=3),
    "h1sub": style("h1sub", fontSize=10, leading=14, textColor=MUTED, spaceAfter=12),
    "h2": style("h2", fontName=BOLD_FONT, fontSize=14, leading=18, textColor=INK,
                spaceBefore=16, spaceAfter=5),
    "h3": style("h3", fontName=BOLD_FONT, fontSize=11.2, leading=15, textColor=INK,
                spaceBefore=12, spaceAfter=4),
    "h4": style("h4", fontName=BOLD_FONT, fontSize=9.8, leading=13.5, textColor=ACCENT,
                spaceBefore=9, spaceAfter=3),
    "body": style("body", spaceAfter=7),
    "bullet": style("bullet", spaceAfter=3.5, leading=13.6),
    "note": style("note", fontSize=9.2, leading=13.4),
    "code": style("code", fontName=MONO_FONT, fontSize=8.0, leading=10.6,
                  textColor=colors.HexColor("#1B2330")),
    "th": style("th", fontName=BOLD_FONT, fontSize=8.6, leading=11.6,
                textColor=colors.white),
    "td": style("td", fontSize=8.6, leading=11.6),
    "tdmono": style("tdmono", fontName=MONO_FONT, fontSize=7.8, leading=11.2),
    "title": style("title", fontName=BOLD_FONT, fontSize=32, leading=37, textColor=INK),
    "subtitle": style("subtitle", fontSize=13, leading=19, textColor=MUTED),
    "cover_meta": style("cover_meta", fontSize=9.4, leading=15, textColor=MUTED),
    "toc1": style("toc1", fontName=BOLD_FONT, fontSize=10, leading=17),
    "toc2": style("toc2", fontSize=9.2, leading=14, textColor=MUTED, leftIndent=12),
}

# ----------------------------------------------------------------- inline


def inline(text):
    """*bold* and `code` -> reportlab inline markup. Escapes everything else."""
    out = html.escape(text, quote=False)
    out = re.sub(
        r"`([^`]+)`",
        lambda m: '<font face="%s" size="8.6" color="#0F4C3F">%s</font>'
        % (MONO_FONT, m.group(1)),
        out,
    )
    out = re.sub(r"\*([^*]+)\*", r"<b>\1</b>", out)
    return out


def para(text, key="body"):
    return Paragraph(inline(text), S[key])


# ----------------------------------------------------------------- blocks


def code_block(lines):
    text = "\n".join(lines).rstrip()
    if not text:
        return Spacer(1, 1)

    inner = Preformatted(text, S["code"])
    table = Table([[inner]], colWidths=[165 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, CODE_BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def callout(text, warn=False):
    bg = WARN_BG if warn else ACCENT_SOFT
    border = WARN_BORDER if warn else ACCENT
    body = Paragraph(inline(text), S["note"])

    table = Table([[body]], colWidths=[165 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 2.5, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def build_table(rows):
    header, *body = rows
    ncols = max(len(r) for r in rows)

    def pad(row):
        return row + [""] * (ncols - len(row))

    def cell(value, key):
        return Paragraph(inline(value), S[key])

    data = [[cell(c, "th") for c in pad(header)]]
    for row in body:
        padded = pad(row)
        data.append(
            [
                cell(c, "tdmono" if (i == 0 and ncols > 2) else "td")
                for i, c in enumerate(padded)
            ]
        )

    total = 165 * mm
    if ncols == 2:
        widths = [total * 0.34, total * 0.66]
    elif ncols == 3:
        widths = [total * 0.30, total * 0.22, total * 0.48]
    else:
        widths = [total / ncols] * ncols

    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CODE_BG]),
                ("GRID", (0, 0), (-1, -1), 0.4, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


# ------------------------------------------------------------------ parser


def parse(text):
    """Turn the mini-language into a flat list of flowables, plus TOC entries."""
    flow = []
    toc = []

    lines = text.split("\n")
    i = 0
    para_buf = []
    bullet_buf = []
    table_buf = []

    def flush_para():
        if para_buf:
            flow.append(para(" ".join(para_buf).strip()))
            para_buf.clear()

    def flush_bullets():
        if bullet_buf:
            items = [
                ListItem(Paragraph(inline(b), S["bullet"]), leftIndent=14)
                for b in bullet_buf
            ]
            flow.append(
                ListFlowable(
                    items,
                    bulletType="bullet",
                    bulletFontSize=6,
                    bulletOffsetY=1.5,
                    bulletColor=ACCENT,
                    start="square",
                    leftIndent=14,
                )
            )
            flow.append(Spacer(1, 6))
            bullet_buf.clear()

    def flush_table():
        if table_buf:
            flow.append(build_table(list(table_buf)))
            flow.append(Spacer(1, 9))
            table_buf.clear()

    def flush_all():
        flush_para()
        flush_bullets()
        flush_table()

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_all()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            flow.append(CondPageBreak(28 * mm))
            flow.append(code_block(buf))
            flow.append(Spacer(1, 9))
            continue

        if not stripped:
            flush_all()
            i += 1
            continue

        if stripped == "PAGEBREAK":
            flush_all()
            flow.append(PageBreak())
            i += 1
            continue

        if stripped == "---":
            flush_all()
            flow.append(Spacer(1, 4))
            flow.append(HRFlowable(width="100%", thickness=0.6, color=RULE))
            flow.append(Spacer(1, 8))
            i += 1
            continue

        if stripped.startswith("!NOTE "):
            flush_all()
            flow.append(callout(stripped[6:]))
            flow.append(Spacer(1, 9))
            i += 1
            continue

        if stripped.startswith("!WARN "):
            flush_all()
            flow.append(callout(stripped[6:], warn=True))
            flow.append(Spacer(1, 9))
            i += 1
            continue

        if stripped.startswith("> "):
            flush_all()
            flow.append(para(stripped[2:], "h1sub"))
            i += 1
            continue

        if stripped.startswith("#### "):
            flush_all()
            flow.append(para(stripped[5:], "h4"))
            i += 1
            continue

        if stripped.startswith("### "):
            flush_all()
            flow.append(CondPageBreak(24 * mm))
            flow.append(para(stripped[4:], "h3"))
            i += 1
            continue

        if stripped.startswith("## "):
            flush_all()
            title = stripped[3:]
            flow.append(CondPageBreak(32 * mm))
            flow.append(para(title, "h2"))
            toc.append((2, title))
            i += 1
            continue

        if stripped.startswith("# "):
            flush_all()
            title = stripped[2:]
            flow.append(PageBreak())
            flow.append(para(title, "h1"))
            flow.append(HRFlowable(width="100%", thickness=1.6, color=ACCENT,
                                   spaceBefore=2, spaceAfter=10))
            toc.append((1, title))
            i += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            flush_para()
            flush_bullets()
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if all(set(c) <= set("-: ") and c for c in cells):
                i += 1
                continue
            table_buf.append(cells)
            i += 1
            continue
        else:
            flush_table()

        if stripped.startswith("- "):
            flush_para()
            bullet_buf.append(stripped[2:])
            i += 1
            continue
        else:
            flush_bullets()

        para_buf.append(stripped)
        i += 1

    flush_all()
    return flow, toc


# ------------------------------------------------------------- page frame


class Guide(BaseDocTemplate):
    def __init__(self, path, **kw):
        super().__init__(path, pagesize=A4, **kw)

        frame = Frame(
            22 * mm, 20 * mm, 165 * mm, 250 * mm, id="body",
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        )
        cover = Frame(
            22 * mm, 20 * mm, 165 * mm, 250 * mm, id="cover",
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        )

        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[cover]),
                PageTemplate(id="body", frames=[frame], onPage=self.decorate),
            ]
        )

    def decorate(self, canvas, doc):
        canvas.saveState()

        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(22 * mm, 275 * mm, 187 * mm, 275 * mm)

        canvas.setFont(BODY_FONT, 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(22 * mm, 278 * mm, "UstaadAssist — Backend Guide")
        canvas.drawRightString(187 * mm, 278 * mm, "CS-301 · Semester Planner API")

        canvas.line(22 * mm, 15 * mm, 187 * mm, 15 * mm)
        canvas.drawRightString(187 * mm, 10.5 * mm, str(doc.page))

        canvas.restoreState()


def cover(title, subtitle, meta_lines):
    flow = [
        Spacer(1, 52 * mm),
        Paragraph(inline(title), S["title"]),
        Spacer(1, 6),
        HRFlowable(width="38%", thickness=3, color=ACCENT, hAlign="LEFT"),
        Spacer(1, 12),
        Paragraph(inline(subtitle), S["subtitle"]),
        Spacer(1, 30 * mm),
    ]
    for line in meta_lines:
        flow.append(Paragraph(inline(line), S["cover_meta"]))
    return flow


def toc_page(entries):
    flow = [para("Contents", "h2"), Spacer(1, 4)]
    for level, title in entries:
        flow.append(Paragraph(inline(title), S["toc1" if level == 1 else "toc2"]))
    return flow


def main():
    src_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])

    parts = sorted(src_dir.glob("part*.md"))
    if not parts:
        raise SystemExit(f"No part*.md files in {src_dir}")

    text = "\n\n".join(p.read_text(encoding="utf-8") for p in parts)
    flow, toc = parse(text)

    doc = Guide(str(out), title="UstaadAssist Backend Guide", author="Sajeel Hasan")

    story = cover(
        "UstaadAssist",
        "The backend, explained from zero: every file, every route, every function.",
        [
            "Node.js · Express 5 · TypeScript · PostgreSQL · raw SQL",
            "Semester planner API — Modules M1 to M7",
            "Generated 27 September 2026",
        ],
    )
    # NextPageTemplate must come BEFORE the break, because it sets the template
    # for the page that follows.
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())
    story += toc_page(toc)
    story += flow

    # The first page must use the cover template.
    doc.build(story)
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB), {len(toc)} headings")


if __name__ == "__main__":
    main()
