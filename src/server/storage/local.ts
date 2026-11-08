import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

// STORAGE_DRIVER=local: uploaded files on disk, for the end-to-end tests in CI only (a test
// double, refused outside tests and CI: src/lib/test-doubles.ts, docs/adr/0009). Same paths as
// Blob (users/<userId>/<uuid>-<name>). A small JSON file next to each upload holds its content
// type. Called only through src/server/blob.ts.

export type LocalFile =
  | {
      statusCode: 200;
      stream: ReadableStream<Uint8Array>;
      blob: { etag: string; size: number; contentType: string };
    }
  | { statusCode: 304; stream: null; blob: { etag: string } };

export function createLocalStore(root: string) {
  const base = resolve(root);

  // The file for a pathname, never outside the root (no "..", no absolute paths).
  function fileOf(pathname: string): string {
    const path = resolve(base, pathname);
    if (path === base || !path.startsWith(base + sep) || pathname.includes("\0")) {
      throw new Error("Invalid storage path");
    }
    return path;
  }

  const metaOf = (file: string) => `${file}.meta.json`;

  async function etagOf(file: string): Promise<{ etag: string; size: number } | null> {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const etag = `"${createHash("sha1").update(`${info.size}-${info.mtimeMs}`).digest("hex")}"`;
    return { etag, size: info.size };
  }

  async function contentTypeOf(file: string): Promise<string> {
    const meta = await readFile(metaOf(file), "utf8").catch(() => null);
    const parsed: unknown = meta ? JSON.parse(meta) : null;
    return typeof parsed === "object" &&
      parsed !== null &&
      "contentType" in parsed &&
      typeof parsed.contentType === "string"
      ? parsed.contentType
      : "application/octet-stream";
  }

  return {
    // Writes a new file. Refuses to overwrite one, like the Blob token's allowOverwrite: false.
    async put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void> {
      const file = fileOf(pathname);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
      await writeFile(metaOf(file), JSON.stringify({ contentType }));
    },

    async get(pathname: string, init: { ifNoneMatch?: string } = {}): Promise<LocalFile | null> {
      const file = fileOf(pathname);
      const tag = await etagOf(file);
      if (!tag) return null;
      if (init.ifNoneMatch === tag.etag) {
        return { statusCode: 304, stream: null, blob: { etag: tag.etag } };
      }
      const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return {
        statusCode: 200,
        stream,
        blob: { ...tag, contentType: await contentTypeOf(file) },
      };
    },

    async download(pathname: string): Promise<Uint8Array | null> {
      const bytes = await readFile(fileOf(pathname)).catch(() => null);
      return bytes ? new Uint8Array(bytes) : null;
    },

    async head(
      pathname: string,
      length: number,
    ): Promise<{ head: Uint8Array; size: number } | null> {
      const file = fileOf(pathname);
      const handle = await open(file, "r").catch(() => null);
      if (!handle) return null;
      try {
        const { size } = await handle.stat();
        const head = new Uint8Array(Math.min(length, size));
        await handle.read(head, 0, head.length, 0);
        return { head, size };
      } finally {
        await handle.close();
      }
    },

    async delete(pathname: string): Promise<void> {
      const file = fileOf(pathname);
      await rm(file, { force: true });
      await rm(metaOf(file), { force: true });
    },

    // Deletes every file under a folder; returns how many uploads it removed.
    async deletePrefix(prefix: string): Promise<number> {
      const folder = fileOf(prefix);
      const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(
        () => [],
      );
      const uploads = entries.filter((e) => e.isFile() && !e.name.endsWith(".meta.json"));
      await rm(folder, { recursive: true, force: true });
      return uploads.length;
    },

    // For tests: where a pathname lives.
    pathOf: (pathname: string) => relative(base, fileOf(pathname)),
  };
}

export type LocalStore = ReturnType<typeof createLocalStore>;
