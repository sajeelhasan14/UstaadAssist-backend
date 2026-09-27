/**
 * Topic allocation — Section 3.2.
 *
 * Walk the topics in order. Each one eats as many slots as it needs. Anything
 * that does not fit before the slots run out goes into `overflow`.
 *
 * PURE — no database.
 */

import type { Slot } from "./slots.ts";

export type PlannerTopic = {
  id: number;
  order_no: number;
  title: string;
  sessions_needed: number;
  min_sessions: number;
  priority: "low" | "normal" | "high";
};

export type PlannedSession = {
  date: string;
  week_no: number;
  topic_id: number;
  /** 1, 2, 3 … when a topic spans several classes. null when it is a single class. */
  part_no: number | null;
  /** How many classes this topic spans in total. null when it is a single class. */
  total_parts: number | null;
};

export type Allocation = {
  sessions: PlannedSession[];
  /** Topics there was no room for. */
  overflow: PlannerTopic[];
  /** Slots left unused after every topic was placed. */
  unusedSlots: Slot[];
};

/**
 * Assign topics to slots, in order.
 *
 * A topic is placed only if ALL of its sessions fit. Half-teaching a topic and
 * leaving the rest is worse than telling the teacher it did not fit, which is
 * what the deficit screen is for.
 */
export function allocateTopics(slots: Slot[], topics: PlannerTopic[]): Allocation {
  const ordered = [...topics].sort((a, b) => a.order_no - b.order_no);

  const sessions: PlannedSession[] = [];
  const overflow: PlannerTopic[] = [];

  let next = 0; // index of the next free slot

  for (const topic of ordered) {
    const need = Math.max(1, topic.sessions_needed);

    // Not enough slots left for the whole topic.
    if (next + need > slots.length) {
      overflow.push(topic);
      continue;
    }

    const spansSeveral = need > 1;

    for (let part = 1; part <= need; part++) {
      const slot = slots[next]!;
      next += 1;

      sessions.push({
        date: slot.date,
        week_no: slot.week_no,
        topic_id: topic.id,
        part_no: spansSeveral ? part : null,
        total_parts: spansSeveral ? need : null,
      });
    }
  }

  return { sessions, overflow, unusedSlots: slots.slice(next) };
}

/**
 * How many extra slots the remaining topics would need — Section 3.5.
 *
 *   deficit = sessions still needed  -  slots still available
 *
 * A number of 0 or less means everything fits.
 */
export function calculateDeficit(
  slotsAvailable: number,
  topicsRemaining: PlannerTopic[],
): number {
  const needed = topicsRemaining.reduce(
    (total, t) => total + Math.max(1, t.sessions_needed),
    0,
  );
  return needed - slotsAvailable;
}
