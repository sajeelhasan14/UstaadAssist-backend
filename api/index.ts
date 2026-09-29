/**
 * The Vercel entry point.
 *
 * Vercel does not run a server. It runs a FUNCTION per request, so there is
 * nothing to call listen() on — it needs a handler of the shape (req, res).
 *
 * An Express app already is exactly that shape, so exporting it is the whole
 * adapter. Every URL is routed here by vercel.json, and Express does the routing
 * from that point exactly as it does locally.
 *
 * Two things worth knowing about running here:
 *
 *   * Environment variables come from the Vercel dashboard, not from .env.
 *     There is no --env-file on Vercel, and .env is gitignored so it is never
 *     uploaded. The code only ever reads process.env, so nothing changes.
 *
 *   * Module-level work runs once per COLD START, not once per request. The
 *     database pool is built at module level, so a warm function reuses it and
 *     only the first request after an idle period pays for it.
 */

import app from "../src/app.ts";

export default app;
