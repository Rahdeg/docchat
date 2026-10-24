import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getDocument: vi.fn(),
  getBlob: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/features/documents/queries", () => ({ getDocument: mocks.getDocument }));
vi.mock("@/server/blob", () => ({ getBlob: mocks.getBlob }));

const { GET } = await import("./route");

const docId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

function call(id = docId, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/documents/${id}/file`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

const aliceDoc = {
  id: docId,
  userId: "user_alice",
  name: "Lease.pdf",
  mimeType: "application/pdf",
  blobPathname: "users/user_alice/x-Lease.pdf",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user_alice" });
  mocks.getDocument.mockResolvedValue(aliceDoc);
  mocks.getBlob.mockResolvedValue({
    statusCode: 200,
    stream: new Response("%PDF-1.7").body,
    blob: { etag: '"abc"', contentType: "application/pdf" },
  });
});

describe("GET /api/documents/[id]/file", () => {
  it("returns 401 to signed-out visitors", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's document, without reading storage", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_bob" });
    // The query filters by userId, so Bob gets nothing back for Alice's document.
    mocks.getDocument.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(404);
    expect(mocks.getDocument).toHaveBeenCalledWith("user_bob", docId);
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });

  it("returns 404 for an id that isn't a uuid", async () => {
    expect((await call("../../etc")).status).toBe(404);
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for a sample document with no stored file", async () => {
    mocks.getDocument.mockResolvedValue({ ...aliceDoc, blobPathname: null });

    expect((await call()).status).toBe(404);
  });

  it("streams the owner's file with private, no-cache headers", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("%PDF-1.7");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''Lease.pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBe('"abc"');
  });

  it("serves Markdown as plain text so it opens in the tab", async () => {
    mocks.getDocument.mockResolvedValue({
      ...aliceDoc,
      name: "Notes.md",
      mimeType: "text/markdown",
    });

    const response = await call();

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("answers 304 when the browser's copy is current", async () => {
    mocks.getBlob.mockResolvedValue({ statusCode: 304, stream: null, blob: { etag: '"abc"' } });

    const response = await call(docId, { "if-none-match": '"abc"' });

    expect(mocks.getBlob).toHaveBeenCalledWith(aliceDoc.blobPathname, { ifNoneMatch: '"abc"' });
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });
});
