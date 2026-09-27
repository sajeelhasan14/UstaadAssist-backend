/**
 * Check the environment before anything tries to use it.
 *
 * Why this file exists: several modules read process.env at the TOP LEVEL, when
 * they are first imported, not inside a function. `requireAuth.ts` builds the
 * Supabase JWKS URL that way, and `db/pool.ts` builds the connection pool.
 *
 * So a missing variable does not produce a helpful 500 on one endpoint. It throws
 * while the module is still loading, which means the whole app fails to start and
 * EVERY request fails — including /health, which touches nothing.
 *
 * And the error it threw was `TypeError: Invalid URL`, because
 * `new URL("undefined/auth/v1/...")` is what you get when SUPABASE_URL is not
 * set. That message says nothing about which variable is missing or where to put
 * it. On Vercel it surfaces only as FUNCTION_INVOCATION_FAILED.
 *
 * This module is imported first, so the failure names the problem instead.
 */

/**
 * Variables the SERVER needs to answer a request.
 *
 * SUPABASE_SERVICE_ROLE_KEY is deliberately NOT here. It is only used by the
 * scripts in scripts/, which run from a terminal — so it never has to be present
 * where the server runs. One fewer place for a key that grants full admin on the
 * Supabase project.
 */
const REQUIRED = ["DATABASE_URL", "SUPABASE_URL"] as const;

type RequiredName = (typeof REQUIRED)[number];

function readEnvironment(): Record<RequiredName, string> {
  const missing: string[] = [];
  const found = {} as Record<RequiredName, string>;

  for (const name of REQUIRED) {
    const value = process.env[name];

    if (value === undefined || value.trim() === "") {
      missing.push(name);
      continue;
    }

    found[name] = value.trim();
  }

  // Every missing variable is reported at once. Reporting only the first means
  // fixing one, redeploying, and discovering the next — three deploys to learn
  // what one message could have said.
  if (missing.length > 0) {
    throw new Error(
      `Cannot start: ${missing.length === 1 ? "a required environment variable is" : "required environment variables are"} ` +
        `missing — ${missing.join(", ")}.\n\n` +
        `  Locally:  add it to .env (see .env.example), then restart.\n` +
        `  On Vercel: Project -> Settings -> Environment Variables, then REDEPLOY.\n` +
        `             Adding a variable does not update a deployment that already exists.\n\n` +
        `  Note: SUPABASE_SERVICE_ROLE_KEY is not needed by the server. It is only\n` +
        `  used by the scripts in scripts/, which run on your own machine.`,
    );
  }

  // A trailing slash is harmless to fix silently. Left in, requireAuth.ts would
  // build ".../supabase.co//auth/v1/..." with a double slash.
  found.SUPABASE_URL = found.SUPABASE_URL.replace(/\/+$/, "");

  // A mistake worth catching early: pasting the dashboard URL instead of the
  // API URL.
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(found.SUPABASE_URL)) {
    console.warn(
      `[env] SUPABASE_URL does not look like https://<project>.supabase.co — ` +
        `token verification will fail if this is wrong. Got: ${found.SUPABASE_URL}`,
    );
  }

  return found;
}

export const env = readEnvironment();

/** Vercel sets this in every deployment. Used to size the connection pool. */
export const isServerless =
  process.env.VERCEL === "1" || process.env.VERCEL === "true";
