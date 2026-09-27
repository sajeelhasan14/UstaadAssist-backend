/**
 * Routes mounted at /assessments.
 *
 * Marks belong to one assessment, so the URL carries the assessment id.
 * Creating and listing assessments lives under /courses/:id/assessments.
 */

import { Router } from "express";
import { ok, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { saveMarks, getMarks } from "../services/grading.service.ts";

const router = Router();

/**
 * GET /assessments/:id/marks
 *
 * Returns the whole class list in roll-number order, with whatever marks are
 * already entered. The entry screen needs every student, not just the ones with
 * a mark, so it can move down the list with the keypad.
 */
router.get("/:id/marks", requireAuth, async (req, res) => {
  ok(res, await getMarks(pathId(req.params, "id"), req.auth!.userId));
});

// POST /assessments/:id/marks — save what the teacher has entered so far
router.post("/:id/marks", requireAuth, async (req, res) => {
  const result = await saveMarks(pathId(req.params, "id"), req.auth!.userId, req.body ?? {});
  ok(res, result, 201);
});

export default router;
