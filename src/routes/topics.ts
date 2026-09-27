/**
 * Routes mounted at /topics.
 *
 * Creating topics happens at POST /courses/:id/topics, because a topic belongs
 * to a course. Editing one happens here, because by then the app only has the
 * topic id in hand — it is editing a row it is already looking at.
 */

import { Router } from "express";
import { ok, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { updateTopic } from "../services/course.service.ts";

const router = Router();

// PATCH /topics/:id — sessions_needed, min_sessions, priority, order_no, status
router.patch("/:id", requireAuth, async (req, res) => {
  const topic = await updateTopic(pathId(req.params, "id"), req.auth!.userId, req.body ?? {});
  ok(res, topic);
});

export default router;
