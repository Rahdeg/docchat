import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  countDocuments: vi.fn(),
  handleUpload: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/features/documents/queries", () => ({ countDocuments: mocks.countDocuments }));
// Stand-in for the SDK: run the route's onBeforeGenerateToken and return what it allowed.
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));

const { POST } = await import("./route");

const uuid = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function tokenRequest(pathname: string) {
  return new Request("http://localhost/api/documents/upload", {
    method: "POST",
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: null, multipart: false },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user_alice" });
  mocks.countDocuments.mockResolvedValue(0);
  mocks.handleUpload.mockImplementation(
    async ({
      body,
      onBeforeGenerateToken,
    }: {
      body: { payload: { pathname: string } };
      onBeforeGenerateToken: (pathname: string) => Promise<unknown>;
    }) => ({ allowed: await onBeforeGenerateToken(body.payload.pathname) }),
  );
});

describe("POST /api/documents/upload", () => {
  it("returns 401 to signed-out visitors without issuing a token", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await POST(tokenRequest(`users/user_alice/${uuid}-a.pdf`));

    expect(response.status).toBe(401);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("refuses a path in another user's folder", async () => {
    const response = await POST(tokenRequest(`users/user_bob/${uuid}-a.pdf`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That upload doesn't belong to your library." });
  });

  it("refuses a disallowed file type", async () => {
    const response = await POST(tokenRequest(`users/user_alice/${uuid}-photo.png`));

    expect(response.status).toBe(400);
  });

  it("refuses once the user has 20 documents", async () => {
    mocks.countDocuments.mockResolvedValue(20);

    const response = await POST(tokenRequest(`users/user_alice/${uuid}-a.pdf`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "You can keep up to 20 documents. Remove one to add another.",
    });
  });

  it("allows only the file's own type, up to 10 MB, without overwriting", async () => {
    const response = await POST(tokenRequest(`users/user_alice/${uuid}-notes.md`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      allowed: {
        allowedContentTypes: ["text/markdown"],
        maximumSizeInBytes: 10 * 1024 * 1024,
        addRandomSuffix: false,
        allowOverwrite: false,
      },
    });
  });

  it("rejects a body that isn't a token request", async () => {
    const response = await POST(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: JSON.stringify({ type: "blob.upload-completed", payload: {} }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });
});
