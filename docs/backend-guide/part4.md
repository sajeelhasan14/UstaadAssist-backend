# 4 · Authentication

> The backend does not have a login screen, a password field, or a users table it controls. It only ever *checks* something the app already has. This chapter explains what that something is and why checking it is safe.

## The thing to understand first

There are two completely separate jobs hiding inside the word "login":

- *Authentication* — proving who you are. Email, password, "forgot password", email confirmation, sessions.
- *Verification* — being handed a claim of identity and deciding whether to believe it.

Supabase Auth does the first. This backend does only the second. CLAUDE.md is explicit: *do not build authentication.*

## The flow, with the actual values

```
 1. TEACHER SIGNS IN — inside the mobile app, talking to Supabase.
    The password never touches your Express server.

        app  ---- email + password ---->  Supabase Auth
        app  <---- access_token -------   Supabase Auth

    The access_token is a JWT. It looks like this:

        eyJhbGciOiJFUzI1NiIsImtpZCI6IjIzZWNjZTA1...  .  eyJzdWIiOiJkYTFmMTh...  .  MEQCIGx...
        \_____ header _____________________________/    \____ payload ______/    \_ signature _/

 2. APP CALLS YOUR BACKEND, carrying the token.

        GET /courses
        Authorization: Bearer eyJhbGciOiJFUzI1NiIs...

 3. YOUR BACKEND VERIFIES IT — without asking Supabase anything.

        requireAuth
          - splits off the "Bearer " prefix
          - fetches Supabase's PUBLIC key (once, then cached)
          - checks the signature with that public key
          - checks it has not expired
          - sets req.auth = { userId: "da1f18ab-...", email: "..." }

 4. EVERY QUERY IS SCOPED TO THAT userId.

        select * from course where id = $1 and teacher_id = $2
                                                           ^^ from the token
```

## The part that is genuinely confusing: how the checking works

The natural assumption is that step 3 must call Supabase to ask "is this token real?". It does not. It never contacts Supabase to check a token. Here is why that is safe.

### Two keys, and only one of them is secret

Supabase holds a *private key*. Your backend gets the matching *public key*. They are a pair with one useful property:

- Only the private key can *create* a valid signature.
- The public key can *check* a signature, but cannot create one.

So the public key being public is fine. It is a lock that anyone may inspect but only one key opens.

### The analogy that actually fits

Think of a wax seal on a letter. The king has a signet ring — one of a kind, and he never lends it. Everyone in the kingdom has *seen* the seal and knows what it looks like, so anyone can look at a sealed letter and say "yes, that is the king's seal". Knowing what the seal looks like does not let you make one, because you do not have the ring.

The private key is the ring. The public key is knowing what the seal looks like. The signature is the wax impression.

!NOTE The question "if I give the backend the picture of the seal, can't anyone forge it?" is the right question to ask, and the answer is no — and this is not a trick of secrecy, it is mathematics. Verifying a signature and producing one are genuinely different operations, and only one of them needs the private key.

### What the signature is actually over

The signature is computed from the header *and the payload*. So it is not a stamp that says "Supabase approves"; it is a stamp that says "Supabase approves **exactly these contents**".

Change one character of the payload — swap your user id for somebody else's — and the signature no longer matches the contents. Verification fails. And you cannot compute the *new* correct signature for your altered payload, because that needs the private key.

This was tested directly while building the project: flipping a single character in the payload made `jose` reject the token immediately.

### Where the public key comes from

Supabase publishes it at a fixed URL:

```
https://<your-project>.supabase.co/auth/v1/.well-known/jwks.json
```

JWKS means *JSON Web Key Set* — a list of public keys, each with an id. The real response for this project:

```
{
  "keys": [
    {
      "kty": "EC",                                   <- elliptic curve
      "alg": "ES256",                                <- the signing algorithm
      "kid": "23ecce05-b586-4f07-b8d3-fb2ae8d6e5f2",  <- key id
      "crv": "P-256",
      "x": "...", "y": "..."                          <- the public key itself
    }
  ]
}
```

The token's header names which key signed it:

```
{ "alg": "ES256", "kid": "23ecce05-b586-4f07-b8d3-fb2ae8d6e5f2" }
```

So `jose` reads the `kid`, picks that key out of the set, and verifies with it. The `kid` exists so Supabase can rotate keys: it publishes a new one, starts signing with it, and old tokens still verify against the old key until they expire.

!WARN The older Supabase approach used a single *shared secret* — the same string on both sides, used to both sign and verify. CLAUDE.md forbids it here: *"Do not verify with a shared JWT secret — the project uses asymmetric signing keys."* With a shared secret, your backend holds a key capable of *minting* tokens, so a leak from your server lets an attacker forge any user. With the public key, a leak gives away nothing.

PAGEBREAK

## `src/middleware/requireAuth.ts`, line by line

```
import { createRemoteJWKSet, jwtVerify } from "jose";
import { unauthorized } from "../http.ts";
import type { NextFunction, Request, Response } from "express";
```

### Extending the Request type

```
declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; email: string };
    }
  }
}
```

Express's `Request` type knows nothing about `req.auth` — that is ours. This block *adds* the property to Express's own type, so every route in the project can write `req.auth!.userId` and have TypeScript accept it.

`auth?` is optional because on a request that has not been through this middleware, it genuinely is not there. That optionality is what forces routes to write `req.auth!` — and that `!` is honest, because the route sits behind `requireAuth`.

### The key set is created once

```
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);
```

This is at the *top* of the module, not inside the function, and that placement is the whole point. `createRemoteJWKSet` returns an object that fetches the keys on first use and then *caches* them.

Put it inside the handler and every single request would make an HTTPS call to Supabase before doing anything else — slow, and it would break entirely if Supabase were briefly unreachable. At module level it is created once when the server starts, and thousands of requests reuse the cached key.

### The middleware itself

```
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length);

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.auth = {
      userId: payload.sub as string,
      email: (payload.email as string) ?? "",
    };
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  next();
}
```

Walking through it:

- `req.headers.authorization` — the header, or `undefined` if absent.
- `!header?.startsWith("Bearer ")` — the `?.` handles the absent case without crashing. Covers a missing header and a malformed one in one condition.
- `header.slice("Bearer ".length)` — cuts off the seven characters `Bearer ` and leaves the token. Written as `"Bearer ".length` rather than `7` so it says what it means.
- `await jwtVerify(token, JWKS)` — this is the whole verification. It checks the signature against the right key, checks `exp` has not passed, and throws if anything is wrong.
- `payload.sub` — `sub` is short for *subject*: the user's uuid. This is the value that becomes `teacher_id` on every row.
- `catch { throw unauthorized(...) }` — the real reason is deliberately not passed on. Telling a caller *"expired at 14:02"* versus *"signature invalid"* helps someone probing the API. One message covers both.
- `next()` — hand control to the next middleware, which is the route. Forgetting this leaves the request hanging forever with no response and no error.

### Why the `catch` is empty-braced

```
} catch {
```

Modern JavaScript allows `catch` with no parameter when the error is not used. Here it genuinely is not: any failure means the same thing to the caller.

PAGEBREAK

## `GET /auth/me` and the upsert that creates the teacher

`src/routes/auth.ts` is short but does something worth explaining.

```
insert into teacher (id, email) values ($1, $2)
on conflict (id) do update set email = excluded.email
returning id, email, full_name, department, created_at
```

The situation: a teacher signs up through Supabase. Supabase creates a row in `auth.users`. Your `teacher` table knows nothing about it — there is no webhook, and the backend was not involved.

So the first time that teacher calls any endpoint, their `teacher` row has to appear. `/auth/me` is the natural place, because the app calls it right after sign-in.

- `insert ... on conflict (id) do update` — create the row, or if it exists, refresh the email. No "check then insert", no race.
- `set email = excluded.email` — keeps the email current if they changed it in Supabase.
- `returning ...` — hands back the row in the same statement, so there is no second `select`.

This matters because of the foreign key:

```
create table teacher (
  id uuid primary key references auth.users(id) on delete cascade,
  ...
);
```

`teacher.id` *is* the Supabase user id, and PostgreSQL enforces that it exists in `auth.users`. So a `teacher` row can only be created for a genuine Supabase user, and deleting the user in Supabase deletes the teacher and cascades to all their courses.

## Ownership: the rule that makes the whole API safe

Verifying the token answers *who is calling*. It does not stop that person asking for somebody else's data. `GET /courses/47` is a perfectly well-formed request from a perfectly valid user — course 47 just is not theirs.

The rule in this project is absolute: *every query that takes an id from the URL also filters on the teacher id from the token.*

```
select ... from course
 where id = $1 and teacher_id = $2
--                             ^^ from req.auth, never from the body
```

`src/services/ownership.ts` centralises this so no route has to remember:

```
export async function assertCourseOwned(courseId: string, teacherId: string): Promise<CourseRow> {
  const result = await pool.query<CourseRow>(
    `select ... from course where id = $1 and teacher_id = $2`,
    [courseId, teacherId],
  );

  const course = result.rows[0];
  if (!course) throw notFound("Course");
  return course;
}
```

Every service function starts with a call to this or one of its siblings.

### Why it answers 404 and not 403

A course that exists but belongs to someone else returns *404 Course not found*, not *403 Forbidden*.

`403` would be more literally accurate, and that is exactly the problem: it confirms the id is real. Someone could walk `/courses/1`, `/courses/2`, `/courses/3` and learn how many courses exist and which ids are taken, purely from which error came back. `404` for both cases tells them nothing.

### Rows two joins away

For `PATCH /sessions/:id` the URL carries a session, and the teacher is two tables away. `ownership.ts` handles it with a join:

```
select x.course_id
  from session x
  join course c on c.id = x.course_id
 where x.id = $1 and c.teacher_id = $2
```

If the session belongs to another teacher, the join produces no row, and the code throws `notFound("Session")`. The same helper is reused for topics, assessments and materials.

!NOTE The other half of the rule: the owner is *never* read from the request body. If the app sent `{ "teacher_id": "..." }` it would be ignored. Anyone can put anything in a body; only the token is signed.
