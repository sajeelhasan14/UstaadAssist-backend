/**
 * Routes mounted at /sessions.
 *
 * These act on one class, so the URL carries the session id rather than the
 * course id. Ownership is checked by joining through to the course.
 */

import { Router } from "express";
import { ok, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { updateSession } from "../services/session.service.ts";
import { submitAttendance, getSessionAttendance } from "../services/attendance.service.ts";

const router = Router();

// PATCH /sessions/:id — mark conducted or cancelled
router.patch("/:id", requireAuth, async (req, res) => {
  const session = await updateSession(pathId(req.params, "id"), req.auth!.userId, req.body ?? {});
  ok(res, session);
});

// POST /sessions/:id/attendance — submit attendance (absentees only)
router.post("/:id/attendance", requireAuth, async (req, res) => {
  const result = await submitAttendance(
    pathId(req.params, "id"),
    req.auth!.userId,
    req.body ?? {},
  );
  ok(res, result, 201);
});

// GET /sessions/:id/attendance — what is already recorded, for the edit screen
router.get("/:id/attendance", requireAuth, async (req, res) => {
  const rows = await getSessionAttendance(pathId(req.params, "id"), req.auth!.userId);
  ok(res, rows);
});

export default router;
