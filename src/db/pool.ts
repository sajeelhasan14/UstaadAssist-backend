import { Pool, type PoolClient } from "pg";

/**
 * Are we running as a serverless function rather than a long-lived server?
 *
 * Vercel sets VERCEL=1 in every deployment. This matters because the two
 * environments want opposite things from a connection pool.
 */
const isServerless = process.env.VERCEL === "1" || process.env.VERCEL === "true";

/**
 * The connection pool.
 *
 * On a normal server one pool serves the whole process, so a handful of
 * connections is right: they stay warm and are shared by every request.
 *
 * On serverless there is no single process. Each function instance gets its own
 * pool, and there may be many instances alive at once, so `max` is the number of
 * connections PER INSTANCE. Ten instances with max: 10 is a hundred connections,
 * which exhausts the database. One per instance is what you want, because a
 * single instance handles one request at a time anyway.
 *
 * `idleTimeoutMillis` is short on serverless so a frozen instance releases its
 * connection instead of holding it until the platform reaps the instance.
 *
 * IMPORTANT, and not a code setting: on serverless DATABASE_URL must point at
 * Supabase's pooler in TRANSACTION mode, which is port 6543, not 5432. Port 5432
 * is session mode and holds a connection for the client's whole lifetime — fine
 * for a server, wrong for functions that come and go. See DEPLOYMENT.md.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: isServerless ? 1 : 10,
  idleTimeoutMillis: isServerless ? 10_000 : 30_000,
  // Fail fast rather than hanging a request for the platform's whole timeout.
  connectionTimeoutMillis: 10_000,
});

/**
 * A pooled connection can fail while sitting IDLE — the network drops, or the
 * database restarts. The pool then emits an 'error' event, and in Node an
 * 'error' event with no listener is thrown as an uncaught exception that kills
 * the whole process.
 *
 * So this one line is what stops a brief network blip taking the server down.
 * The pool discards the dead connection and the next request gets a fresh one.
 */
pool.on("error", (err) => console.error("[db]", err));

/**
 * Run several statements as one all-or-nothing unit.
 *
 * It has to be written by hand because of how pooling works: pool.query()
 * borrows a connection, runs one statement, and returns it immediately. So
 * `pool.query("begin")` then `pool.query("insert ...")` can land on two
 * different connections, and the insert would not be inside the transaction at
 * all.
 *
 * This borrows ONE connection with pool.connect() and holds it for the whole
 * block, which is what makes begin/commit mean anything.
 *
 * Inside the callback use `client.query`, never `pool.query` — a stray
 * pool.query borrows a different connection, runs outside the transaction, and
 * is not rolled back.
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    // finally runs on success AND failure. A connection that is never released
    // is permanently lost from the pool, and enough of those stop the server
    // responding at all.
    client.release();
  }
}
