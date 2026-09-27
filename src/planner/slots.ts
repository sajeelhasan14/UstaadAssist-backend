/**
 * Slot generation — Section 3.1.
 *
 * A "slot" is one real date on which a class can happen: it falls on a day the
 * teacher teaches, and it is not a holiday.
 *
 * This file is PURE. It never touches the database. Everything it needs arrives
 * as an argument, so the same inputs always produce the same output — which is
 * what makes it testable.
 */

export type Slot = {
  /** "2026-09-07" */
  date: string;
  /** 1 for the first week of the semester, 2 for the next, and so on. */
  week_no: number;
};

/** Index 0 is Sunday, matching JavaScript's getUTCDay(). */
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "2026-09-07" -> a Date fixed at midnight UTC, so no timezone can shift it. */
function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** A Date -> "2026-09-07". */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Every date between startDate and endDate (both included) that the teacher
 * can actually hold a class on.
 *
 * @param startDate  "2026-09-01" — the first date to consider
 * @param endDate    "2026-12-24"
 * @param classDays  ["mon", "wed"] — lowercase three-letter day names
 * @param holidays   ["2026-09-06", ...] — only the ones still switched on
 * @param weekAnchor which date counts as the start of week 1. Defaults to
 *   startDate. Replanning passes the COURSE start date here while starting the
 *   walk from today, so a class in November is still reported as week 12 rather
 *   than week 1.
 */
export function generateSlots(
  startDate: string,
  endDate: string,
  classDays: string[],
  holidays: string[],
  weekAnchor?: string,
): Slot[] {
  const teaches = new Set(classDays);
  const isHoliday = new Set(holidays);

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const anchor = parseDate(weekAnchor ?? startDate);

  const slots: Slot[] = [];
  const cursor = new Date(start);

  // Walk one day at a time from the first day of the semester to the last.
  while (cursor.getTime() <= end.getTime()) {
    const date = toISODate(cursor);
    const dayName = DAY_NAMES[cursor.getUTCDay()]!;

    if (teaches.has(dayName) && !isHoliday.has(date)) {
      // Week 1 is the first seven days from the anchor, week 2 the next, etc.
      const daysIn = Math.floor((cursor.getTime() - anchor.getTime()) / MS_PER_DAY);
      slots.push({ date, week_no: Math.floor(daysIn / 7) + 1 });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}

/**
 * Dates the teacher does NOT normally teach on, used to suggest makeup classes
 * (Section 3.5, the "Extend" option).
 *
 * Skips holidays and Sundays, and only looks forward from `after`.
 */
export function suggestMakeupDates(
  after: string,
  endDate: string,
  classDays: string[],
  holidays: string[],
  howMany: number,
): string[] {
  const teaches = new Set(classDays);
  const isHoliday = new Set(holidays);

  const end = parseDate(endDate);
  const cursor = parseDate(after);
  cursor.setUTCDate(cursor.getUTCDate() + 1); // strictly after

  const found: string[] = [];

  while (cursor.getTime() <= end.getTime() && found.length < howMany) {
    const date = toISODate(cursor);
    const dayName = DAY_NAMES[cursor.getUTCDay()]!;

    const isNormalClassDay = teaches.has(dayName);
    const isSunday = dayName === "sun";

    if (!isNormalClassDay && !isSunday && !isHoliday.has(date)) {
      found.push(date);
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return found;
}

/**
 * Fold extra one-off dates (makeup classes from the "Extend" option) into a
 * slot list, keeping everything in date order and numbering their weeks the
 * same way generateSlots() does.
 *
 * A makeup class is a date the teacher does not normally teach on, so it can
 * never come out of generateSlots(). It has to be added here.
 */
export function mergeExtraDates(
  slots: Slot[],
  extraDates: string[],
  startDate: string,
): Slot[] {
  if (extraDates.length === 0) return slots;

  const already = new Set(slots.map((s) => s.date));
  const start = parseDate(startDate);

  const extras: Slot[] = [];
  for (const date of extraDates) {
    if (already.has(date)) continue;
    already.add(date);

    const daysIn = Math.floor((parseDate(date).getTime() - start.getTime()) / MS_PER_DAY);
    extras.push({ date, week_no: Math.floor(daysIn / 7) + 1 });
  }

  return [...slots, ...extras].sort((a, b) => a.date.localeCompare(b.date));
}
