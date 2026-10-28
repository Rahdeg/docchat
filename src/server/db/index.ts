import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";

import * as schema from "./schema";

// node-postgres (TCP) is Neon's recommended driver for Node runtimes and supports interactive
// transactions, which we need to insert a document's chunks atomically.
// Reuse one pool across dev hot reloads instead of opening a new one per reload.
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool = globalForDb.pool ?? new Pool({ connectionString: env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

// An idle connection that drops (a network blip, Neon scaling to zero) emits "error" on the
// pool. Unhandled, that crashes the process; the pool replaces the client on the next query.
if (!globalForDb.pool?.listenerCount("error")) {
  pool.on("error", (error) => console.error("Idle database connection failed", error.message));
}

export const db = drizzle({ client: pool, schema });

export type Db = typeof db;
