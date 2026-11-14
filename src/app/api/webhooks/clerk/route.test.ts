import { createHmac, randomBytes } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A signing secret made up for the test: Standard Webhooks' "whsec_" plus base64 key bytes.
const key = randomBytes(24);
const secret = `whsec_${key.toString("base64")}`;

const mocks = vi.hoisted(() => ({ deleteUserData: vi.fn() }));

vi.mock("@/lib/env", () => ({ env: { CLERK_WEBHOOK_SIGNING_SECRET: secret } }));
vi.mock("@/server/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/account")>()),
  deleteUserData: mocks.deleteUserData,
}));

const { POST } = await import("./route");

// Signs a payload the way Clerk (Svix, Standard Webhooks) does: HMAC-SHA256 over
// "<id>.<timestamp>.<body>" with the secret's key, sent as "v1,<base64>".
function signed(
  payload: unknown,
  { signWith = key, timestamp = Math.floor(Date.now() / 1000), id = "msg_test_1" } = {},
) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", signWith)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return new NextRequest("http://localhost:3000/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}

const userDeleted = (id: string | undefined) => ({
  type: "user.deleted",
  object: "event",
  data: { id, object: "user", deleted: true },
  timestamp: Date.now(),
  instance_id: "ins_test",
});

const deletion = {
  rows: {
    tasks: 2,
    messages: 4,
    chats: 1,
    chunks: 9,
    pages: 3,
    documents: 1,
    aiUsage: 7,
    rateLimits: 2,
    usageCounters: 1,
  },
  files: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteUserData.mockResolvedValue(deletion);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/webhooks/clerk", () => {
  it("deletes the user's data on a signed user.deleted", async () => {
    const response = await POST(signed(userDeleted("user_2abcDEF123")));

    expect(response.status).toBe(200);
    expect(mocks.deleteUserData).toHaveBeenCalledWith("user_2abcDEF123");
  });

  it("is safe to deliver twice (Clerk retries)", async () => {
    mocks.deleteUserData
      .mockResolvedValueOnce(deletion)
      .mockResolvedValueOnce({ rows: { ...deletion.rows, tasks: 0, documents: 0 }, files: 0 });

    const first = await POST(signed(userDeleted("user_2abcDEF123")));
    const second = await POST(signed(userDeleted("user_2abcDEF123")));

    expect([first.status, second.status]).toEqual([200, 200]);
  });

  it.each([
    ["a signature from another secret", { signWith: randomBytes(24) }],
    ["an old timestamp (a replay)", { timestamp: Math.floor(Date.now() / 1000) - 60 * 60 }],
  ])("rejects %s without deleting anything", async (_label, options) => {
    const response = await POST(signed(userDeleted("user_2abcDEF123"), options));

    expect(response.status).toBe(400);
    expect(mocks.deleteUserData).not.toHaveBeenCalled();
  });

  it("rejects an unsigned request", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/webhooks/clerk", {
        method: "POST",
        body: JSON.stringify(userDeleted("user_2abcDEF123")),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.deleteUserData).not.toHaveBeenCalled();
  });

  it("rejects a body changed after signing", async () => {
    const request = signed(userDeleted("user_2abcDEF123"));
    const tampered = new NextRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(userDeleted("user_victim")),
    });

    expect((await POST(tampered)).status).toBe(400);
    expect(mocks.deleteUserData).not.toHaveBeenCalled();
  });

  it("acknowledges other events and a user.deleted without a usable id, deleting nothing", async () => {
    const created = await POST(signed({ ...userDeleted("user_2abc"), type: "user.created" }));
    const noId = await POST(signed(userDeleted(undefined)));
    const odd = await POST(signed(userDeleted("../../users")));

    expect([created.status, noId.status, odd.status]).toEqual([200, 200, 200]);
    expect(mocks.deleteUserData).not.toHaveBeenCalled();
  });

  it("answers 500 when deleting fails, so Clerk retries", async () => {
    mocks.deleteUserData.mockRejectedValue(new Error("Blob unavailable"));

    const response = await POST(signed(userDeleted("user_2abcDEF123")));

    expect(response.status).toBe(500);
  });
});
