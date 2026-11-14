import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  after: vi.fn(),
  readBlobHead: vi.fn(),
  deleteBlob: vi.fn(),
  countDocuments: vi.fn(),
  getDocumentByBlobPathname: vi.fn(),
  createDocument: vi.fn(),
  resetForRetry: vi.fn(),
  deleteDocument: vi.fn(),
  indexDocument: vi.fn(),
  peekRateLimit: vi.fn(),
  consumeRateLimit: vi.fn(),
  findByContentHash: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/blob", () => ({
  readBlobHead: mocks.readBlobHead,
  deleteBlob: mocks.deleteBlob,
}));
vi.mock("@/server/ingest/index-document", () => ({ indexDocument: mocks.indexDocument }));
vi.mock("@/server/rate-limit", () => ({
  peekRateLimit: mocks.peekRateLimit,
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("./queries", () => ({
  countDocuments: mocks.countDocuments,
  getDocumentByBlobPathname: mocks.getDocumentByBlobPathname,
  findByContentHash: mocks.findByContentHash,
}));
vi.mock("./mutations", () => ({
  createDocument: mocks.createDocument,
  resetForRetry: mocks.resetForRetry,
  deleteDocument: mocks.deleteDocument,
}));

const { registerDocument, retryDocument, deleteDocument, uploadLimitReason, findDuplicate } =
  await import("./actions");

const alice = "user_alice";
const uuid = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const docId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const pdfHead = new TextEncoder().encode("%PDF-1.7\n1 0 obj");

function input(pathname = `users/${alice}/${uuid}-Lease.pdf`) {
  return { blobPathname: pathname, name: "Lease.pdf", mimeType: "application/pdf", sizeBytes: 9 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: alice });
  mocks.countDocuments.mockResolvedValue(1);
  mocks.consumeRateLimit.mockResolvedValue({ ok: true });
  mocks.getDocumentByBlobPathname.mockResolvedValue(null);
  mocks.readBlobHead.mockResolvedValue({ head: pdfHead, size: 2048 });
  mocks.deleteBlob.mockResolvedValue(undefined);
  mocks.createDocument.mockImplementation(async (_userId: string, values: { name: string }) => ({
    ok: true,
    document: { id: docId, ...values },
  }));
});

describe("registerDocument", () => {
  it("rejects signed-out callers without touching storage or the database", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    expect(await registerDocument(input())).toEqual({
      ok: false,
      error: "You need to be signed in.",
    });
    expect(mocks.readBlobHead).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it("rejects a path in another user's folder and leaves their file alone", async () => {
    const result = await registerDocument(input(`users/user_bob/${uuid}-Lease.pdf`));

    expect(result).toEqual({ ok: false, error: "That upload doesn't belong to your library." });
    expect(mocks.readBlobHead).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it("rejects paths that don't follow the users/<id>/<uuid>-<name> shape", async () => {
    const result = await registerDocument(input(`users/${alice}/Lease.pdf`));

    expect(result.ok).toBe(false);
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  const documentLimit = {
    ok: false,
    error: "You've reached the free limit of 3 documents. Delete one to upload another.",
    limit: { code: "DOCUMENT_LIMIT", max: 3 },
  };

  it("refuses a 4th document with a typed result and deletes the uploaded file", async () => {
    mocks.countDocuments.mockResolvedValue(3);

    expect(await registerDocument(input())).toEqual(documentLimit);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(input().blobPathname);
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it("refuses when the locked insert finds the last slot taken (a race)", async () => {
    mocks.createDocument.mockResolvedValue({ ok: false, max: 3 });

    expect(await registerDocument(input())).toEqual(documentLimit);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(input().blobPathname);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("checks the stored file's real type, not its extension", async () => {
    mocks.readBlobHead.mockResolvedValue({ head: new TextEncoder().encode("hello"), size: 5 });

    expect(await registerDocument(input())).toEqual({
      ok: false,
      error: "Lease.pdf doesn't look like a real PDF.",
    });
    expect(mocks.deleteBlob).toHaveBeenCalledWith(input().blobPathname);
  });

  it("checks the stored file's real size, not the size the browser reported", async () => {
    mocks.readBlobHead.mockResolvedValue({ head: pdfHead, size: 10 * 1024 * 1024 + 1 });

    expect(await registerDocument(input())).toEqual({
      ok: false,
      error: "Lease.pdf is 10.1 MB. The free limit is 10 MB per file.",
      limit: {
        code: "FILE_TOO_LARGE",
        maxMb: 10,
        sizeBytes: 10 * 1024 * 1024 + 1,
        fileName: "Lease.pdf",
      },
    });
    expect(mocks.deleteBlob).toHaveBeenCalled();
  });

  it("rejects a name whose type doesn't match the stored path", async () => {
    const result = await registerDocument({ ...input(), name: "Lease.txt" });

    expect(result.ok).toBe(false);
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it("creates the document with the real size and type, then indexes it after responding", async () => {
    const result = await registerDocument({ ...input(), mimeType: "text/html" });

    expect(result).toEqual({ ok: true, data: { id: docId, name: "Lease.pdf" } });
    expect(mocks.createDocument).toHaveBeenCalledWith(
      alice,
      {
        name: "Lease.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        blobPathname: input().blobPathname,
      },
      3,
    );
    expect(mocks.indexDocument).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);

    await mocks.after.mock.calls[0]![0]();
    expect(mocks.indexDocument).toHaveBeenCalledWith(alice, docId);
  });

  it("returns the existing document when the same upload is registered twice", async () => {
    mocks.getDocumentByBlobPathname.mockResolvedValue({ id: docId, name: "Lease.pdf" });

    expect(await registerDocument(input())).toEqual({
      ok: true,
      data: { id: docId, name: "Lease.pdf" },
    });
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

describe("retryDocument", () => {
  it("re-indexes a failed or stuck document", async () => {
    mocks.resetForRetry.mockResolvedValue({ id: docId, name: "Lease.pdf" });

    expect(await retryDocument({ id: docId })).toEqual({
      ok: true,
      data: { id: docId, name: "Lease.pdf" },
    });
    expect(mocks.resetForRetry).toHaveBeenCalledWith(alice, docId);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("counts against the re-read limit, and refuses past it without resetting", async () => {
    const failure = { code: "RATE_LIMITED", bucket: "reindex", max: 10, retryAfterSeconds: 120 };
    mocks.consumeRateLimit.mockResolvedValue({ ok: false, failure });

    expect(await retryDocument({ id: docId })).toEqual({
      ok: false,
      error:
        "You've asked DocChat to read documents again 10 times in the last hour. Try again in 2 minutes.",
      limit: failure,
    });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(alice, "reindex");
    expect(mocks.resetForRetry).not.toHaveBeenCalled();
  });

  it("does nothing when the document is already being read", async () => {
    mocks.resetForRetry.mockResolvedValue(null);

    expect(await retryDocument({ id: docId })).toEqual({
      ok: false,
      error: "This document is already being read.",
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

describe("deleteDocument", () => {
  it("deletes the row for the caller, then the stored file", async () => {
    mocks.deleteDocument.mockResolvedValue({ name: "Lease.pdf", blobPathname: "users/x/y" });

    expect(await deleteDocument({ id: docId })).toEqual({ ok: true, data: { name: "Lease.pdf" } });
    expect(mocks.deleteDocument).toHaveBeenCalledWith(alice, docId);
    expect(mocks.deleteBlob).toHaveBeenCalledWith("users/x/y");
  });

  it("still succeeds when the stored file can't be deleted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deleteDocument.mockResolvedValue({ name: "Lease.pdf", blobPathname: "users/x/y" });
    mocks.deleteBlob.mockRejectedValue(new Error("network"));

    expect((await deleteDocument({ id: docId })).ok).toBe(true);
    consoleError.mockRestore();
  });

  it("reports a document that isn't the caller's (or is gone) as already removed", async () => {
    mocks.deleteDocument.mockResolvedValue(null);

    expect(await deleteDocument({ id: docId })).toEqual({
      ok: false,
      error: "That document was already removed.",
    });
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });
});

describe("uploadLimitReason", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: alice });
  });

  it("explains a refused upload without counting one", async () => {
    const failure = { code: "RATE_LIMITED", bucket: "upload", max: 20, retryAfterSeconds: 300 };
    mocks.peekRateLimit.mockResolvedValue({ ok: false, failure });

    expect(await uploadLimitReason({})).toEqual({ ok: true, data: failure });
    expect(mocks.peekRateLimit).toHaveBeenCalledWith(alice, "upload");
  });

  it("names the document limit first", async () => {
    mocks.countDocuments.mockResolvedValue(3);

    expect(await uploadLimitReason({})).toEqual({
      ok: true,
      data: { code: "DOCUMENT_LIMIT", max: 3 },
    });
  });

  it("is null when uploads are allowed", async () => {
    mocks.peekRateLimit.mockResolvedValue({ ok: true });

    expect(await uploadLimitReason({})).toEqual({ ok: true, data: null });
  });
});

describe("findDuplicate", () => {
  const hash = "a".repeat(64);

  it("names the user's document with the same file", async () => {
    mocks.findByContentHash.mockResolvedValue({ id: docId, name: "Lease.pdf" });

    expect(await findDuplicate({ contentHash: hash })).toEqual({
      ok: true,
      data: { name: "Lease.pdf" },
    });
    expect(mocks.findByContentHash).toHaveBeenCalledWith(alice, hash);
  });

  it("rejects anything that isn't a SHA-256 hex digest", async () => {
    expect((await findDuplicate({ contentHash: "nope" })).ok).toBe(false);
    expect(mocks.findByContentHash).not.toHaveBeenCalled();
  });
});
