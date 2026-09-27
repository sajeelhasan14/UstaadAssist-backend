/**
 * Schedule health — Section 3.6.
 *
 *   behind_by_weeks = (classes planned up to today - classes conducted) / classes per week
 *
 * Feeds the dashboard warning: "You are 1 week behind your plan."
 *
 * PURE — no database. `today` is passed in, never read from the clock.
 */

export type HealthInput = {
  today: string;
  /** How many class days a week, e.g. 2 for Mon+Wed. */
  classesPerWeek: number;
  /** Every session in the plan, with its date and status. */
  sessions: { date: string; status: "planned" | "conducted" | "cancelled" }[];
  totalTopics: number;
  completedTopics: number;
};

export type Health = {
  /** Classes that should have happened by today. */
  planned_up_to_today: number;
  conducted: number;
  cancelled: number;
  /** Positive means behind. Rounded to one decimal place. */
  behind_by_weeks: number;
  /** 0–100, how much of the course has been taught. */
  syllabus_percent: number;
  total_sessions: number;
};

export function scheduleHealth(input: HealthInput): Health {
  const { today, classesPerWeek, sessions, totalTopics, completedTopics } = input;

  // A cancelled class was never taught, but it was also never an opportunity,
  // so it does not count as "should have happened".
  const plannedUpToToday = sessions.filter(
    (s) => s.date <= today && s.status !== "cancelled",
  ).length;

  const conducted = sessions.filter((s) => s.status === "conducted").length;
  const cancelled = sessions.filter((s) => s.status === "cancelled").length;

  const perWeek = Math.max(1, classesPerWeek);
  const behind = (plannedUpToToday - conducted) / perWeek;

  return {
    planned_up_to_today: plannedUpToToday,
    conducted,
    cancelled,
    behind_by_weeks: Math.round(behind * 10) / 10,
    syllabus_percent:
      totalTopics === 0 ? 0 : Math.round((completedTopics / totalTopics) * 100),
    total_sessions: sessions.length,
  };
}
