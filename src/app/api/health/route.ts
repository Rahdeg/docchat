import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/server/db";

// Liveness for the Docker HEALTHCHECK and uptime monitors: is the app up, and can it reach the
// database? Public by design, so the body says nothing else: no versions, no hosts, no error
// text. The proxy leaves /api/* alone, so no sign-in redirect.
const headers = { "Cache-Control": "no-store" };
const PING_TIMEOUT_MS = 3_000;

export async function GET(): Promise<Response> {
  // Never prerendered or cached: every request pings.
  await connection();
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database ping timed out")), PING_TIMEOUT_MS),
      ),
    ]);
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}
