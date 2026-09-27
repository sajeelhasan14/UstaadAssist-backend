/**
 * Sessions — marking a class conducted or cancelled (Module M2).
 *
 * Marking a class conducted is what drives the whole progress picture: the
 * planner reads `status = 'conducted'` to freeze the past, the dashboard counts
 * them to work out how far behind the teacher is, and a topic becomes
 * "completed" once all of its classes are done.
 */

import { pool, transaction } from "../db/pool.ts";
import { badRequest, notFound } from "../http.ts";
import { assertSessionOwned } from "./ownership.ts";

/**
 * Recalculate one topic's status from its sessions.
 *
 * The status is never set by hand, because it would drift. It is always derived:
 *
 *   no class conducted yet          -> pending
 *   some conducted, some remaining  -> in_progress
 *   every class conducted           -> completed
 *
 * A dropped topic is left alone — the teacher dropped it deliberately.
 */
export async function refreshTopicStatus(
  client: { query: typeof pool.query },
  topicId: string,
): Promise<void> {
  await client.query(
    `update topic t
        set status = case
              when t.status = 'dropped'            then 'dropped'
              when counts.conducted = 0            then 'pending'
              when counts.conducted >= counts.total then 'completed'
              else 'in_progress'
            end
       from (
         select count(*) filter (where status = 'conducted') as conducted,
                count(*) filter (where status <> 'cancelled') as total
           from session
          where topic_id = $1
       ) as counts
      where t.id = $1`,
    [topicId],
  );
}

/** PATCH /sessions/:id — mark a class conducted or cancelled. */
export async function updateSession(
  sessionId: string,
  teacherId: string,
  body: { status?: unknown; cancel_reason?: unknown },
) {
  await assertSessionOwned(sessionId, teacherId);

  const { status, cancel_reason } = body;

  if (status !== "planned" && status !== "conducted" && status !== "cancelled") {
    throw badRequest("status must be one of: planned, conducted, cancelled");
  }

  if (status === "cancelled" && (typeof cancel_reason !== "string" || cancel_reason.trim() === "")) {
    throw badRequest("cancel_reason is required when cancelling a class");
  }

  return transaction(async (client) => {
    const updated = await client.query(
      `update session
          set status        = $2,
              cancel_reason = case when $2 = 'cancelled' then $3 else null end,
              updated_at    = now()
        where id = $1
        returning id, course_id, topic_id, to_char(date, 'YYYY-MM-DD') as date,
                  week_no, part_no, total_parts, status, kind, cancel_reason`,
      [sessionId, status, typeof cancel_reason === "string" ? cancel_reason.trim() : null],
    );

    const session = updated.rows[0];
    if (!session) throw notFound("Session");

    if (session.topic_id !== null) {
      await refreshTopicStatus(client, String(session.topic_id));
    }

    return session;
  });
}
