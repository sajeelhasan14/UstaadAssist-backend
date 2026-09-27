/**
 * The planner endpoints — the heart of the app (CLAUDE.md Section 3).
 *
 * Every route here is thin on purpose. It does three things and nothing more:
 *
 *   1. read the input off the request
 *   2. hand it to the plan service
 *   3. send the answer back with ok()
 *
 * All the real work lives in src/planner (pure thinking) and
 * src/services/plan.service.ts (loading and saving).
 */

import { Router } from "express";
import { ok, badRequest, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import {
  generatePlan,
  replanCourse,
  getDeficitOptions,
  applyDeficitChoice,
  getSessions,
} from "../services/plan.service.ts";

const router = Router();

/**
 * The date the planner treats as "now".
 *
 * Normally it is simply today on the server. A test or a demo can pass
 * `today` in the body to pretend it is any other date, which is how the whole
 * semester can be shown off without waiting four months.
 */
function resolveToday(body: unknown): string {
  const given = (body as { today?: unknown } | undefined)?.today;
  if (given === undefined) return new Date().toISOString().slice(0, 10);

  if (typeof given !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(given)) {
    throw badRequest("today must be a date in YYYY-MM-DD form");
  }
  return given;
}

// POST /courses/:courseId/plan/generate — build the whole timetable
router.post("/:courseId/plan/generate", requireAuth, async (req, res) => {
  const result = await generatePlan(pathId(req.params, "courseId"), req.auth!.userId, {
    reset: req.body?.reset === true,
  });
  ok(res, result, 201);
});

// POST /courses/:courseId/plan/replan — freeze the past, rebuild the future
router.post("/:courseId/plan/replan", requireAuth, async (req, res) => {
  const today = resolveToday(req.body);
  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim() !== ""
      ? req.body.reason.trim()
      : "Manual replan";

  const result = await replanCourse(pathId(req.params, "courseId"), req.auth!.userId, today, reason);
  ok(res, result);
});

// GET /courses/:courseId/plan/deficit — the three ways out of a shortage
router.get("/:courseId/plan/deficit", requireAuth, async (req, res) => {
  const today = resolveToday({ today: req.query.today });
  const result = await getDeficitOptions(pathId(req.params, "courseId"), req.auth!.userId, today);
  ok(res, result);
});

// POST /courses/:courseId/plan/deficit/apply — apply the teacher's choice
router.post("/:courseId/plan/deficit/apply", requireAuth, async (req, res) => {
  const choice = req.body?.option;

  if (choice !== "drop" && choice !== "compress" && choice !== "extend") {
    throw badRequest("option must be one of: drop, compress, extend");
  }

  const today = resolveToday(req.body);
  const result = await applyDeficitChoice(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    today,
    choice,
  );

  ok(res, result);
});

// GET /courses/:courseId/sessions — the saved plan, week by week
router.get("/:courseId/sessions", requireAuth, async (req, res) => {
  const sessions = await getSessions(pathId(req.params, "courseId"), req.auth!.userId);

  // The app draws the plan as a list of weeks, so group it here rather than
  // making every screen do the same loop.
  const weeks = new Map<number, typeof sessions>();
  for (const s of sessions) {
    const list = weeks.get(s.week_no) ?? [];
    list.push(s);
    weeks.set(s.week_no, list);
  }

  ok(res, {
    sessions,
    weeks: [...weeks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week_no, items]) => ({ week_no, sessions: items })),
  });
});

export default router;
