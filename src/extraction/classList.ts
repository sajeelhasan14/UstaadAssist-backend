/**
 * Class list parsing — turns the text of a class list into { roll_no, name } rows.
 *
 * PURE — text in, rows out. No files, no OCR, no database. The service reads
 * the PDF or photo into lines of text first (extraction.service.ts), then calls
 * this. That keeps the part with the rules testable on its own.
 *
 * Built for the Department of Computer Science (University of Karachi) sheet:
 *
 *     S#   Seat No:        Student Name
 *     1    EB24210106003   ABDUL GHANI
 *     2    EB24210106005   ABDUL RAFAY
 *
 * The sheet is really an attendance register printed across several pages; the
 * other pages (father's names, date columns, percentages) have no seat number
 * and are skipped automatically, because a row is only a student when it
 * contains a seat number.
 *
 * Everything returned is a DRAFT for the review screen — never saved directly
 * (CLAUDE.md §3.7). A seat number that needed correcting, or a name that looks
 * damaged, gets a low confidence so the review screen highlights it.
 */

export type ClassListRow = {
  roll_no: string | null;
  name: string | null;
  /** 0–1. Below 0.8 is highlighted on the review screen. */
  confidence: number;
};

/**
 * The department's seat number: "EB" then 11 digits, e.g. EB24210106003.
 *
 * The digit part also accepts the letters OCR commonly mistakes for digits
 * (O→0, I/l→1, S→5, B→8, Z→2), and "E8" for "EB", so a slightly misread photo
 * still yields a row — corrected, and flagged for the teacher to check.
 */
const SEAT_NUMBER = /\b(E[B8])\s?([0-9OoIlSsBZ]{11})(?![0-9A-Za-z])/;

const DIGIT_FIXES: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", S: "5", s: "5", B: "8", Z: "2" };

const CLEAN_CONFIDENCE = 0.95;
const CORRECTED_CONFIDENCE = 0.6;

/** A name is letters, spaces and the odd apostrophe, hyphen or dot. */
const NAME_CHARACTERS = /^[A-Za-z][A-Za-z .'-]*$/;

/**
 * Combine several OCR readings of the same photo by voting.
 *
 * Each reading of a tilted or blurry photo fails in a different place, so no
 * single one is reliable. For each seat number, the name most readings agree on
 * wins, and the AGREEMENT becomes the confidence: a row only one reading saw,
 * or whose name the readings disagree on, is flagged for the teacher to check.
 *
 * Rows are matched by seat number AND occurrence, so a seat number genuinely
 * printed twice on the sheet (a typo in the source) stays two rows — merging
 * them would silently lose a student.
 *
 * @param readings parsed rows from each reading, best reading first (it sets the order)
 */
export function mergeReadings(readings: ClassListRow[][]): ClassListRow[] {
  type Tally = { roll_no: string; seen: number; names: Map<string, number> };
  const tallies = new Map<string, Tally>();

  for (const rows of readings) {
    const occurrence = new Map<string, number>();
    for (const row of rows) {
      if (!row.roll_no) continue;
      const n = (occurrence.get(row.roll_no) ?? 0) + 1;
      occurrence.set(row.roll_no, n);
      const key = `${row.roll_no}#${n}`;

      const tally = tallies.get(key) ?? { roll_no: row.roll_no, seen: 0, names: new Map() };
      tally.seen += 1;
      if (row.name) tally.names.set(row.name, (tally.names.get(row.name) ?? 0) + 1);
      tallies.set(key, tally);
    }
  }

  const agreeing = Math.min(2, readings.length); // with a single reading, one vote is all there is

  return [...tallies.values()].map((tally) => {
    // OCR often DROPS the space between words ("ABDULREHMAN") but almost never
    // invents one. So spellings that differ only by spaces count as one vote,
    // and the spelling with the most spaces is the one kept.
    const byLetters = new Map<string, { votes: number; best: string }>();
    for (const [name, votes] of tally.names) {
      const letters = name.replace(/\s/g, "");
      const group = byLetters.get(letters) ?? { votes: 0, best: name };
      group.votes += votes;
      if (name.split(" ").length > group.best.split(" ").length) group.best = name;
      byLetters.set(letters, group);
    }

    const ranked = [...byLetters.values()].sort((a, b) => b.votes - a.votes);
    const winner = ranked[0];
    if (!winner) return { roll_no: tally.roll_no, name: null, confidence: CORRECTED_CONFIDENCE };

    const trusted =
      tally.seen >= agreeing &&
      winner.votes >= agreeing &&
      ranked.length === 1 && // the readings disagree on the letters: let the teacher decide
      !looksMerged(winner.best);

    return { roll_no: tally.roll_no, name: winner.best, confidence: trusted ? 0.85 : CORRECTED_CONFIDENCE };
  });
}

/** A "word" of 10+ letters is almost always two words run together by OCR ("MANALFATIMA"). */
function looksMerged(name: string): boolean {
  return name.split(" ").some((word) => word.length >= 10);
}

/** Names paired by position rather than read on the same row: always worth a check. */
const PAIRED_BY_ORDER_CONFIDENCE = 0.7;

/** Sheet headings and labels that look like names but are not students. */
const HEADING =
  /\b(seat|student|father|course|signature|superior|department|university|semester|section|program|incharge|percentage|name)\b/i;

type SeatLine = { index: number; rollNo: string; corrected: boolean; inlineName: string };

/** Clean up a name as printed: letters only, single spaces, capitals like the sheet. */
function tidyName(raw: string): string {
  return raw.replace(/[^A-Za-z .'-]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

/** A line that is only a name (a split-off name column): letters, not a heading. */
function isNameOnly(line: string): boolean {
  return line.length >= 3 && NAME_CHARACTERS.test(line) && !HEADING.test(line) && !SEAT_NUMBER.test(line);
}

function readSeat(line: string, index: number): SeatLine | null {
  const match = line.match(SEAT_NUMBER);
  if (!match || match.index === undefined) return null;

  const [whole, prefix, digitPart] = match;
  const digits = digitPart.replace(/[OoIlSsBZ]/g, (ch) => DIGIT_FIXES[ch]);

  return {
    index,
    rollNo: `EB${digits}`,
    corrected: prefix !== "EB" || digits !== digitPart,
    // The name is whatever follows the seat number on the same row.
    inlineName: line.slice(match.index + whole.length).trim(),
  };
}

/**
 * Parse the lines of a class list.
 *
 * A PDF gives one line per row. OCR on a photo is messier, and produces one of
 * three shapes, all handled here:
 *
 *   1. same row      "6 EB24210106013 ABU HURAIRA SHAIKH"
 *   2. next line     "EB24210106013" / "ABU HURAIRA SHAIKH" / "EB24210106014" / ...
 *   3. columns       every seat number first, then every name, in the same order
 *
 * Shape 3 is paired by position ONLY when the counts match exactly — one
 * missed name would otherwise shift every name after it onto the wrong
 * student. Unmatched rows keep an empty name for the teacher to fill in.
 *
 * `fromOcr` caps confidence: a photo is never as certain as a PDF.
 */
export function parseClassList(lines: string[], fromOcr = false): ClassListRow[] {
  // Table borders often come through OCR as | or [ ] characters.
  const cleaned = lines.map((l) => l.replace(/[|[\]{}_]/g, " ").replace(/\s+/g, " ").trim());

  const seats: SeatLine[] = [];
  cleaned.forEach((line, index) => {
    const seat = readSeat(line, index);
    if (seat) seats.push(seat);
  });
  if (seats.length === 0) return [];

  const names = new Map<number, { raw: string; pairedByOrder: boolean }>();
  const orphans = seats.filter((s) => s.inlineName === "");

  // Shape 2: a name alone on the line straight after its seat number.
  const usedLines = new Set<number>();
  for (const seat of orphans) {
    const next = cleaned[seat.index + 1];
    const afterNext = cleaned[seat.index + 2];
    const alternates = afterNext === undefined || SEAT_NUMBER.test(afterNext) || !isNameOnly(afterNext);
    if (next !== undefined && isNameOnly(next) && alternates) {
      names.set(seat.index, { raw: next, pairedByOrder: false });
      usedLines.add(seat.index + 1);
    }
  }

  // Shape 3: the rest of the seat numbers and the rest of the names, in order.
  const stillOrphaned = orphans.filter((s) => !names.has(s.index));
  if (stillOrphaned.length > 0) {
    const firstSeatLine = seats[0].index;
    const nameLines = cleaned
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => index > firstSeatLine && !usedLines.has(index) && isNameOnly(line));

    if (nameLines.length === stillOrphaned.length) {
      stillOrphaned.forEach((seat, i) => names.set(seat.index, { raw: nameLines[i].line, pairedByOrder: true }));
    }
  }

  return seats.map((seat) => {
    const found = names.get(seat.index);
    const rawName = seat.inlineName !== "" ? seat.inlineName : (found?.raw ?? "");
    const name = tidyName(rawName);

    const nameLooksDamaged = rawName !== "" && !NAME_CHARACTERS.test(rawName);
    let confidence = seat.corrected || nameLooksDamaged ? CORRECTED_CONFIDENCE : CLEAN_CONFIDENCE;
    if (found?.pairedByOrder) confidence = Math.min(confidence, PAIRED_BY_ORDER_CONFIDENCE);
    if (fromOcr) confidence = Math.min(confidence, 0.85);

    return { roll_no: seat.rollNo, name: name === "" ? null : name, confidence };
  });
}
