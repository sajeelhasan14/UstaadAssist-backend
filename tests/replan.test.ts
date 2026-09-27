/**
 * Tests for replanning, deficit resolution and schedule health —
 * Sections 3.4, 3.5 and 3.6.
 *
 * Run with:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { replan, type ExistingSession } from "../src/planner/replan.ts";
import { buildDeficitOptions, applyDeficitOption } from "../src/planner/deficit.ts";
import { scheduleHealth } from "../src/planner/health.ts";
import { suggestMakeupDates } from "../src/planner/slots.ts";
import type { PlannerTopic } from "../src/planner/allocate.ts";

function topic(over: Partial<PlannerTopic> & { id: number; order_no: number }): PlannerTopic {
  return {
    title: `Topic ${over.id}`,
    sessions_needed: 1,
    min_sessions: 1,
    priority: "normal",
    ...over,
  };
}

function session(over: Partial<ExistingSession> & { id: number; date: string }): ExistingSession {
  return { topic_id: 1, status: "planned", part_no: null, ...over };
}

// Mondays in Sep/Oct 2026: 7, 14, 21, 28 Sep · 5, 12, 19, 26 Oct

// ------------------------------------------------------ 3.4 replanning

test("a conducted class is never touched", () => {
  const result = replan({
    today: "2026-09-21",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [
      session({ id: 1, date: "2026-09-07", status: "conducted", topic_id: 1 }),
      session({ id: 2, date: "2026-09-14", status: "conducted", topic_id: 2 }),
      session({ id: 3, date: "2026-09-21", status: "planned", topic_id: 3 }),
    ],
    topics: [
      topic({ id: 1, order_no: 1 }),
      topic({ id: 2, order_no: 2 }),
      topic({ id: 3, order_no: 3 }),
    ],
  });

  assert.deepEqual(result.frozen.map((s) => s.id), [1, 2]);
  assert.ok(
    !result.sessions.some((s) => s.date < "2026-09-21"),
    "nothing was scheduled before today",
  );
});

test("only teaching that has not happened yet is re-allocated", () => {
  const result = replan({
    today: "2026-09-21",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [
      // Two of Normalization's three classes are done.
      session({ id: 1, date: "2026-09-07", status: "conducted", topic_id: 1 }),
      session({ id: 2, date: "2026-09-14", status: "conducted", topic_id: 1 }),
    ],
    topics: [topic({ id: 1, order_no: 1, sessions_needed: 3, title: "Normalization" })],
  });

  assert.equal(result.sessions.length, 1, "only the third class is still owed");
  assert.equal(result.sessions[0]!.topic_id, 1);
});

test("a topic fully taught is not scheduled again", () => {
  const result = replan({
    today: "2026-09-21",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [session({ id: 1, date: "2026-09-07", status: "conducted", topic_id: 1 })],
    topics: [topic({ id: 1, order_no: 1, sessions_needed: 1 })],
  });

  assert.equal(result.sessions.length, 0);
});

test("a cancelled class frees nothing but pushes the rest later", () => {
  const before = replan({
    today: "2026-09-07",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [],
    topics: [topic({ id: 1, order_no: 1 }), topic({ id: 2, order_no: 2 })],
  });

  // Now 14 Sep becomes a holiday (a cancelled class day).
  const after = replan({
    today: "2026-09-07",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: ["2026-09-14"],
    existingSessions: [],
    topics: [topic({ id: 1, order_no: 1 }), topic({ id: 2, order_no: 2 })],
  });

  assert.equal(before.sessions[1]!.date, "2026-09-14");
  assert.equal(after.sessions[1]!.date, "2026-09-21", "topic 2 slipped a week");
});

test("a class cancelled on a future date is not rebuilt onto that same date", () => {
  // Today is 7 Sep. The teacher cancels next Monday's class (14 Sep) in advance.
  const result = replan({
    today: "2026-09-07",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [
      session({ id: 1, date: "2026-09-07", status: "planned", topic_id: 1 }),
      session({ id: 2, date: "2026-09-14", status: "cancelled", topic_id: 2 }),
      session({ id: 3, date: "2026-09-21", status: "planned", topic_id: 3 }),
    ],
    topics: [
      topic({ id: 1, order_no: 1 }),
      topic({ id: 2, order_no: 2 }),
      topic({ id: 3, order_no: 3 }),
    ],
  });

  assert.ok(
    !result.sessions.some((s) => s.date === "2026-09-14"),
    "nothing is scheduled on the cancelled date",
  );
  assert.deepEqual(
    result.sessions.map((s) => [s.date, s.topic_id]),
    [
      ["2026-09-07", 1],
      ["2026-09-21", 2],
      ["2026-09-28", 3],
    ],
    "the cancelled topic takes the next class and everything after it slips a week",
  );
});

test("a cancelled class is reported as moved from its date, not as a new class", () => {
  const topics = [topic({ id: 1, order_no: 1 }), topic({ id: 2, order_no: 2, title: "Joins" }), topic({ id: 3, order_no: 3 })];

  // Today is 7 Sep; the 14 Sep class (Joins) has just been cancelled.
  const first = replan({
    today: "2026-09-07",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [
      session({ id: 1, date: "2026-09-07", status: "planned", topic_id: 1 }),
      session({ id: 2, date: "2026-09-14", status: "cancelled", topic_id: 2 }),
      session({ id: 3, date: "2026-09-21", status: "planned", topic_id: 3 }),
    ],
    topics,
  });

  const joins = first.changes.find((c) => c.topic_id === 2);
  assert.deepEqual(joins, { kind: "moved", topic_id: 2, topic: "Joins", from: "2026-09-14", to: "2026-09-21" });
  assert.ok(!first.changes.some((c) => c.kind === "added"), "nothing reads as brand new");

  // Replanning again without any new disruption reports no changes at all —
  // the cancellation was already accounted for.
  const second = replan({
    today: "2026-09-07",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [
      session({ id: 1, date: "2026-09-07", status: "planned", topic_id: 1 }),
      session({ id: 2, date: "2026-09-14", status: "cancelled", topic_id: 2 }),
      ...first.sessions
        .filter((s) => s.date !== "2026-09-07")
        .map((s, i) => session({ id: 10 + i, date: s.date, status: "planned", topic_id: s.topic_id })),
    ],
    topics,
  });

  assert.deepEqual(second.changes, []);
});

test("the result reports what moved", () => {
  const result = replan({
    today: "2026-09-07",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: ["2026-09-14"],
    existingSessions: [
      session({ id: 1, date: "2026-09-07", topic_id: 1 }),
      session({ id: 2, date: "2026-09-14", topic_id: 2 }),
    ],
    topics: [
      topic({ id: 1, order_no: 1, title: "SQL Basics" }),
      topic({ id: 2, order_no: 2, title: "Joins" }),
    ],
  });

  const moved = result.changes.filter((c) => c.kind === "moved");
  assert.equal(moved.length, 1);
  assert.deepEqual(moved[0], {
    kind: "moved",
    topic_id: 2,
    topic: "Joins",
    from: "2026-09-14",
    to: "2026-09-21",
  });
});

test("replanning reports a deficit when time has run out", () => {
  const result = replan({
    today: "2026-10-19",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [],
    topics: [
      topic({ id: 1, order_no: 1, sessions_needed: 3 }),
      topic({ id: 2, order_no: 2, sessions_needed: 3 }),
    ],
  });

  assert.equal(result.slotsAvailable, 2, "only 19 and 26 Oct remain");
  assert.equal(result.deficit, 4, "6 classes needed, 2 available");
  assert.ok(result.overflow.length > 0);
});

test("an agreed makeup date becomes a usable class slot", () => {
  const withoutMakeup = replan({
    today: "2026-10-19",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [],
    topics: [
      topic({ id: 1, order_no: 1 }),
      topic({ id: 2, order_no: 2 }),
      topic({ id: 3, order_no: 3 }),
    ],
  });

  // Only 19 and 26 Oct are Mondays, so the third topic has nowhere to go.
  assert.equal(withoutMakeup.slotsAvailable, 2);
  assert.equal(withoutMakeup.overflow.length, 1);

  // The teacher accepts a Wednesday makeup class.
  const withMakeup = replan({
    today: "2026-10-19",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [],
    topics: [
      topic({ id: 1, order_no: 1 }),
      topic({ id: 2, order_no: 2 }),
      topic({ id: 3, order_no: 3 }),
    ],
    extraDates: ["2026-10-21"],
  });

  assert.equal(withMakeup.slotsAvailable, 3);
  assert.equal(withMakeup.overflow.length, 0, "the third topic now fits");

  // And it lands in date order, not tacked on at the end.
  assert.deepEqual(
    withMakeup.sessions.map((s) => s.date),
    ["2026-10-19", "2026-10-21", "2026-10-26"],
  );
});

test("a makeup date in the past is not offered as a future slot", () => {
  const result = replan({
    today: "2026-10-19",
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [],
    topics: [topic({ id: 1, order_no: 1 })],
    extraDates: ["2026-09-09"],
  });

  assert.ok(
    !result.sessions.some((s) => s.date === "2026-09-09"),
    "a date before today is never rebuilt onto",
  );
});

test("a rebuilt class keeps the week number of the course, not of today", () => {
  const result = replan({
    today: "2026-10-19",
    startDate: "2026-09-07",
    endDate: "2026-10-31",
    classDays: ["mon"],
    holidays: [],
    existingSessions: [],
    topics: [topic({ id: 1, order_no: 1 })],
  });

  // 7 Sep is week 1, so 19 Oct is six weeks later: week 7.
  // Numbering from today instead would report week 1, and the teaching-plan
  // screen would show "Week 1" in the middle of October.
  assert.equal(result.sessions[0]!.date, "2026-10-19");
  assert.equal(result.sessions[0]!.week_no, 7);
});

// -------------------------------------------------------- 3.5 deficit

const remaining = [
  topic({ id: 1, order_no: 1, title: "Indexing",     sessions_needed: 3, min_sessions: 2, priority: "low" }),
  topic({ id: 2, order_no: 2, title: "Transactions", sessions_needed: 3, min_sessions: 2, priority: "normal" }),
  topic({ id: 3, order_no: 3, title: "Recovery",     sessions_needed: 2, min_sessions: 2, priority: "low" }),
  topic({ id: 4, order_no: 4, title: "Concurrency",  sessions_needed: 3, min_sessions: 1, priority: "high" }),
];

test("a deficit always produces three options", () => {
  const makeups = suggestMakeupDates("2026-09-01", "2026-12-24", ["mon"], [], 10);
  const options = buildDeficitOptions(4, remaining, makeups);

  assert.equal(options.deficit, 4);
  assert.equal(options.drop.type, "drop");
  assert.equal(options.compress.type, "compress");
  assert.equal(options.extend.type, "extend");
});

test("drop picks the lowest-priority topics first", () => {
  const options = buildDeficitOptions(4, remaining, []);

  const titles = options.drop.topics.map((t) => t.title);
  assert.ok(titles.includes("Recovery"), "low priority");
  assert.ok(titles.includes("Indexing"), "low priority");
  assert.ok(!titles.includes("Concurrency"), "high priority must be kept");
  assert.ok(options.drop.sessions_recovered >= 4);
  assert.equal(options.drop.covers_deficit, true);
});

test("compress never takes a topic below its minimum", () => {
  const options = buildDeficitOptions(4, remaining, []);

  for (const t of options.compress.topics) {
    const original = remaining.find((r) => r.id === t.topic_id)!;
    assert.ok(t.to >= original.min_sessions, `${t.title} went below its minimum`);
    assert.ok(t.to < t.from, "it must actually shrink");
  }
});

test("compress reports honestly when it cannot cover the whole deficit", () => {
  // Total slack here is only 1 + 1 + 0 + 2 = 4, so a deficit of 10 is impossible.
  const options = buildDeficitOptions(10, remaining, []);
  assert.equal(options.compress.covers_deficit, false);
  assert.ok(options.compress.sessions_recovered < 10);
});

test("extend suggests exactly as many makeup dates as are needed", () => {
  const makeups = suggestMakeupDates("2026-09-01", "2026-12-24", ["mon", "wed"], [], 20);
  const options = buildDeficitOptions(3, remaining, makeups);

  assert.equal(options.extend.dates.length, 3);
  assert.equal(options.extend.covers_deficit, true);
});

test("applying 'drop' removes those topics", () => {
  const options = buildDeficitOptions(4, remaining, []);
  const result = applyDeficitOption("drop", options, remaining);

  assert.ok(result.topics.length < remaining.length);
  for (const id of result.droppedTopicIds) {
    assert.ok(!result.topics.some((t) => t.id === id));
  }
});

test("applying 'compress' shortens those topics and keeps them all", () => {
  const options = buildDeficitOptions(2, remaining, []);
  const result = applyDeficitOption("compress", options, remaining);

  assert.equal(result.topics.length, remaining.length, "nothing is removed");

  const changed = options.compress.topics[0]!;
  const after = result.topics.find((t) => t.id === changed.topic_id)!;
  assert.equal(after.sessions_needed, changed.to);
});

test("applying 'extend' changes no topics and returns the extra dates", () => {
  const makeups = suggestMakeupDates("2026-09-01", "2026-12-24", ["mon"], [], 10);
  const options = buildDeficitOptions(3, remaining, makeups);
  const result = applyDeficitOption("extend", options, remaining);

  assert.deepEqual(result.topics, remaining);
  assert.equal(result.extraDates.length, 3);
});

// --------------------------------------------------------- 3.6 health

test("behind_by_weeks counts classes that should have happened but did not", () => {
  const health = scheduleHealth({
    today: "2026-09-21",
    classesPerWeek: 2,
    sessions: [
      { date: "2026-09-07", status: "conducted" },
      { date: "2026-09-09", status: "conducted" },
      { date: "2026-09-14", status: "planned" }, // missed
      { date: "2026-09-16", status: "planned" }, // missed
      { date: "2026-09-21", status: "planned" }, // missed
      { date: "2026-09-28", status: "planned" }, // future, does not count
    ],
    totalTopics: 10,
    completedTopics: 2,
  });

  assert.equal(health.planned_up_to_today, 5);
  assert.equal(health.conducted, 2);
  assert.equal(health.behind_by_weeks, 1.5, "(5 - 2) / 2");
  assert.equal(health.syllabus_percent, 20);
});

test("on schedule means zero weeks behind", () => {
  const health = scheduleHealth({
    today: "2026-09-14",
    classesPerWeek: 2,
    sessions: [
      { date: "2026-09-07", status: "conducted" },
      { date: "2026-09-09", status: "conducted" },
      { date: "2026-09-14", status: "conducted" },
      { date: "2026-09-21", status: "planned" },
    ],
    totalTopics: 4,
    completedTopics: 4,
  });

  assert.equal(health.behind_by_weeks, 0);
  assert.equal(health.syllabus_percent, 100);
});

test("a cancelled class does not count as being behind", () => {
  const health = scheduleHealth({
    today: "2026-09-21",
    classesPerWeek: 1,
    sessions: [
      { date: "2026-09-07", status: "conducted" },
      { date: "2026-09-14", status: "cancelled" },
      { date: "2026-09-21", status: "conducted" },
    ],
    totalTopics: 2,
    completedTopics: 2,
  });

  assert.equal(health.cancelled, 1);
  assert.equal(health.behind_by_weeks, 0, "a cancelled class was never an opportunity");
});
