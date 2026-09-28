"""
Render the DAA semester project proposal in the style of the course template.

It reuses the backend guide's parser (../backend-guide/render.py) and swaps in
the template's look: Times fonts, blue headings, dark-blue table headers, and a
title block with the group table instead of a cover page.

    python docs/proposal/render.py docs/proposal docs/UstaadAssist-DAA-Proposal.pdf
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend-guide"))
import render as base  # noqa: E402  (the backend guide's renderer)

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    Frame, PageTemplate, BaseDocTemplate, Paragraph, Spacer, Table, TableStyle,
)

# ------------------------------------------------------------ template look

BLUE = colors.HexColor("#2E74B5")        # section headings in the template
HEADER = colors.HexColor("#1F3864")      # table header fill
ROW_ALT = colors.HexColor("#EAF0F7")

base.BODY_FONT = "Times-Roman"
base.BOLD_FONT = "Times-Bold"
base.ACCENT = HEADER
base.INK = colors.black

style = base.style
base.S.update({
    "h2": style("p_h2", fontName="Times-Roman", fontSize=16, leading=20, textColor=BLUE,
                spaceBefore=14, spaceAfter=6),
    "h3": style("p_h3", fontName="Times-Roman", fontSize=13, leading=16, textColor=BLUE,
                spaceBefore=11, spaceAfter=4),
    "h4": style("p_h4", fontName="Times-Bold", fontSize=11.5, leading=15, spaceBefore=8, spaceAfter=3),
    "body": style("p_body", fontSize=11, leading=15, spaceAfter=7),
    "bullet": style("p_bullet", fontSize=11, leading=14.5, spaceAfter=3),
    "note": style("p_note", fontSize=10.5, leading=14),
    "th": style("p_th", fontName="Times-Bold", fontSize=10, leading=12.5, textColor=colors.white),
    "td": style("p_td", fontSize=10, leading=12.5),
    "code": style("p_code", fontName="Courier", fontSize=8.6, leading=11,
                  textColor=colors.HexColor("#1B2330")),
})
base.S["tdmono"] = base.S["td"]  # the template's tables use plain text in every column


def inline(text):
    out = base.html.escape(text, quote=False)
    out = base.re.sub(r"`([^`]+)`", r'<font face="Courier" size="9.5">\1</font>', out)
    out = base.re.sub(r"\*([^*]+)\*", r"<b>\1</b>", out)
    return out


base.inline = inline


def build_table(rows):
    """Like the guide's tables, but a wide first column when there are many columns."""
    header, *body = rows
    ncols = max(len(r) for r in rows)
    pad = lambda row: row + [""] * (ncols - len(row))  # noqa: E731
    cell = lambda v, k: Paragraph(inline(v), base.S[k])  # noqa: E731

    data = [[cell(c, "th") for c in pad(header)]]
    data += [[cell(c, "td") for c in pad(row)] for row in body]

    total = 165 * mm
    if ncols == 2:
        widths = [total * 0.36, total * 0.64]
    elif ncols == 3:
        widths = [total * 0.34, total * 0.33, total * 0.33]
    elif ncols >= 6:
        first = total * 0.30
        widths = [first] + [(total - first) / (ncols - 1)] * (ncols - 1)
    else:
        first = total * 0.32
        widths = [first] + [(total - first) / (ncols - 1)] * (ncols - 1)

    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#8EA2BF")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


base.build_table = build_table

# ------------------------------------------------------------- the document

GROUP = [
    ("EB24210106051", "Muhammad Sajeel Hassan (Group Leader)"),
    ("EB24210106077", "Muhammad Meesum Ali"),
    ("EB24210106119", "Syed Muhammad Yaamin Ali"),
    ("EB24210106014", "Affan Bin Rashid"),
    ("EB24210106089", "Neha Nasir"),
    ("EB24210106094", "Ramsha Mirza"),
]


class Proposal(BaseDocTemplate):
    def __init__(self, path, **kw):
        super().__init__(path, pagesize=A4, **kw)
        frame = Frame(22 * mm, 20 * mm, 166 * mm, 257 * mm, id="body",
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="body", frames=[frame], onPage=self.footer)])

    def footer(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("Times-Roman", 9)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawString(22 * mm, 11 * mm, "UstaadAssist — DAA Semester Project Proposal · Group 07")
        canvas.drawRightString(188 * mm, 11 * mm, str(doc.page))
        canvas.restoreState()


def title_block():
    s = base.style
    flow = [
        Paragraph("Design and Analysis of Algorithms",
                  s("t1", fontName="Times-Bold", fontSize=22, leading=27)),
        Paragraph("Semester Project Proposal",
                  s("t2", fontName="Times-Bold", fontSize=15, leading=20, textColor=BLUE, spaceAfter=12)),
        Paragraph("UstaadAssist: Adaptive Semester Planning and Replanning for University Teachers",
                  s("t3", fontName="Times-BoldItalic", fontSize=14, leading=18, spaceAfter=6)),
        Paragraph("<b>Domain / Application Area:</b> Academic course operations — semester timetabling, "
                  "disruption replanning, assessment scheduling and grading",
                  s("t4", fontSize=11.5, leading=15, spaceAfter=10)),
        Paragraph("<b>Group 07</b>", s("t5", fontSize=11.5, leading=15, spaceAfter=4)),
    ]

    rows = [[Paragraph("Seat Number", base.S["th"]), Paragraph("Name", base.S["th"])]]
    rows += [[Paragraph(seat, base.S["td"]), Paragraph(name, base.S["td"])] for seat, name in GROUP]
    table = Table(rows, colWidths=[45 * mm, 90 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#8EA2BF")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    flow += [
        table,
        Spacer(1, 10),
        Paragraph("<b>Course:</b> Design and Analysis of Algorithms · Department of Computer Science, "
                  "University of Karachi · <b>Submission date:</b> 28 September 2026",
                  s("t6", fontSize=11.5, leading=15, spaceAfter=4)),
    ]
    return flow


def main():
    src_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])

    parts = sorted(src_dir.glob("part*.md"))
    if not parts:
        raise SystemExit(f"No part*.md files in {src_dir}")

    text = "\n\n".join(p.read_text(encoding="utf-8") for p in parts)
    flow, _toc = base.parse(text)

    doc = Proposal(str(out), title="UstaadAssist — DAA Semester Project Proposal",
                   author="Group 07")
    doc.build(title_block() + flow)
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
