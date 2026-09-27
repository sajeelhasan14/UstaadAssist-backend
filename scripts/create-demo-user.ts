/**
 * Create a demo teacher login, so the seed script and the mobile app have
 * somebody to sign in as.
 *
 * Run it with:
 *   node --experimental-strip-types --env-file=.env scripts/create-demo-user.ts
 *   node --experimental-strip-types --env-file=.env scripts/create-demo-user.ts you@example.com yourpassword
 *
 * Why this is a script and not part of the backend:
 *
 *   We do not build authentication (CLAUDE.md). Supabase Auth owns users, and
 *   Express only verifies the tokens it issues. Creating a user is therefore an
 *   administrative job done once from a terminal, using the Supabase Admin API —
 *   not an endpoint we expose.
 *
 * The service role key is what makes this call allowed. It stays on the server.
 * It must never appear in the React Native app.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}

const email = process.argv[2] ?? "demo.teacher@ustaadassist.test";
const password = process.argv[3] ?? "UstaadAssist#Demo2026";

const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password,
    // Skips the confirmation email. This is a test account on a dev project.
    email_confirm: true,
    user_metadata: { full_name: "Demo Teacher" },
  }),
});

// fetch gives back `unknown`, so the shape we rely on is stated here rather
// than assumed. Only these three fields are read.
const body = (await response.json()) as { id?: string; msg?: string };

if (!response.ok) {
  // A user that already exists is not a failure worth stopping for.
  if (typeof body?.msg === "string" && body.msg.toLowerCase().includes("already")) {
    console.log(`User ${email} already exists. Nothing to do.`);
    process.exit(0);
  }

  console.error(`Supabase refused the request (${response.status}):`, body);
  process.exit(1);
}

console.log(`
Created a teacher login.

  email     ${email}
  password  ${password}
  user id   ${body.id}

Sign in with these in the app, or from a terminal:

  curl -s "${SUPABASE_URL}/auth/v1/token?grant_type=password" \\
    -H "apikey: <your anon key>" \\
    -H "Content-Type: application/json" \\
    -d '{"email":"${email}","password":"${password}"}'

The access_token in that response is what you send to this backend as
"Authorization: Bearer <token>".
`);
