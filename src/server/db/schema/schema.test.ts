import { readFileSync } from "node:fs";

import { getTableConfig, PgVector, type IndexedColumn } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/server/ai/constants";

import { chat, chunk, document, documentPage, message, task } from ".";

const userTables = { document, documentPage, chunk, chat, message, task };

describe("schema", () => {
  it.each(Object.entries(userTables))("%s has an indexed user_id column", (_name, table) => {
    const { columns, indexes } = getTableConfig(table);

    expect(columns.find((c) => c.name === "user_id")?.notNull).toBe(true);
    const indexed = indexes.map((i) =>
      i.config.columns.map((c) => (c as Partial<IndexedColumn>).name),
    );
    expect(indexed).toContainEqual(["user_id"]);
  });

  it("sizes chunk.embedding with EMBEDDING_DIMENSIONS", () => {
    const embedding = getTableConfig(chunk).columns.find((c) => c.name === "embedding");

    expect(embedding).toBeInstanceOf(PgVector);
    expect((embedding as PgVector<never>).dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("has a migration for the current EMBEDDING_DIMENSIONS", () => {
    // Catches changing the constant without running `pnpm db:generate`.
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number }[];
    };
    const latest = journal.entries.at(-1)?.idx ?? 0;
    const snapshotFile = `drizzle/meta/${String(latest).padStart(4, "0")}_snapshot.json`;
    const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as {
      tables: Record<string, { columns: Record<string, { type: string }> }>;
    };

    expect(snapshot.tables["public.chunk"]?.columns.embedding?.type).toBe(
      `vector(${EMBEDDING_DIMENSIONS})`,
    );
  });
});
