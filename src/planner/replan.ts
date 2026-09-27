/**
 * Replanning — Section 3.4.
 *
 * Principle: FREEZE THE PAST, REBUILD THE FUTURE.
 *
 *   - a class already marked `conducted` is never touched
 *   - class dates from today onward are worked out again
 *   - only the teaching that still has to happen is re-allocated
 *   - the result says WHAT CHANGED, not just what the new plan is
 *
 * PURE — no database. `today` is passed in rather than read from the clock,
 * so a test can pretend it is any date.
 */

import { generateSlots, mergeExtraDates, type Slot } from "./slots.ts";
import { allocateTopics, calculateDeficit, type PlannerTopic, type PlannedSession } from "./allocate.ts";

export type ExistingSession = {
  id: number;
  topic_id: number | null;
  date: string;
  status: "planned" | "conducted" | "cancelled";
  part_no: number | null;
};

export type ReplanInput = {
  /** "2026-10-14" — treated as the first day that can be rebuilt. */
  today: string;
  startDate: string;
  endDate: string;
  classDays: string[];
  /** Only holidays still switched on. */
  holidays: string[];
  existingSessions: ExistingSession[];
  topics: PlannerTopic[];
  /**
   * Makeup dates the teacher has already agreed to, from the "Extend" option.
   * These are days outside the normal class days, so generateSlots() cannot
   * find them on its own.
   */
  extraDates?: string[];
};

export type SessionChange =
  | { kind: "moved"; topic_id: number; topic: string; from: string; to: string }
  | { kind: "added"; topic_id: number; topic: string; to: string }
  | { kind: "removed"; topic_id: number; topic: string; from: string };

export type ReplanResult = {
  /** Conducted classes. These rows stay exactly as they are. */
  frozen: ExistingSession[];
  /** The rebuilt future. These replace every `planned` row. */
  sessions: PlannedSession[];
  /** Teaching that no longer fits in the remaining time. */
  overflow: PlannerTopic[];
  /** For the "what moved" screen. */
  changes: SessionChange[];
  slotsAvailable: number;
  /** Positive means there is not enough time left. */
  deficit: number;
};

/**
 * How much of each topic is still owed, given what has already been taught.
 * A topic needing 3 classes with 1 already conducted still needs 2.
 */
function remainingWork(topics: PlannerTopic[], conducted: ExistingSession[]): PlannerTopic[] {
  const taught = new Map<number, number>();
  for (const s of conducted) {
    if (s.topic_id === null) continue;
    taught.set(s.topic_id, (taught.get(s.topic_id) ?? 0) + 1);
  }

  const still: PlannerTopic[] = [];
  for (const t of topics) {
    if (t.priority === undefined) continue;
    const done = taught.get(t.id) ?? 0;
    const left = Math.max(1, t.sessions_needed) - done;
    if (left > 0) still.push({ ...t, sessions_needed: left });
  }
  return still;
}

export function replan(input: ReplanInput): ReplanResult {
  const { today, startDate, endDate, classDays, holidays, existingSessions, topics } = input;
  const extraDates = input.extraDates ?? [];

  const frozen = existingSessions.filter((s) => s.status === "conducted");
  const oldPlanned = existingSessions.filter((s) => s.status === "planned");
  // Cancelled classes still ahead: the teaching they held is re-placed by this
  // replan, so the change is reported as a move from that date.
  const cancelledAhead = existingSessions.filter((s) => s.status === "cancelled" && s.date >= today);

  // Dates that are still usable: class days from today to the end of term,
  // minus holidays, minus any date that already holds a conducted OR cancelled
  // class. A cancelled date is a day the class could not happen, so rebuilding
  // onto it would put the same class straight back on the day it was cancelled
  // and nothing after it would move.
  const taken = new Set(
    existingSessions.filter((s) => s.status !== "planned").map((s) => s.date),
  );
  const futureFrom = today > startDate ? today : startDate;
  // The walk starts at today, but week 1 is still the first week of the COURSE,
  // so a rebuilt class in November reports week 12, not week 1.
  const regular = generateSlots(futureFrom, endDate, classDays, holidays, startDate);
  const futureExtras = extraDates.filter((d) => d >= futureFrom && d <= endDate);

  const slots: Slot[] = mergeExtraDates(regular, futureExtras, startDate).filter(
    (s) => !taken.has(s.date),
  );

  const stillToTeach = remainingWork(topics, frozen);
  const { sessions, overflow } = allocateTopics(slots, stillToTeach);

  return {
    frozen,
    sessions,
    overflow,
    changes: describeChanges(oldPlanned, sessions, topics, cancelledAhead),
    slotsAvailable: slots.length,
    deficit: calculateDeficit(slots.length, stillToTeach),
  };
}

/**
 * Compare the old plan with the new one and describe the difference in a way
 * the teacher can read.
 *
 * Sessions are matched per topic, in date order: the first future class of a
 * topic before is compared with the first one after, and so on.
 *
 * A class the teacher cancelled is not in `before` (it is no longer planned),
 * so the class that replaces it would otherwise read as brand new: "Joins —
 * scheduled 21 Sep". When a topic ends up with an extra class and one of its
 * classes was cancelled, the extra class is paired with the cancelled date
 * instead: "Joins — moved 14 Sep → 21 Sep", which is what actually happened.
 */
function describeChanges(
  before: ExistingSession[],
  after: PlannedSession[],
  topics: PlannerTopic[],
  cancelled: ExistingSession[] = [],
): SessionChange[] {
  const title = new Map(topics.map((t) => [t.id, t.title]));
  const changes: SessionChange[] = [];

  const group = <T extends { topic_id: number | null; date: string }>(rows: T[]) => {
    const byTopic = new Map<number, string[]>();
    for (const r of rows) {
      if (r.topic_id === null) continue;
      const list = byTopic.get(r.topic_id) ?? [];
      list.push(r.date);
      byTopic.set(r.topic_id, list);
    }
    for (const list of byTopic.values()) list.sort();
    return byTopic;
  };

  const oldByTopic = group(before);
  const newByTopic = group(after);
  const cancelledByTopic = group(cancelled);

  const everyTopic = new Set([...oldByTopic.keys(), ...newByTopic.keys()]);

  for (const topicId of everyTopic) {
    const name = title.get(topicId) ?? `Topic ${topicId}`;
    const oldDates = oldByTopic.get(topicId) ?? [];
    const newDates = newByTopic.get(topicId) ?? [];
    const cancelledDates = [...(cancelledByTopic.get(topicId) ?? [])];

    const longest = Math.max(oldDates.length, newDates.length);
    for (let i = 0; i < longest; i++) {
      const from = oldDates[i];
      const to = newDates[i];

      if (from && to && from !== to) {
        changes.push({ kind: "moved", topic_id: topicId, topic: name, from, to });
      } else if (!from && to) {
        // An extra class for this topic: if one of its classes was cancelled,
        // this is that class, moved.
        const cancelledFrom = cancelledDates.shift();
        changes.push(
          cancelledFrom
            ? { kind: "moved", topic_id: topicId, topic: name, from: cancelledFrom, to }
            : { kind: "added", topic_id: topicId, topic: name, to },
        );
      } else if (from && !to) {
        changes.push({ kind: "removed", topic_id: topicId, topic: name, from });
      }
    }
  }

  return changes;
}
