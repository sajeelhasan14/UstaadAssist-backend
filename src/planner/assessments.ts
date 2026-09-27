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
    const newDate = slots.find((s) => s.date > coversUntil!)?.date;
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
