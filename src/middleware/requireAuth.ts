import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../http.ts";

const jwks = createRemoteJWKSet(
  new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; email: string };
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Missing Authorization: Bearer <token> header");
  }

  const token = header.slice("Bearer ".length).trim();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks));
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  if (!payload.sub) {
    throw unauthorized("Token has no subject claim");
  }

  req.auth = {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
  };

  next();
}
