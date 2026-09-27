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
 * How bad a set of dropped topics is, compared like words in a dictionary:
 * the first number decides, and the next one only breaks a tie.
 *
 *   [ high topics dropped, normal topics dropped, low topics dropped, -sum of order_no ]
 *
 * So a plan that drops no high-priority topic always beats one that drops any,
 * then the same for normal, then fewer low topics wins. The last number prefers
 * LATER topics, because earlier ones tend to be foundations for what follows.
 * It is negative because a larger order_no sum is better and smaller costs win.
 */
type DropCost = [high: number, normal: number, low: number, negOrderSum: number];

/** Is cost `a` strictly better (smaller) than cost `b`? */
function isBetter(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) {
    if (a[k]! !== b[k]!) return a[k]! < b[k]!;
  }
  return false;
}

/** The cost of adding one more topic to a set that already costs `base`. */
function addTopic(base: DropCost, t: PlannerTopic): DropCost {
  const [high, normal, low, negOrderSum] = base;
  return [
    high + (t.priority === "high" ? 1 : 0),
    normal + (t.priority === "normal" ? 1 : 0),
    low + (t.priority === "low" ? 1 : 0),
    negOrderSum - t.order_no,
  ];
}

/**
 * DROP — remove whole topics, choosing the best COMBINATION.
 *
 * This is the 0/1 knapsack problem: each topic is either dropped completely or
 * kept completely (0 or 1), each frees a known number of classes (its "weight"),
 * and the chosen topics must free at least `deficit` classes, as cheaply as
 * possible. "Cheaply" is defined by DropCost above.
 *
 * Why not simply take the least important topics one by one (greedy)? Because
 * that can drop more than needed. Short by 3, with low-priority topics of 2, 2
 * and 3 classes: greedy takes 2 + 2 (two topics, one class too many), while
 * dropping the 3-class topic alone is exact. Greedy never goes back on a choice.
 *
 * Dynamic programming solves it by filling a table from small cases up:
 *
 *   best[i][s] = the cheapest way to free EXACTLY s classes using only the
 *                first i topics (null when it cannot be done)
 *
 * Each cell has just two choices for topic i — skip it, or drop it on top of
 * the best way to free the remaining s - weight classes:
 *
 *   best[i][s] = better of  best[i-1][s]                      (skip topic i)
 *                           best[i-1][s - weight] + topic i   (drop topic i)
 *
 * The answer is the cheapest cell in the last row with s >= deficit; between
 * equally cheap cells the smaller s wins, so the fewest extra classes are lost.
 *
 * Time and memory: O(n x S), where n is the number of remaining topics and S is
 * the total classes they need. A semester has a few dozen of each.
 */
function buildDrop(deficit: number, topics: PlannerTopic[]): DropOption {
  // Most droppable first (lowest priority, then latest in the course). The DP
  // does not need this order to be correct; it only fixes the order the chosen
  // topics are listed in for the teacher.
  const candidates = [...topics].sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return byPriority !== 0 ? byPriority : b.order_no - a.order_no;
  });

  const n = candidates.length;
  const weight = candidates.map((t) => Math.max(1, t.sessions_needed));
  const totalClasses = weight.reduce((sum, w) => sum + w, 0);

  // best[i][s] as described above. took[i][s] remembers whether topic i was
  // dropped to reach that cell, so the chosen set can be read back afterwards.
  const best: (DropCost | null)[][] = [];
  const took: boolean[][] = [];

  // Row 0, no topics yet: only "free 0 classes" is possible, and it costs nothing.
  best.push(Array.from({ length: totalClasses + 1 }, (_, s) => (s === 0 ? [0, 0, 0, 0] : null)));
  took.push(new Array(totalClasses + 1).fill(false));

  for (let i = 1; i <= n; i++) {
    const topic = candidates[i - 1]!;
    const w = weight[i - 1]!;
    const previous = best[i - 1]!;
    const row: (DropCost | null)[] = [];
    const tookRow: boolean[] = [];

    for (let s = 0; s <= totalClasses; s++) {
      const skip = previous[s] ?? null;
      const before = s >= w ? previous[s - w] : null;
      const drop = before ? addTopic(before, topic) : null;

      if (drop && (!skip || isBetter(drop, skip))) {
        row.push(drop);
        tookRow.push(true);
      } else {
        row.push(skip);
        tookRow.push(false);
      }
    }

    best.push(row);
    took.push(tookRow);
  }

  // Pick the cheapest reachable total that covers the deficit. Walking s upwards
  // and replacing only on a strictly better cost means a tie keeps the smaller s.
  let target: number | null = null;
  for (let s = Math.max(0, deficit); s <= totalClasses; s++) {
    const cost = best[n]![s];
    if (!cost) continue;
    if (target === null || isBetter(cost.slice(0, 3), best[n]![target]!.slice(0, 3))) {
      target = s;
    }
  }

  // Not even dropping everything covers the deficit: offer everything and say so.
  if (target === null) {
    return {
      type: "drop",
      sessions_recovered: totalClasses,
      covers_deficit: false,
      topics: candidates.map((t, i) => ({ topic_id: t.id, title: t.title, sessions_freed: weight[i]! })),
    };
  }

  // Walk back up the table to find which topics made up the winning cell.
  const dropped = new Set<number>();
  let s = target;
  for (let i = n; i >= 1; i--) {
    if (took[i]![s]) {
      dropped.add(i - 1);
      s -= weight[i - 1]!;
    }
  }

  const chosen: DropOption["topics"] = [];
  candidates.forEach((t, i) => {
    if (dropped.has(i)) chosen.push({ topic_id: t.id, title: t.title, sessions_freed: weight[i]! });
  });

  return {
    type: "drop",
    sessions_recovered: target,
    covers_deficit: target >= deficit,
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
