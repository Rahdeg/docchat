import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalStore, type LocalStore } from "./local";

let dir: string;
let store: LocalStore;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "docchat-local-store-"));
  store = createLocalStore(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const path = "users/user_a/0b5c-lease.pdf";
const bytes = new TextEncoder().encode("%PDF-1.7 hello");

describe("local store", () => {
  it("stores, reads, heads and serves a file with an ETag", async () => {
    await store.put(path, bytes, "application/pdf");

    expect(await store.download(path)).toEqual(bytes);
    expect(await store.head(path, 5)).toEqual({ head: bytes.slice(0, 5), size: bytes.length });

    const got = await store.get(path);
    expect(got?.statusCode).toBe(200);
    if (got?.statusCode !== 200) throw new Error("unreachable");
    expect(got.blob).toMatchObject({ size: bytes.length, contentType: "application/pdf" });
    expect(new Uint8Array(await new Response(got.stream).arrayBuffer())).toEqual(bytes);

    expect(await store.get(path, { ifNoneMatch: got.blob.etag })).toEqual({
      statusCode: 304,
      stream: null,
      blob: { etag: got.blob.etag },
    });
  });

  it("never overwrites a file", async () => {
    await expect(store.put(path, bytes, "application/pdf")).rejects.toThrow();
  });

  it("returns null for files that don't exist", async () => {
    expect(await store.get("users/user_a/missing.pdf")).toBeNull();
    expect(await store.download("users/user_a/missing.pdf")).toBeNull();
    expect(await store.head("users/user_a/missing.pdf", 4)).toBeNull();
  });

  it("refuses paths outside its folder", async () => {
    for (const bad of ["../escape.pdf", "users/../../escape.pdf", "/etc/passwd", ""]) {
      await expect(store.put(bad, bytes, "text/plain")).rejects.toThrow("Invalid storage path");
    }
  });

  it("deletes one file, and a whole folder", async () => {
    await store.put("users/user_a/two.md", bytes, "text/markdown");
    await store.delete(path);
    expect(await store.get(path)).toBeNull();

    expect(await store.deletePrefix("users/user_a/")).toBe(1);
    expect(await store.get("users/user_a/two.md")).toBeNull();
    expect(await store.deletePrefix("users/nobody/")).toBe(0);
  });
});
