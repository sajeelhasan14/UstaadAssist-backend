/**
 * Routes mounted at /materials.
 *
 * Saving and listing material happens under /courses/:id/materials. Deleting one
 * happens here, because the app is acting on a single file it is looking at.
 */

import { Router } from "express";
import { ok, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { deleteMaterial } from "../services/material.service.ts";

const router = Router();

/**
 * DELETE /materials/:id
 *
 * Removes our record and returns the storage path, so the app can then delete
 * the stored file itself. The file never travels through Express in either
 * direction.
 */
router.delete("/:id", requireAuth, async (req, res) => {
  ok(res, await deleteMaterial(pathId(req.params, "id"), req.auth!.userId));
});

export default router;
