import { Router } from "express";
import { ok } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { pool } from "../db/pool.ts";

const router = Router();

/**
 * GET /auth/me — the signed-in teacher, creating the row on the first call.
 *
 * The teacher's name comes from the sign-up form, which Supabase carries in the
 * token. It fills full_name only while it is still empty, so a name corrected
 * later in the database is never overwritten on the next sign-in.
 */
router.get("/me", requireAuth, async (req, res) => {
  const { userId, email, fullName } = req.auth!;

  const result = await pool.query(
    `insert into teacher (id, email, full_name)
     values ($1, $2, $3)
     on conflict (id) do update
       set email     = excluded.email,
           full_name = coalesce(teacher.full_name, excluded.full_name)
     returning id, email, full_name, department, created_at`,
    [userId, email, fullName],
  );

  ok(res, result.rows[0]);
});

export default router;
