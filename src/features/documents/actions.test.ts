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
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/blob", () => ({
  readBlobHead: mocks.readBlobHead,
  deleteBlob: mocks.deleteBlob,
}));
vi.mock("@/server/ingest/index-document", () => ({ indexDocument: mocks.indexDocument }));
vi.mock("./queries", () => ({
  countDocuments: mocks.countDocuments,
  getDocumentByBlobPathname: mocks.getDocumentByBlobPathname,
}));
vi.mock("./mutations", () => ({
  createDocument: mocks.createDocument,
  resetForRetry: mocks.resetForRetry,
  deleteDocument: mocks.deleteDocument,
}));

const { registerDocument, retryDocument, deleteDocument } = await import("./actions");

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
  mocks.countDocuments.mockResolvedValue(3);
  mocks.getDocumentByBlobPathname.mockResolvedValue(null);
  mocks.readBlobHead.mockResolvedValue({ head: pdfHead, size: 2048 });
  mocks.deleteBlob.mockResolvedValue(undefined);
  mocks.createDocument.mockImplementation(async (_userId: string, values: { name: string }) => ({
    id: docId,
    ...values,
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

  it("refuses a 21st document and deletes the uploaded file", async () => {
    mocks.countDocuments.mockResolvedValue(20);

    expect(await registerDocument(input())).toEqual({
      ok: false,
      error: "You can keep up to 20 documents. Remove one to add another.",
    });
    expect(mocks.deleteBlob).toHaveBeenCalledWith(input().blobPathname);
    expect(mocks.createDocument).not.toHaveBeenCalled();
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
      error: "Lease.pdf is larger than 10 MB.",
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
    expect(mocks.createDocument).toHaveBeenCalledWith(alice, {
      name: "Lease.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      blobPathname: input().blobPathname,
    });
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
