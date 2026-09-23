import type { NextFunction, Request, Response } from "express";
import { AppError } from "../http.ts";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    data: null,
    message: `No route for ${req.method} ${req.path}`,
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ success: false, data: null, message: err.message });
    return;
  }

  console.error("[error]", err);

  res.status(500).json({
    success: false,
    data: null,
    message: "Something went wrong",
  });
}
