/**
 * Course material (Module M6).
 *
 * The file itself never passes through Express. CLAUDE.md: "Do not upload files
 * through Express. The app uploads directly to a Supabase Storage bucket and
 * sends the returned path to the API, which saves it in the material table."
 *
 * So all this file stores is a row pointing at the storage path.
 */

import { pool } from "../db/pool.ts";
import { badRequest, notFound } from "../http.ts";
import { assertCourseOwned } from "./ownership.ts";

/** POST /courses/:id/materials — save the record after the app has uploaded. */
export async function saveMaterial(
  courseId: string,
  teacherId: string,
  body: {
    title?: unknown;
    storage_path?: unknown;
    topic_id?: unknown;
    mime_type?: unknown;
    size_bytes?: unknown;
  },
) {
  await assertCourseOwned(courseId, teacherId);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "") throw badRequest("title is required");

  const storagePath = typeof body.storage_path === "string" ? body.storage_path.trim() : "";
  if (storagePath === "") {
    throw badRequest("storage_path is required — upload the file to Supabase Storage first");
  }

  // A topic is optional, but if one is named it has to belong to this course.
  let topicId: string | null = null;
  if (body.topic_id !== undefined && body.topic_id !== null) {
    const found = await pool.query(
      `select id from topic where id = $1 and course_id = $2`,
      [String(body.topic_id), courseId],
    );
    if (found.rowCount === 0) throw notFound("Topic");
    topicId = String(body.topic_id);
  }

  const sizeBytes =
    body.size_bytes === undefined || body.size_bytes === null ? null : Number(body.size_bytes);

  if (sizeBytes !== null && (!Number.isFinite(sizeBytes) || sizeBytes < 0)) {
    throw badRequest("size_bytes must be a positive number");
  }

  const created = await pool.query(
    `insert into material (course_id, topic_id, title, storage_path, mime_type, size_bytes)
     values ($1, $2, $3, $4, $5, $6)
     returning id, course_id, topic_id, title, storage_path, mime_type, size_bytes, uploaded_at`,
    [
      courseId,
      topicId,
      title,
      storagePath,
      body.mime_type === undefined || body.mime_type === null ? null : String(body.mime_type),
      sizeBytes,
    ],
  );

  return created.rows[0];
}

/** GET /courses/:id/materials — grouped by topic, which is how the screen shows it. */
export async function listMaterials(courseId: string, teacherId: string) {
  await assertCourseOwned(courseId, teacherId);

  const result = await pool.query(
    `select m.id, m.topic_id, t.title as topic_title, m.title,
            m.storage_path, m.mime_type, m.size_bytes, m.uploaded_at
       from material m
       left join topic t on t.id = m.topic_id
      where m.course_id = $1
      order by t.order_no nulls last, m.uploaded_at desc`,
    [courseId],
  );

  const materials = result.rows.map((r) => ({
    ...r,
    size_bytes: r.size_bytes === null ? null : Number(r.size_bytes),
  }));

  // Files with no topic sit in an "Unsorted" folder at the end.
  const folders = new Map<string, typeof materials>();
  for (const m of materials) {
    const key = m.topic_title ?? "Unsorted";
    const list = folders.get(key) ?? [];
    list.push(m);
    folders.set(key, list);
  }

  return {
    materials,
    folders: [...folders.entries()].map(([topic_title, items]) => ({
      topic_title,
      topic_id: items[0]?.topic_id ?? null,
      count: items.length,
      materials: items,
    })),
  };
}

/** DELETE /materials/:id — remove the record. The stored file is removed by the app. */
export async function deleteMaterial(materialId: string, teacherId: string) {
  const result = await pool.query(
    `delete from material m
      using course c
      where m.id = $1 and c.id = m.course_id and c.teacher_id = $2
      returning m.id, m.storage_path`,
    [materialId, teacherId],
  );

  const row = result.rows[0];
  if (!row) throw notFound("Material");

  // The path is returned so the app knows which stored file to delete next.
  return { id: row.id, storage_path: row.storage_path };
}
