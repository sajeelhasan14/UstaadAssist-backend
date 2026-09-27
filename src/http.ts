import type { Response } from "express";

export function ok(res: Response, data: unknown, httpStatus = 200): void {
  res.status(httpStatus).json({ success: true, data, message: null });
}

export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export const notFound = (what: string) =>
  new AppError(404, `${what} not found`);

export const badRequest = (message: string) => new AppError(400, message);

export const unauthorized = (message = "Unauthorized") =>
  new AppError(401, message);

/**
 * Read an id out of the URL.
 *
 * Express types a route parameter as `string | string[]`, because a pattern can
 * capture the same name twice. Ours never do, so this narrows it to a plain
 * string in one place instead of every route doing it.
 *
 * It also catches a typo in the parameter name: asking for a name the route
 * does not declare gives a clear 400 instead of the string "undefined" being
 * quietly sent to the database. TypeScript cannot catch that mistake, because
 * req.params has no fixed set of keys.
 */
export function pathId(
  params: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = params[name];
  if (typeof value === "string" && value !== "") return value;
  throw new AppError(400, `${name} is missing from the URL`);
}
