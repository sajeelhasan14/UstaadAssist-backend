/**
 * Routes mounted at /students.
 *
 * A student belongs to the teacher rather than to one course, so this route has
 * no course id in it. The record it returns covers every course of that teacher
 * the student is enrolled in.
 */

import { Router } from "express";
import { ok, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { getStudent } from "../services/student.service.ts";

const router = Router();

// GET /students/:id — one student: attendance record and marks
router.get("/:id", requireAuth, async (req, res) => {
  ok(res, await getStudent(pathId(req.params, "id"), req.auth!.userId));
});

export default router;
