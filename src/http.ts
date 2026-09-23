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
