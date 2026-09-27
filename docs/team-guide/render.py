"""
Render the UstaadAssist team guide.

It reuses the backend guide's renderer (../backend-guide/render.py) for the
mini-language, the styles and the table layout, and only changes the words on
the cover and in the page header. See that file for the markup.

    python docs/team-guide/render.py docs/team-guide docs/UstaadAssist-Team-Guide.pdf
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend-guide"))
import render as base  # noqa: E402  (the backend guide's renderer)

from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import NextPageTemplate, PageBreak  # noqa: E402


class TeamGuide(base.Guide):
    def decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(base.RULE)
        canvas.setLineWidth(0.5)
        canvas.line(22 * mm, 275 * mm, 187 * mm, 275 * mm)

        canvas.setFont(base.BODY_FONT, 7.6)
        canvas.setFillColor(base.MUTED)
        canvas.drawString(22 * mm, 278 * mm, "UstaadAssist — Team Guide")
        canvas.drawRightString(187 * mm, 278 * mm, "What it is · How to use it · How it works")

        canvas.line(22 * mm, 15 * mm, 187 * mm, 15 * mm)
        canvas.drawRightString(187 * mm, 10.5 * mm, str(doc.page))
        canvas.restoreState()


TOC1 = base.style("team_toc1", fontName=base.BOLD_FONT, fontSize=9.6, leading=14.5)
TOC2 = base.style("team_toc2", fontSize=8.8, leading=12, textColor=base.MUTED, leftIndent=12)


def toc_page(entries):
    """The backend guide's contents page, spaced tighter so it fits one page."""
    flow = [base.para("Contents", "h2")]
    for level, title in entries:
        flow.append(base.Paragraph(base.inline(title), TOC1 if level == 1 else TOC2))
    return flow


def main():
    src_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])

    parts = sorted(src_dir.glob("part*.md"))
    if not parts:
        raise SystemExit(f"No part*.md files in {src_dir}")

    text = "\n\n".join(p.read_text(encoding="utf-8") for p in parts)
    flow, toc = base.parse(text)

    doc = TeamGuide(str(out), title="UstaadAssist Team Guide", author="UstaadAssist team")

    story = base.cover(
        "UstaadAssist",
        "A semester assistant for university teachers: what it does, why it exists, "
        "how to use every page, and the algorithms behind it.",
        [
            "Team guide — for testing the app and showing it to teachers",
            "React Native (Expo) · Node.js + Express · PostgreSQL · Supabase",
            "28 September 2026",
        ],
    )
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())
    story += toc_page(toc)
    story += flow

    doc.build(story)
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB), {len(toc)} headings")


if __name__ == "__main__":
    main()
