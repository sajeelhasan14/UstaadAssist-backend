import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env.ts";
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../http.ts";

const jwks = createRemoteJWKSet(
  new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
        /** The name given at sign-up (Supabase user_metadata.full_name), if any. */
        fullName: string | null;
        /** The verified token itself, for calls made on the teacher's behalf (Supabase Storage). */
        token: string;
      };
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

  // Supabase copies the sign-up form's extra fields into user_metadata.
  const metadata = payload.user_metadata as { full_name?: unknown } | undefined;
  const fullName =
    typeof metadata?.full_name === "string" && metadata.full_name.trim() !== ""
      ? metadata.full_name.trim()
      : null;

  req.auth = {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
    fullName,
    token,
  };

  next();
}
