import { Router } from "express";
import { ok } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { pool } from "../db/pool.ts";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const { userId, email } = req.auth!;

  const result = await pool.query(
    `insert into teacher (id, email)
     values ($1, $2)
     on conflict (id) do update set email = excluded.email
     returning id, email, full_name, department, created_at`,
    [userId, email],
  );

  ok(res, result.rows[0]);
});

export default router;
