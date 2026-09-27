/**
 * Course settings, cloning and topic edits.
 *
 * Nothing here does any planning. But two of these operations invalidate the
 * plan — changing the dates or the class days, and changing how many classes a
 * topic needs — so they tell the caller that a replan is due. CLAUDE.md Section
 * 3.4 names exactly those triggers.
 */

import { pool, transaction } from "../db/pool.ts";
import { badRequest } from "../http.ts";
import { assertCourseOwned, assertTopicOwned } from "./ownership.ts";
import { holidaysBetween } from "../data/pakHolidays.ts";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** GET /courses — the teacher's courses, with enough to draw the list screen. */
export async function listCourses(teacherId: string) {
  const result = await pool.query(
    `select c.id, c.name, c.code, c.semester,
            to_char(c.start_date, 'YYYY-MM-DD') as start_date,
            to_char(c.end_date,   'YYYY-MM-DD') as end_date,
            c.class_days, c.attendance_threshold, c.created_at,
            (select count(*) from topic t where t.course_id = c.id)::int as topic_count,
            (select count(*) from enrollment e where e.course_id = c.id)::int as student_count,
            (select count(*) from session s where s.course_id = c.id)::int as session_count,
            (select count(*) from session s
              where s.course_id = c.id and s.status = 'conducted')::int as conducted_count
       from course c
      where c.teacher_id = $1
      order by c.created_at desc`,
    [teacherId],
  );

  return result.rows.map((r) => ({
    ...r,
    attendance_threshold: Number(r.attendance_threshold),
    has_plan: r.session_count > 0,
  }));
}

/** GET /courses/:id — one course with its topics and holidays, for the setup screen. */
export async function getCourse(courseId: string, teacherId: string) {
  const course = await assertCourseOwned(courseId, teacherId);

  const topics = await pool.query(
    `select id, order_no, title, sessions_needed, min_sessions, priority, status
       from topic where course_id = $1 order by order_no`,
    [courseId],
  );

  const holidays = await pool.query(
    `select id, to_char(date, 'YYYY-MM-DD') as date, name, is_active, source
       from holiday where course_id = $1 order by date`,
    [courseId],
  );

  return {
    ...course,
    attendance_threshold: Number(course.attendance_threshold),
    topics: topics.rows,
    holidays: holidays.rows,
  };
}

/**
 * PATCH /courses/:id — edit the course settings.
 *
 * Only the fields actually sent are changed, so the app can send one field from
 * one screen without having to resend the whole course.
 */
export async function updateCourse(
  courseId: string,
  teacherId: string,
  body: Record<string, unknown>,
) {
  const existing = await assertCourseOwned(courseId, teacherId);

  const sets: string[] = [];
  const values: unknown[] = [courseId];
  let planAffected = false;

  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") throw badRequest("name cannot be empty");
    set("name", name);
  }

  if (body.code !== undefined) set("code", body.code === null ? null : String(body.code));
  if (body.semester !== undefined) {
    set("semester", body.semester === null ? null : String(body.semester));
  }

  if (body.attendance_threshold !== undefined) {
    const threshold = Number(body.attendance_threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      throw badRequest("attendance_threshold must be between 0 and 100");
    }
    set("attendance_threshold", threshold);
  }

  const startDate = body.start_date === undefined ? existing.start_date : String(body.start_date);
  const endDate = body.end_date === undefined ? existing.end_date : String(body.end_date);

  if (body.start_date !== undefined || body.end_date !== undefined) {
    for (const [label, value] of [["start_date", startDate], ["end_date", endDate]] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw badRequest(`${label} must be in YYYY-MM-DD form`);
      }
    }
    if (endDate <= startDate) throw badRequest("end_date must be after start_date");

    if (body.start_date !== undefined) set("start_date", startDate);
    if (body.end_date !== undefined) set("end_date", endDate);
    planAffected = true;
  }

  if (body.class_days !== undefined) {
    const days = body.class_days;
    if (!Array.isArray(days) || days.length === 0) {
      throw badRequest("class_days must be a non-empty array");
    }
    const bad = days.filter((d) => !DAYS.includes(String(d)));
    if (bad.length > 0) {
      throw badRequest(`class_days contains something that is not a day: ${bad.join(", ")}`);
    }
    set("class_days", days.map(String));
    planAffected = true;
  }

  if (sets.length === 0) throw badRequest("Nothing to update");

  return transaction(async (client) => {
    const updated = await client.query(
      `update course set ${sets.join(", ")}, updated_at = now()
        where id = $1
        returning id, name, code, semester,
                  to_char(start_date, 'YYYY-MM-DD') as start_date,
                  to_char(end_date,   'YYYY-MM-DD') as end_date,
                  class_days, attendance_threshold`,
      values,
    );

    // Stretching the semester can expose public holidays that were outside the
    // old date range, so top them up. Existing rows keep whatever the teacher
    // ticked, because of `do nothing`.
    if (planAffected) {
      const holidays = holidaysBetween(startDate, endDate);
      if (holidays.length > 0) {
        await client.query(
          `insert into holiday (course_id, date, name)
           select $1, h.date, h.name
             from unnest($2::date[], $3::text[]) as h(date, name)
           on conflict (course_id, date) do nothing`,
          [courseId, holidays.map((h) => h.date), holidays.map((h) => h.name)],
        );
      }
    }

    const course = updated.rows[0];

    return {
      ...course,
      attendance_threshold: Number(course.attendance_threshold),
      // The app shows a "your plan needs rebuilding" prompt when this is true.
      replan_required: planAffected,
    };
  });
}

/**
 * PATCH /topics/:id — correct one topic after seeing the generated plan.
 *
 * This is the other half of the minimum-input rule. The teacher pastes bare
 * titles, generates a plan, sees that Normalization needs three classes rather
 * than one, and fixes it here.
 */
export async function updateTopic(
  topicId: string,
  teacherId: string,
  body: Record<string, unknown>,
) {
  const courseId = await assertTopicOwned(topicId, teacherId);

  const sets: string[] = [];
  const values: unknown[] = [topicId];
  let planAffected = false;

  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title === "") throw badRequest("title cannot be empty");
    set("title", title);
  }

  if (body.sessions_needed !== undefined) {
    const value = Number(body.sessions_needed);
    if (!Number.isInteger(value) || value < 1) {
      throw badRequest("sessions_needed must be a whole number of 1 or more");
    }
    set("sessions_needed", value);
    planAffected = true;
  }

  if (body.min_sessions !== undefined) {
    const value = Number(body.min_sessions);
    if (!Number.isInteger(value) || value < 1) {
      throw badRequest("min_sessions must be a whole number of 1 or more");
    }
    set("min_sessions", value);
  }

  if (body.priority !== undefined) {
    if (!["low", "normal", "high"].includes(String(body.priority))) {
      throw badRequest("priority must be one of: low, normal, high");
    }
    set("priority", String(body.priority));
  }

  if (body.status !== undefined) {
    if (!["pending", "in_progress", "completed", "dropped"].includes(String(body.status))) {
      throw badRequest("status must be one of: pending, in_progress, completed, dropped");
    }
    set("status", String(body.status));
    planAffected = true;
  }

  if (body.order_no !== undefined) {
    const value = Number(body.order_no);
    if (!Number.isInteger(value) || value < 1) {
      throw badRequest("order_no must be a whole number of 1 or more");
    }
    set("order_no", value);
    planAffected = true;
  }

  if (sets.length === 0) throw badRequest("Nothing to update");

  // The database refuses min_sessions > sessions_needed (topic_min_le_needed_ck).
  // Checking it here as well turns a raw constraint error into a sentence the
  // teacher can act on.
  const current = await pool.query(
    `select sessions_needed, min_sessions from topic where id = $1`,
    [topicId],
  );
  const now = current.rows[0]!;
  const nextNeeded =
    body.sessions_needed !== undefined ? Number(body.sessions_needed) : now.sessions_needed;
  const nextMin =
    body.min_sessions !== undefined ? Number(body.min_sessions) : now.min_sessions;

  if (nextMin > nextNeeded) {
    throw badRequest(
      `min_sessions (${nextMin}) cannot be more than sessions_needed (${nextNeeded})`,
    );
  }

  const updated = await pool.query(
    `update topic set ${sets.join(", ")} where id = $1
      returning id, course_id, order_no, title, sessions_needed, min_sessions, priority, status`,
    values,
  );

  return { ...updated.rows[0], course_id: Number(courseId), replan_required: planAffected };
}

/**
 * POST /courses/:id/clone — start next semester from last semester's course.
 *
 * Topics, weightage and the grade scale are copied, because they are the work
 * the teacher does not want to do twice. Students, sessions, attendance and
 * marks are NOT copied: they belong to the semester that has finished.
 */
export async function cloneCourse(
  courseId: string,
  teacherId: string,
  body: { name?: unknown; semester?: unknown; start_date?: unknown; end_date?: unknown },
) {
  const source = await assertCourseOwned(courseId, teacherId);

  const startDate = body.start_date === undefined ? source.start_date : String(body.start_date);
  const endDate = body.end_date === undefined ? source.end_date : String(body.end_date);

  for (const [label, value] of [["start_date", startDate], ["end_date", endDate]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw badRequest(`${label} must be in YYYY-MM-DD form`);
    }
  }
  if (endDate <= startDate) throw badRequest("end_date must be after start_date");

  const name = typeof body.name === "string" && body.name.trim() !== ""
    ? body.name.trim()
    : source.name;

  const semester = body.semester === undefined ? source.semester : String(body.semester);

  return transaction(async (client) => {
    const created = await client.query(
      `insert into course (teacher_id, name, code, semester, start_date, end_date,
                           class_days, attendance_threshold)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, name, code, semester,
                 to_char(start_date, 'YYYY-MM-DD') as start_date,
                 to_char(end_date,   'YYYY-MM-DD') as end_date,
                 class_days, attendance_threshold`,
      [
        teacherId,
        name,
        source.code,
        semester,
        startDate,
        endDate,
        source.class_days,
        source.attendance_threshold,
      ],
    );

    const clone = created.rows[0];

    // Topics come across reset to 'pending': last semester's progress is not
    // this semester's progress.
    const topics = await client.query(
      `insert into topic (course_id, order_no, title, sessions_needed, min_sessions, priority)
       select $1, order_no, title, sessions_needed, min_sessions, priority
         from topic
        where course_id = $2 and status <> 'dropped'
        order by order_no
       returning id`,
      [clone.id, courseId],
    );

    await client.query(
      `insert into weightage (course_id, component, percentage)
       select $1, component, percentage from weightage where course_id = $2`,
      [clone.id, courseId],
    );

    await client.query(
      `insert into grade_scale (course_id, grade, min_percentage, order_no)
       select $1, grade, min_percentage, order_no from grade_scale where course_id = $2`,
      [clone.id, courseId],
    );

    // Public holidays are recalculated for the NEW dates, not copied. Eid moves
    // every year, so copying last year's dates would be wrong.
    const holidays = holidaysBetween(startDate, endDate);
    if (holidays.length > 0) {
      await client.query(
        `insert into holiday (course_id, date, name)
         select $1, h.date, h.name
           from unnest($2::date[], $3::text[]) as h(date, name)
         on conflict (course_id, date) do nothing`,
        [clone.id, holidays.map((h) => h.date), holidays.map((h) => h.name)],
      );
    }

    return {
      ...clone,
      attendance_threshold: Number(clone.attendance_threshold),
      copied: {
        topics: topics.rowCount ?? 0,
        holidays: holidays.length,
      },
    };
  });
}
