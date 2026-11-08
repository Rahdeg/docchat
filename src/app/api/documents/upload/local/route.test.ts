import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkUploadPath: vi.fn(),
  consumeRateLimit: vi.fn(),
  putLocalFile: vi.fn(),
  driver: { value: "local" as "local" | "blob" },
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/features/documents/upload-policy", () => ({ checkUploadPath: mocks.checkUploadPath }));
vi.mock("@/server/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/server/blob", () => ({
  putLocalFile: mocks.putLocalFile,
  get storageDriver() {
    return mocks.driver.value;
  },
}));

const { PUT } = await import("./route");

const pathname = "users/user_a/0b5c-lease.pdf";

function call(body: BodyInit = "%PDF-1.7", headers: Record<string, string> = {}, path = pathname) {
  return PUT(
    new Request(
      `http://localhost/api/documents/upload/local?pathname=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        body,
        headers: { "content-type": "application/pdf", ...headers },
      },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.driver.value = "local";
  mocks.auth.mockResolvedValue({ userId: "user_a" });
  mocks.checkUploadPath.mockResolvedValue({ ok: true, kind: "pdf", fileName: "lease.pdf" });
  mocks.consumeRateLimit.mockResolvedValue({ ok: true });
});

describe("PUT /api/documents/upload/local", () => {
  it("is a 404 unless the local store is in use", async () => {
    mocks.driver.value = "blob";
    expect((await call()).status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await call()).status).toBe(401);
    expect(mocks.putLocalFile).not.toHaveBeenCalled();
  });

  it("stores the file under the caller's own folder", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(mocks.checkUploadPath).toHaveBeenCalledWith("user_a", pathname);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("user_a", "upload");
    expect(mocks.putLocalFile).toHaveBeenCalledWith(
      pathname,
      new TextEncoder().encode("%PDF-1.7"),
      "application/pdf",
    );
  });

  it("refuses someone else's folder, a mismatched type, the rate limit and big files", async () => {
    mocks.checkUploadPath.mockResolvedValueOnce({ ok: false, error: "not yours" });
    expect((await call()).status).toBe(400);

    expect((await call("x", { "content-type": "text/plain" })).status).toBe(400);

    mocks.consumeRateLimit.mockResolvedValueOnce({ ok: false, message: "slow down" });
    expect((await call()).status).toBe(429);

    expect((await call(new Uint8Array(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect(mocks.putLocalFile).not.toHaveBeenCalled();
  });

  it("never overwrites an upload", async () => {
    mocks.putLocalFile.mockRejectedValueOnce(new Error("EEXIST"));
    expect((await call()).status).toBe(409);
  });
});
