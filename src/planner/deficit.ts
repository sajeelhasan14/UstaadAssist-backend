/**
 * Deficit resolution — Section 3.5.
 *
 * When there is not enough time left for the remaining topics, do NOT throw an
 * error. Work out three ways the teacher could fix it and let them choose:
 *
 *   1. DROP      — cut the lowest-priority topics
 *   2. COMPRESS  — shorten topics that have room above their minimum
 *   3. EXTEND    — add makeup classes on days off
 *
 * PURE — no database.
 */

import type { PlannerTopic } from "./allocate.ts";

export type DropOption = {
  type: "drop";
  sessions_recovered: number;
  /** Enough to cover the whole deficit? */
  covers_deficit: boolean;
  topics: { topic_id: number; title: string; sessions_freed: number }[];
};

export type CompressOption = {
  type: "compress";
  sessions_recovered: number;
  covers_deficit: boolean;
  topics: { topic_id: number; title: string; from: number; to: number }[];
};

export type ExtendOption = {
  type: "extend";
  sessions_recovered: number;
  covers_deficit: boolean;
  dates: string[];
};

export type DeficitOptions = {
  deficit: number;
  drop: DropOption;
  compress: CompressOption;
  extend: ExtendOption;
};

const PRIORITY_ORDER = { low: 0, normal: 1, high: 2 } as const;

/**
 * Build all three options.
 *
 * @param deficit           how many extra classes are needed (positive)
 * @param remainingTopics   topics not yet taught, with their current settings
 * @param makeupCandidates  free dates from suggestMakeupDates()
 */
export function buildDeficitOptions(
  deficit: number,
  remainingTopics: PlannerTopic[],
  makeupCandidates: string[],
): DeficitOptions {
  return {
    deficit,
    drop: buildDrop(deficit, remainingTopics),
    compress: buildCompress(deficit, remainingTopics),
    extend: buildExtend(deficit, makeupCandidates),
  };
}

/**
 * DROP — remove whole topics, cheapest first.
 *
 * "Cheapest" means lowest priority; between two topics of equal priority, the
 * later one in the course goes first, because earlier topics tend to be
 * foundations for the ones after them.
 */
function buildDrop(deficit: number, topics: PlannerTopic[]): DropOption {
  const candidates = [...topics].sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return byPriority !== 0 ? byPriority : b.order_no - a.order_no;
  });

  const chosen: DropOption["topics"] = [];
  let recovered = 0;

  for (const t of candidates) {
    if (recovered >= deficit) break;
    const freed = Math.max(1, t.sessions_needed);
    chosen.push({ topic_id: t.id, title: t.title, sessions_freed: freed });
    recovered += freed;
  }

  return {
    type: "drop",
    sessions_recovered: recovered,
    covers_deficit: recovered >= deficit,
    topics: chosen,
  };
}

/**
 * COMPRESS — shorten topics that currently get more classes than their minimum.
 *
 * Topics with the most slack are shortened first, so the fewest topics are
 * affected. Nothing is ever taken below its min_sessions.
 */
function buildCompress(deficit: number, topics: PlannerTopic[]): CompressOption {
  const withSlack = topics
    .map((t) => ({
      topic: t,
      slack: Math.max(1, t.sessions_needed) - Math.max(1, t.min_sessions),
    }))
    .filter((x) => x.slack > 0)
    .sort((a, b) => b.slack - a.slack);

  const chosen: CompressOption["topics"] = [];
  let recovered = 0;

  for (const { topic, slack } of withSlack) {
    if (recovered >= deficit) break;

    const take = Math.min(slack, deficit - recovered);
    const from = Math.max(1, topic.sessions_needed);

    chosen.push({ topic_id: topic.id, title: topic.title, from, to: from - take });
    recovered += take;
  }

  return {
    type: "compress",
    sessions_recovered: recovered,
    covers_deficit: recovered >= deficit,
    topics: chosen,
  };
}

/** EXTEND — schedule makeup classes on days the teacher does not normally teach. */
function buildExtend(deficit: number, candidates: string[]): ExtendOption {
  const dates = candidates.slice(0, deficit);
  return {
    type: "extend",
    sessions_recovered: dates.length,
    covers_deficit: dates.length >= deficit,
    dates,
  };
}

/**
 * Apply the teacher's choice, returning the adjusted topic list and any extra
 * dates to add as makeup classes. The caller then re-runs the planner.
 */
export function applyDeficitOption(
  choice: "drop" | "compress" | "extend",
  options: DeficitOptions,
  topics: PlannerTopic[],
): { topics: PlannerTopic[]; droppedTopicIds: number[]; extraDates: string[] } {
  if (choice === "drop") {
    const dropped = new Set(options.drop.topics.map((t) => t.topic_id));
    return {
      topics: topics.filter((t) => !dropped.has(t.id)),
      droppedTopicIds: [...dropped],
      extraDates: [],
    };
  }

  if (choice === "compress") {
    const newLength = new Map(options.compress.topics.map((t) => [t.topic_id, t.to]));
    return {
      topics: topics.map((t) =>
        newLength.has(t.id) ? { ...t, sessions_needed: newLength.get(t.id)! } : t,
      ),
      droppedTopicIds: [],
      extraDates: [],
    };
  }

  return { topics, droppedTopicIds: [], extraDates: options.extend.dates };
}
