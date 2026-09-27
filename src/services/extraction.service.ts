/**
 * Document extraction — STUB.
 *
 * CLAUDE.md Section 2: "Document extraction — tool not decided yet. One
 * vision-capable service handles both the course outline and the class list
 * photo. Leave a stub with a clear interface."
 *
 * This file is that interface. When the tool is chosen, only the two functions
 * marked TODO change. Nothing that calls them has to change, because what they
 * return is already fixed.
 *
 * Two rules that must survive whatever tool is picked:
 *
 *   1. Nothing extracted is ever written straight to the database. It goes to
 *      the teacher's review screen first (Section 3.7). A misread roll number
 *      would silently corrupt that student's attendance and result for the
 *      whole semester.
 *
 *   2. The file never travels through Express. The app uploads it directly to
 *      Supabase Storage and sends us the storage path, which is what these
 *      functions take.
 */

import { AppError } from "../http.ts";

/** One row read off a printed class list. Either field may be missing. */
export type ExtractedStudent = {
  roll_no: string | null;
  name: string | null;
  /** 0–1. How sure the extractor is. The review screen highlights low values. */
  confidence: number;
};

/** One topic line read off a course outline document. */
export type ExtractedTopic = {
  title: string;
  /** Only if the outline actually states a number of weeks or lectures. */
  sessions_needed: number | null;
  confidence: number;
};

export type ExtractionResult<T> = {
  rows: T[];
  /** Which page of a multi-page document these rows came from. */
  page_count: number;
  /** The tool that read it, so the review screen can say so. */
  source: string;
};

function notConfigured(what: string): never {
  throw new AppError(
    503,
    `${what} extraction is not configured yet. ` +
      `Use the manual entry path on the review screen for now.`,
  );
}

/**
 * TODO: implement once the vision tool is chosen.
 *
 * Read a photo or PDF of a printed class list and return one row per student.
 * Returns a draft for the review screen — it never saves anything.
 */
export async function extractStudents(
  _storagePath: string,
): Promise<ExtractionResult<ExtractedStudent>> {
  notConfigured("Class list");
}

/**
 * TODO: implement once the vision tool is chosen.
 *
 * Read a course outline document and return the topic titles in order.
 */
export async function extractTopics(
  _storagePath: string,
): Promise<ExtractionResult<ExtractedTopic>> {
  notConfigured("Course outline");
}
