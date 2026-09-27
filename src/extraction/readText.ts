/**
 * Turn a PDF or a photo into lines of text, top to bottom.
 *
 *   PDF   — the department's PDFs contain real text, so it is read directly with
 *           unpdf: exact, and fast. Text pieces are regrouped into printed lines
 *           by their position on the page, which is what keeps a table row
 *           ("1  EB24210106003  ABDUL GHANI") together.
 *   Photo — read with Tesseract, a free, open-source OCR engine. Less certain,
 *           which is why the parsers lower confidence for OCR text.
 *
 * Both are free and run inside this server. No external service is called.
 */

import { tmpdir } from "node:os";
import Tesseract from "tesseract.js";
import { extractTextItems } from "unpdf";

import { AppError } from "../http.ts";

export type ReadText = {
  /**
   * One or more readings of the same file, each as lines top to bottom. A PDF
   * has one. A photo has two — as taken, and straightened — because which one
   * reads better depends on how the photo was taken; the caller parses both and
   * keeps the better result.
   */
  readings: string[][];
  pageCount: number;
  /** Which reader produced the text, so the review screen can say so. */
  source: "pdf-text" | "tesseract-ocr";
};

/** Pieces whose baselines are this close (PDF points) belong to one printed line. */
const SAME_LINE_TOLERANCE = 2;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif"];

/** Automatic layout, single column, and sparse text: the three that read the class list sheet. */
const PHOTO_LAYOUT_MODES = [Tesseract.PSM.AUTO, Tesseract.PSM.SINGLE_COLUMN, Tesseract.PSM.SPARSE_TEXT];

async function readPdf(bytes: Uint8Array): Promise<ReadText> {
  const { totalPages, items } = await extractTextItems(bytes);
  const lines: string[] = [];

  for (const page of items) {
    // PDF y grows upwards, so the top of the page has the largest y.
    const pieces = page.filter((it) => it.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);

    let current: typeof pieces = [];
    const flush = () => {
      if (current.length === 0) return;
      lines.push(current.sort((a, b) => a.x - b.x).map((it) => it.str.trim()).join(" "));
      current = [];
    };

    for (const piece of pieces) {
      if (current.length > 0 && Math.abs(current[0].y - piece.y) > SAME_LINE_TOLERANCE) flush();
      current.push(piece);
    }
    flush();
  }

  const hasText = lines.some((l) => l.trim() !== "");
  if (!hasText) {
    // A scanned PDF is just pictures of pages, with no text inside.
    throw new AppError(
      422,
      "This PDF has no readable text (it looks like a scan). Take a photo of the printed page instead.",
    );
  }

  return { readings: [lines], pageCount: totalPages, source: "pdf-text" };
}

async function readPhoto(bytes: Uint8Array): Promise<ReadText> {
  // One worker per request: a serverless function does not keep state between
  // requests. The English model is downloaded once per cold start into /tmp.
  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, { cachePath: tmpdir() });
  try {
    const image = Buffer.from(bytes);
    const readings: string[][] = [];

    // Each layout mode, as taken and straightened. Measured on the department's
    // class list: a straight photo reads perfectly in any of these, but a tilted
    // or blurry one fails differently in each — so all are kept and the parser
    // lets them vote. ("Single block" mode is left out: it lost most rows to the
    // table's grid lines.)
    for (const mode of PHOTO_LAYOUT_MODES) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      for (const rotateAuto of [false, true]) {
        const { data } = await worker.recognize(image, { rotateAuto });
        readings.push(data.text.split("\n"));
      }
    }

    return { readings, pageCount: 1, source: "tesseract-ocr" };
  } finally {
    await worker.terminate();
  }
}

/** Read a file's text, choosing the reader by its type. */
export async function readText(bytes: Uint8Array, mimeType: string): Promise<ReadText> {
  const type = mimeType.split(";")[0].trim().toLowerCase();

  if (type === "application/pdf") return readPdf(bytes);
  if (IMAGE_TYPES.includes(type)) return readPhoto(bytes);

  throw new AppError(
    415,
    `Can't read a ${type || "file of this kind"}. Upload a PDF, or a JPG or PNG photo.`,
  );
}
