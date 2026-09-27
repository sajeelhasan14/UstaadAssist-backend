import type { NextFunction, Request, Response } from "express";
import { AppError } from "../http.ts";

/**
 * Nothing matched the URL.
 *
 * Without this, Express sends its own HTML 404 page, and the app would try to
 * JSON.parse a chunk of HTML and crash with a confusing error. This keeps every
 * answer from the server in the same shape, including the failures.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    data: null,
    message: `No route for ${req.method} ${req.path}`,
  });
}

/**
 * Some Postgres errors are the caller's fault, not ours, and a bare 500 hides
 * what went wrong. These are the ones worth translating.
 *
 * The codes come from the Postgres manual:
 *   23505 unique_violation       — a row with that key already exists
 *   23503 foreign_key_violation  — it points at something that is not there
 *   23514 check_violation        — a value broke one of our check constraints
 *   22P02 invalid_text_representation — e.g. "abc" where a number was expected
 */
function describeDatabaseError(code: string): { status: number; message: string } | null {
  switch (code) {
    case "23505":
      return { status: 409, message: "That record already exists" };
    case "23503":
      return { status: 400, message: "That refers to something that does not exist" };
    case "23514":
      return { status: 400, message: "One of the values is not allowed" };
    case "22P02":
      return { status: 400, message: "One of the values is the wrong type" };
    default:
      return null;
  }
}

/**
 * The one place in the whole codebase that sends an error response.
 *
 * Express recognises this as an error handler because it takes exactly FOUR
 * parameters. Remove `_next` and Express treats it as ordinary middleware, it
 * never runs on an error, and every failure becomes a hanging request. That is
 * why `_next` is here even though it is unused.
 *
 * Express 5 sends anything an async route throws here automatically, so routes
 * just `throw` and never send an error themselves.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Our own errors carry a status and a message that is safe to show.
  if (err instanceof AppError) {
    res.status(err.status).json({ success: false, data: null, message: err.message });
    return;
  }

  // express.json() could not parse the body. This is a client mistake, so it
  // gets a 400 saying so, rather than a 500 that looks like the server broke.
  // Without this the mobile team sees "Something went wrong" for a stray comma.
  if (
    err instanceof SyntaxError &&
    (err as { type?: string }).type === "entity.parse.failed"
  ) {
    res.status(400).json({
      success: false,
      data: null,
      message: "The request body is not valid JSON",
    });
    return;
  }

  // A `pg` error carries a five-character SQL state code.
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const described = describeDatabaseError(code);
    if (described) {
      // Still logged: a constraint we did not expect to be hit is worth seeing.
      console.error("[db error]", code, (err as Error).message);
      res.status(described.status).json({
        success: false,
        data: null,
        message: described.message,
      });
      return;
    }
  }

  // Anything else is genuinely our bug. The real error goes to the terminal so
  // it can be fixed; the client gets a generic message, because an internal
  // error message can leak table names, queries and file paths.
  console.error("[error]", err);

  res.status(500).json({
    success: false,
    data: null,
    message: "Something went wrong",
  });
}
