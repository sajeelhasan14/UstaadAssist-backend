/**
 * The plan service — the LOAD / THINK / SAVE layer.
 *
 * The planner (src/planner/*) is pure and knows nothing about the database.
 * This file is the opposite: it does all the reading and writing, and calls the
 * planner in the middle to do the actual thinking.
 *
 *    LOAD    read the course, topics and holidays
 *    THINK   call the pure planner functions
 *    SAVE    write the sessions back
 */

import type { PoolClient } from "pg";
import { pool, transaction } from "../db/pool.ts";
import { assertCourseOwned } from "./ownership.ts";
import { badRequest } from "../http.ts";

import { generateSlots, mergeExtraDates, suggestMakeupDates } from "../planner/slots.ts";
import {
  allocateTopics,
  calculateDeficit,
  type PlannerTopic,
  type PlannedSession,
} from "../planner/allocate.ts";
import { validateAssessmentDates, type PlannerAssessment } from "../planner/assessments.ts";
import { replan, type ExistingSession } from "../planner/replan.ts";
import { buildDeficitOptions, applyDeficitOption } from "../planner/deficit.ts";
import { scheduleHealth } from "../planner/health.ts";

// ------------------------------------------------------------- loading

async function loadTopics(courseId: string, client?: PoolClient): Promise<PlannerTopic[]> {
  const run = client ?? pool;
  const result = await run.query(
    `select id, order_no, title, sessions_needed, min_sessions, priority
       from topic
      where course_id = $1 and status <> 'dropped'
      order by order_no`,
    [courseId],
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    order_no: r.order_no,
    title: r.title,
    sessions_needed: r.sessions_needed,
    min_sessions: r.min_sessions,
    priority: r.priority,
  }));
}

async function loadActiveHolidays(courseId: string, client?: PoolClient): Promise<string[]> {
  const run = client ?? pool;
  const result = await run.query(
    `select to_char(date, 'YYYY-MM-DD') as date
       from holiday
      where course_id = $1 and is_active = true`,
    [courseId],
  );
  return result.rows.map((r) => r.date as string);
}

/** Makeup classes the teacher already agreed to, from the "Extend" option. */
async function loadMakeupDates(courseId: string, client?: PoolClient): Promise<string[]> {
  const run = client ?? pool;
  const result = await run.query(
    `select to_char(date, 'YYYY-MM-DD') as date
       from makeup_date
      where course_id = $1
      order by date`,
    [courseId],
  );
  return result.rows.map((r) => r.date as string);
}

async function loadExistingSessions(
  courseId: string,
  client?: PoolClient,
): Promise<ExistingSession[]> {
  const run = client ?? pool;
  const result = await run.query(
    `select id, topic_id, to_char(date, 'YYYY-MM-DD') as date, status, part_no
       from session
      where course_id = $1
      order by date`,
    [courseId],
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    topic_id: r.topic_id === null ? null : Number(r.topic_id),
    date: r.date,
    status: r.status,
    part_no: r.part_no,
  }));
}

async function loadAssessments(
  courseId: string,
  client?: PoolClient,
): Promise<PlannerAssessment[]> {
  const run = client ?? pool;
  const result = await run.query(
    `select a.id, a.title, to_char(a.date, 'YYYY-MM-DD') as date,
            coalesce(array_agg(at.topic_id) filter (where at.topic_id is not null), '{}') as topic_ids
       from assessment a
       left join assessment_topic at on at.assessment_id = a.id
      where a.course_id = $1
      group by a.id`,
    [courseId],
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    date: r.date,
    topic_ids: (r.topic_ids as string[]).map(Number),
  }));
}

// ------------------------------------------------------------- saving

/**
 * Replace every `planned` session with a fresh set.
 *
 * Only planned rows are deleted. A conducted or cancelled class is history and
 * is never rewritten — that is the "freeze the past" rule of Section 3.4.
 *
 * `makeupDates` is the set of dates that are makeup classes, so those rows get
 * kind = 'makeup' and the teacher can see which classes are extra.
 */
async function writeSessions(
  client: PoolClient,
  courseId: string,
  sessions: PlannedSession[],
  makeupDates: Set<string> = new Set(),
): Promise<void> {
  await client.query(`delete from session where course_id = $1 and status = 'planned'`, [courseId]);

  if (sessions.length === 0) return;

  await client.query(
    `insert into session (course_id, topic_id, date, week_no, part_no, total_parts, kind)
     select $1, t.topic_id, t.date, t.week_no, t.part_no, t.total_parts, t.kind
       from unnest($2::bigint[], $3::date[], $4::int[], $5::int[], $6::int[], $7::text[])
         as t(topic_id, date, week_no, part_no, total_parts, kind)`,
    [
      courseId,
      sessions.map((s) => s.topic_id),
      sessions.map((s) => s.date),
      sessions.map((s) => s.week_no),
      sessions.map((s) => s.part_no),
      sessions.map((s) => s.total_parts),
      sessions.map((s) => (makeupDates.has(s.date) ? "makeup" : "regular")),
    ],
  );
}

/** Save the new dates for any assessment the planner had to move. */
async function applyAssessmentMoves(
  client: PoolClient,
  moves: { assessment_id: number; from: string; to: string; reason: string }[],
): Promise<void> {
  for (const m of moves) {
    await client.query(
      `update assessment
          set date = $2,
              original_date = coalesce(original_date, $3),
              move_reason = $4
        where id = $1`,
      [m.assessment_id, m.to, m.from, m.reason],
    );
  }
}

// ---------------------------------------------------------- operations

/**
 * POST /courses/:id/plan/generate — build the timetable from scratch.
 *
 * This is the BEFORE-THE-SEMESTER path. It lays out every topic across every
 * slot from the start date onwards.
 *
 * Once any class has been conducted it refuses, because it would schedule a
 * second class onto a date that already has a conducted one, and it would ignore
 * teaching that has already happened. Mid-semester, the correct endpoint is
 * /plan/replan, which freezes the past (Section 3.4).
 *
 * `reset: true` overrides that and starts completely over. It DELETES the
 * conducted classes too, and with them their attendance, so it asks for the flag
 * explicitly rather than guessing.
 */
export async function generatePlan(
  courseId: string,
  teacherId: string,
  options: { reset?: boolean } = {},
) {
  const course = await assertCourseOwned(courseId, teacherId);

  const conducted = await pool.query(
    `select count(*)::int as n from session
      where course_id = $1 and status <> 'planned'`,
    [courseId],
  );

  const alreadyHappened = conducted.rows[0]?.n ?? 0;

  if (alreadyHappened > 0 && options.reset !== true) {
    throw badRequest(
      `This course already has ${alreadyHappened} class(es) marked conducted or cancelled. ` +
        `Use POST /courses/${courseId}/plan/replan to rebuild the future without ` +
        `touching them, or send { "reset": true } to start the whole plan over ` +
        `(which deletes those classes and their attendance).`,
    );
  }

  return transaction(async (client) => {
    if (options.reset === true) {
      await client.query(`delete from session where course_id = $1`, [courseId]);
    }

    const topics = await loadTopics(courseId, client);
    const holidays = await loadActiveHolidays(courseId, client);
    const makeupDates = await loadMakeupDates(courseId, client);

    // THINK
    const regular = generateSlots(course.start_date, course.end_date, course.class_days, holidays);
    const slots = mergeExtraDates(regular, makeupDates, course.start_date);
    const { sessions, overflow, unusedSlots } = allocateTopics(slots, topics);

    // SAVE
    await writeSessions(client, courseId, sessions, new Set(makeupDates));

    // A quiz must never fall before its topics are taught.
    const assessments = await loadAssessments(courseId, client);
    const titles = new Map(topics.map((t) => [t.id, t.title]));
    const moves = validateAssessmentDates(sessions, slots, assessments, titles);
    await applyAssessmentMoves(client, moves);

    return {
      sessions,
      overflow,
      assessments_moved: moves,
      slots_total: slots.length,
      slots_unused: unusedSlots.length,
      deficit: calculateDeficit(slots.length, overflow),
    };
  });
}

/** POST /courses/:id/plan/replan — freeze the past, rebuild the future. */
export async function replanCourse(courseId: string, teacherId: string, today: string, reason: string) {
  const course = await assertCourseOwned(courseId, teacherId);

  return transaction(async (client) => {
    const topics = await loadTopics(courseId, client);
    const holidays = await loadActiveHolidays(courseId, client);
    const existingSessions = await loadExistingSessions(courseId, client);
    const makeupDates = await loadMakeupDates(courseId, client);

    // THINK
    const result = replan({
      today,
      startDate: course.start_date,
      endDate: course.end_date,
      classDays: course.class_days,
      holidays,
      existingSessions,
      topics,
      extraDates: makeupDates,
    });

    // SAVE
    await writeSessions(client, courseId, result.sessions, new Set(makeupDates));

    const assessments = await loadAssessments(courseId, client);
    const titles = new Map(topics.map((t) => [t.id, t.title]));
    const slots = mergeExtraDates(
      generateSlots(today, course.end_date, course.class_days, holidays),
      makeupDates.filter((d) => d >= today),
      course.start_date,
    );
    const moves = validateAssessmentDates(result.sessions, slots, assessments, titles);
    await applyAssessmentMoves(client, moves);

    await client.query(
      `insert into replan_log (course_id, reason, changes) values ($1, $2, $3)`,
      [courseId, reason, JSON.stringify({ changes: result.changes, assessments_moved: moves })],
    );

    return {
      frozen: result.frozen.length,
      sessions: result.sessions,
      changes: result.changes,
      assessments_moved: moves,
      overflow: result.overflow,
      slots_available: result.slotsAvailable,
      deficit: result.deficit,
    };
  });
}

/** GET /courses/:id/plan/deficit — the three resolution options. */
export async function getDeficitOptions(courseId: string, teacherId: string, today: string) {
  const course = await assertCourseOwned(courseId, teacherId);

  const topics = await loadTopics(courseId);
  const holidays = await loadActiveHolidays(courseId);
  const existingSessions = await loadExistingSessions(courseId);
  const makeupDates = await loadMakeupDates(courseId);

  const result = replan({
    today,
    startDate: course.start_date,
    endDate: course.end_date,
    classDays: course.class_days,
    holidays,
    existingSessions,
    topics,
    extraDates: makeupDates,
  });

  const conducted = new Set(
    existingSessions.filter((s) => s.status === "conducted" && s.topic_id !== null).map((s) => s.topic_id!),
  );
  const remaining = topics.filter((t) => result.overflow.some((o) => o.id === t.id) || !conducted.has(t.id));

  // Do not offer a date that is already booked as a makeup class.
  const alreadyBooked = new Set(makeupDates);
  const makeups = suggestMakeupDates(
    today,
    course.end_date,
    course.class_days,
    holidays,
    Math.max(result.deficit, 0) + 10,
  ).filter((d) => !alreadyBooked.has(d));

  return {
    ...buildDeficitOptions(Math.max(result.deficit, 0), remaining, makeups),
    slots_available: result.slotsAvailable,
    sessions_needed: result.slotsAvailable + result.deficit,
  };
}

/** POST /courses/:id/plan/deficit/apply — apply the teacher's choice, then replan. */
export async function applyDeficitChoice(
  courseId: string,
  teacherId: string,
  today: string,
  choice: "drop" | "compress" | "extend",
) {
  const options = await getDeficitOptions(courseId, teacherId, today);
  const topics = await loadTopics(courseId);
  const applied = applyDeficitOption(choice, options, topics);

  await transaction(async (client) => {
    if (applied.droppedTopicIds.length > 0) {
      await client.query(
        `update topic set status = 'dropped' where id = any($1::bigint[]) and course_id = $2`,
        [applied.droppedTopicIds, courseId],
      );
    }

    for (const t of applied.topics) {
      await client.query(
        `update topic set sessions_needed = $2 where id = $1 and course_id = $3`,
        [t.id, t.sessions_needed, courseId],
      );
    }

    // Remembered permanently, so every future replan can still use them.
    if (applied.extraDates.length > 0) {
      await client.query(
        `insert into makeup_date (course_id, date, reason)
         select $1, d, 'Added to cover a shortage of classes'
           from unnest($2::date[]) as d
         on conflict (course_id, date) do nothing`,
        [courseId, applied.extraDates],
      );
    }
  });

  return replanCourse(courseId, teacherId, today, `Applied deficit option: ${choice}`);
}

/** GET /courses/:id/sessions — the saved plan, week by week. */
export async function getSessions(courseId: string, teacherId: string) {
  await assertCourseOwned(courseId, teacherId);

  const result = await pool.query(
    `select s.id, to_char(s.date, 'YYYY-MM-DD') as date, s.week_no, s.topic_id,
            t.title as topic_title, s.part_no, s.total_parts,
            s.status, s.kind, s.cancel_reason
       from session s
       left join topic t on t.id = s.topic_id
      where s.course_id = $1
      order by s.date`,
    [courseId],
  );

  return result.rows;
}

/** The dashboard's schedule-health numbers. */
export async function getScheduleHealth(courseId: string, teacherId: string, today: string) {
  const course = await assertCourseOwned(courseId, teacherId);

  const sessions = await loadExistingSessions(courseId);
  const topics = await loadTopics(courseId);

  const completed = await pool.query(
    `select count(*)::int as n from topic where course_id = $1 and status = 'completed'`,
    [courseId],
  );

  return scheduleHealth({
    today,
    classesPerWeek: course.class_days.length,
    sessions: sessions.map((s) => ({ date: s.date, status: s.status })),
    totalTopics: topics.length,
    completedTopics: completed.rows[0]?.n ?? 0,
  });
}
