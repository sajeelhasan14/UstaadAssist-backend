/**
 * Course outline parsing — turns the text of an outline into teaching topics.
 *
 * PURE — text in, rows out. The service turns the PDF or photo into lines first.
 *
 * A line counts as a topic when it is laid out like one:
 *
 *     Week 1: Introduction to Databases
 *     Week 3-4  Normalization              -> 2 weeks
 *     Lecture 5 - SQL Joins
 *     Lectures 6-8: Transactions           -> 3 classes
 *     1. Relational Model
 *     • ER Modelling
 *
 * Headings, prose, marks tables and book lists do not have that shape, so they
 * are skipped. Exams, quizzes, assignments and holidays are skipped even when
 * they appear in the schedule, because they are not teaching.
 *
 * sessions_needed is only filled in when the outline actually says how long a
 * topic takes: a lecture range counts classes directly, and a week range is
 * multiplied by how many classes the course has each week. Otherwise it is
 * null and the planner's default of 1 applies — the teacher corrects it after
 * seeing the plan, as CLAUDE.md §1 intends.
 *
 * The result is a DRAFT for the review screen; nothing is saved from here.
 */

export type OutlineRow = {
  title: string;
  sessions_needed: number | null;
  confidence: number;
};

/** "Week 3", "Weeks 3-4", "Wk 3 to 4", "Lecture 5", "Lec 5-6", "Class 2", "Session 2". */
const SCHEDULE_LINE =
  /^(week|weeks|wk|lecture|lectures|lec|class|classes|session|sessions)\s*#?\s*(\d{1,2})(?:\s*(?:-|–|—|to|&|and)\s*(\d{1,2}))?\s*[:.)\-–—]?\s*(.*)$/i;

/** "1. Topic", "1) Topic", "• Topic", "- Topic". */
const LIST_LINE = /^(?:\d{1,2}\s*[.)]|[•●▪◦*-])\s+(.*)$/;

/** Schedule entries that are not teaching. */
const NOT_A_TOPIC =
  /\b(mid[- ]?term|midterm|final|exam|examination|quiz|quizzes|assignment|project submission|presentation[s]? due|holiday|eid|vacation|break|revision|review week|grading|marks|weightage|text ?book|reference|recommended book|learning outcome|objective|prerequisite|clo\b|plo\b)/i;

const PDF_CONFIDENCE = 0.9;
const OCR_CONFIDENCE = 0.75;

function cleanTitle(text: string): string {
  return text
    .replace(/[|[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[:.)\-–—\s]+|[:.,;\-–—\s]+$/g, "")
    .trim();
}

/**
 * @param lines          the outline's text, one entry per printed line
 * @param classesPerWeek how many classes the course has a week (its class days)
 * @param fromOcr        read from a photo, so a little less certain
 */
export function parseOutline(lines: string[], classesPerWeek: number, fromOcr = false): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const confidence = fromOcr ? OCR_CONFIDENCE : PDF_CONFIDENCE;
  const perWeek = Math.max(1, classesPerWeek);

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line === "") continue;

    let title: string | null = null;
    let sessions: number | null = null;

    const scheduled = line.match(SCHEDULE_LINE);
    if (scheduled) {
      const unit = scheduled[1].toLowerCase();
      const from = Number(scheduled[2]);
      const to = scheduled[3] ? Number(scheduled[3]) : from;
      const span = to >= from ? to - from + 1 : 1;
      title = cleanTitle(scheduled[4]);
      sessions = unit.startsWith("w") ? span * perWeek : span;
    } else {
      const listed = line.match(LIST_LINE);
      if (listed) title = cleanTitle(listed[1]);
    }

    if (!title || title.length < 3 || NOT_A_TOPIC.test(title)) continue;

    // The same topic over consecutive weeks ("Week 3: Normalization",
    // "Week 4: Normalization") is one topic that needs the combined time.
    const previous = rows[rows.length - 1];
    if (previous && previous.title.toLowerCase() === title.toLowerCase()) {
      if (previous.sessions_needed !== null && sessions !== null) previous.sessions_needed += sessions;
      continue;
    }

    rows.push({ title, sessions_needed: sessions, confidence });
  }

  return rows;
}
