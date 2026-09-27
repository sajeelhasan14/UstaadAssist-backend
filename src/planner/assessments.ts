/**
 * Assessment date validation — Section 3.3.
 *
 * A quiz must never be scheduled before the topics it covers have been taught.
 * If one is, move it to the next available class date afterwards and say why.
 *
 * PURE — no database.
 */

import type { Slot } from "./slots.ts";
import type { PlannedSession } from "./allocate.ts";

export type PlannerAssessment = {
  id: number;
  title: string;
  /** "2026-09-18", or null if the teacher has not chosen a date yet. */
  date: string | null;
  /** The topics this assessment covers, from the assessment_topic table. */
  topic_ids: number[];
};

export type AssessmentMove = {
  assessment_id: number;
  from: string;
  to: string;
  /** A sentence written for the teacher, shown on the "what moved" screen. */
  reason: string;
};

/** "2026-09-25" -> "25 Sep" */
function pretty(iso: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [y, m, d] = iso.split("-").map(Number);
  void y;
  return `${d} ${months[(m ?? 1) - 1]}`;
}

/**
 * The first class date strictly AFTER `date`, or null if there is none.
 *
 * Binary search. The slots are in date order (generateSlots() walks the
 * calendar forwards, and mergeExtraDates() sorts), so there is no need to check
 * them one by one from the start. Look at the middle slot instead:
 *
 *   - middle is on or before `date`  -> the answer can only be to its right
 *   - middle is after `date`         -> it might be the answer; keep it, and
 *                                       look for an earlier one to its left
 *
 * Each step throws away half of what is left, so n slots take about log2(n)
 * steps instead of up to n. The loop ends when `low` and `high` meet, and that
 * position is the first slot after `date` (or the end of the list).
 *
 * ISO dates ("2026-09-25") compare correctly as plain strings, because the
 * year, month and day are written biggest-first with fixed widths.
 */
export function firstSlotAfter(slots: Slot[], date: string): string | null {
  let low = 0;
  let high = slots.length; // one past the end: "no slot after this date"

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (slots[middle]!.date <= date) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low < slots.length ? slots[low]!.date : null;
}

/**
 * Check every assessment against the plan and return the ones that must move.
 *
 * @param sessions     the plan that was just generated
 * @param slots        every class date, so a moved assessment lands on a real one
 * @param assessments  what the teacher has scheduled
 * @param topicTitles  topic id -> title, only used to write a readable reason
 */
export function validateAssessmentDates(
  sessions: PlannedSession[],
  slots: Slot[],
  assessments: PlannerAssessment[],
  topicTitles: Map<number, string>,
): AssessmentMove[] {
  const moves: AssessmentMove[] = [];

  // When is each topic finally finished?
  const lastTaught = new Map<number, string>();
  for (const s of sessions) {
    const current = lastTaught.get(s.topic_id);
    if (!current || s.date > current) lastTaught.set(s.topic_id, s.date);
  }

  for (const assessment of assessments) {
    if (!assessment.date || assessment.topic_ids.length === 0) continue;

    // The latest finish date among the topics this assessment covers.
    let coversUntil: string | null = null;
    let lastTopicId: number | null = null;

    for (const topicId of assessment.topic_ids) {
      const finishes = lastTaught.get(topicId);
      if (!finishes) continue; // topic overflowed — nothing to compare against
      if (!coversUntil || finishes > coversUntil) {
        coversUntil = finishes;
        lastTopicId = topicId;
      }
    }

    if (!coversUntil) continue;

    // Scheduled on or after the last class? Then it is fine.
    if (assessment.date >= coversUntil) continue;

    // Otherwise push it to the first class date strictly after that.
    const newDate = firstSlotAfter(slots, coversUntil);
    if (!newDate) continue; // no class left to move it to; the deficit screen handles this

    const topicName = lastTopicId ? (topicTitles.get(lastTopicId) ?? "a topic") : "a topic";

    moves.push({
      assessment_id: assessment.id,
      from: assessment.date,
      to: newDate,
      reason:
        `${assessment.title} moved from ${pretty(assessment.date)} to ${pretty(newDate)} ` +
        `because ${topicName} will not be completed before ${pretty(coversUntil)}.`,
    });
  }

  return moves;
}
