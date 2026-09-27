/**
 * Document extraction — class lists and course outlines.
 *
 *   1. DOWNLOAD the file from Supabase Storage, as the signed-in teacher
 *   2. READ it into lines of text   (src/extraction/readText.ts: PDF text or Tesseract OCR)
 *   3. PARSE the lines into rows    (src/extraction/classList.ts / outline.ts — pure)
 *
 * Free and self-contained: no paid or external AI service is involved.
 *
 * Two rules from CLAUDE.md that this keeps:
 *
 *   1. Nothing extracted is ever written to the database. The rows go to the
 *      teacher's review screen first (§3.7). A misread roll number would
 *      silently corrupt that student's record for the whole semester.
 *
 *   2. The file never travels through Express from the app. The app uploads it
 *      to Supabase Storage and sends the path; this server fetches it from there.
 *
 * The download uses the TEACHER'S OWN token, not an admin key, so Supabase's
 * storage policies decide what can be read: a teacher can only ever read files
 * in the folder named after their own user id.
 */

import { env } from "../env.ts";
import { AppError, badRequest } from "../http.ts";
import { mergeReadings, parseClassList, type ClassListRow } from "../extraction/classList.ts";
import { parseOutline, type OutlineRow } from "../extraction/outline.ts";
import { readText, type ReadText } from "../extraction/readText.ts";

/** One row read off a printed class list. Either field may be missing. */
export type ExtractedStudent = ClassListRow;

/** One topic line read off a course outline. */
export type ExtractedTopic = OutlineRow;

export type ExtractionResult<T> = {
  rows: T[];
  page_count: number;
  /** Which reader produced the rows, so the review screen can say so. */
  source: string;
};

/** Who is asking — the verified token is used to fetch their file. */
export type Requester = { userId: string; token: string };

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "materials";

/** Files larger than this are refused before any work is done. */
const MAX_BYTES = 20 * 1024 * 1024;

async function download(storagePath: string, requester: Requester): Promise<{ bytes: Uint8Array; mimeType: string }> {
  // The app stores every file under "<user id>/...". Checking it here gives a
  // clear message; the storage policies would refuse it anyway.
  if (!storagePath.startsWith(`${requester.userId}/`)) {
    throw badRequest("storage_path must be inside your own folder: <your user id>/...");
  }

  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!anonKey) {
    throw new AppError(
      503,
      "Reading files is not configured on the server: SUPABASE_ANON_KEY is missing. Use the paste option for now.",
    );
  }

  const path = storagePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${requester.token}` },
  });

  if (response.status === 400 || response.status === 404) {
    throw new AppError(404, "The uploaded file could not be found. Please upload it again.");
  }
  if (!response.ok) {
    throw new AppError(502, `Could not fetch the uploaded file from storage (${response.status}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    throw badRequest("That file is larger than 20 MB. Upload a smaller PDF or photo.");
  }

  return { bytes, mimeType: response.headers.get("content-type") ?? "" };
}

async function readFile(storagePath: string, requester: Requester): Promise<ReadText> {
  const { bytes, mimeType } = await download(storagePath, requester);
  return readText(bytes, mimeType);
}

const SOURCE_LABEL: Record<ReadText["source"], string> = {
  "pdf-text": "Read from the PDF's text",
  "tesseract-ocr": "Read from the photo (OCR)",
};

/**
 * Read a photo or PDF of a printed class list and return one row per student.
 * Returns a draft for the review screen — it never saves anything.
 */
export async function extractStudents(
  storagePath: string,
  requester: Requester,
): Promise<ExtractionResult<ExtractedStudent>> {
  const text = await readFile(storagePath, requester);
  const fromOcr = text.source === "tesseract-ocr";

  // A PDF has one exact reading. A photo has several, which vote; the most
  // complete reading goes first so it sets the row order.
  const complete = (rows: ClassListRow[]) => rows.filter((r) => r.roll_no && r.name).length;
  const parsed = text.readings.map((lines) => parseClassList(lines, fromOcr)).sort((a, b) => complete(b) - complete(a));
  const rows = fromOcr ? mergeReadings(parsed) : parsed[0];

  if (rows.length === 0) {
    throw new AppError(
      422,
      "No seat numbers were found. Make sure the whole list is in the photo, in good light, then try again — or paste the list instead.",
    );
  }

  return { rows, page_count: text.pageCount, source: SOURCE_LABEL[text.source] };
}

/**
 * Read a course outline and return the teaching topics in order.
 * `classesPerWeek` turns "Week 3–4" into a number of classes.
 */
export async function extractTopics(
  storagePath: string,
  requester: Requester,
  classesPerWeek: number,
): Promise<ExtractionResult<ExtractedTopic>> {
  const text = await readFile(storagePath, requester);
  const fromOcr = text.source === "tesseract-ocr";

  // Keep the reading that found the most topics.
  const rows = text.readings
    .map((lines) => parseOutline(lines, classesPerWeek, fromOcr))
    .reduce((best, candidate) => (candidate.length > best.length ? candidate : best));

  if (rows.length === 0) {
    throw new AppError(
      422,
      "No topics were found. Topics are recognised when listed by week or lecture (\"Week 3: Normalization\") or as a numbered list. You can type or paste them instead.",
    );
  }

  return { rows, page_count: text.pageCount, source: SOURCE_LABEL[text.source] };
}
