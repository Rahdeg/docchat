import { expect, test } from "@playwright/test";

// The signed-in upload flow is in flows.spec.ts (and signed-in.spec.ts, against real Blob).
// TODO(e2e): retry a document that failed to read.

test("signed-out requests can't read a stored file or get an upload token", async ({ request }) => {
  const file = await request.get("/api/documents/00000000-0000-4000-8000-000000000000/file", {
    maxRedirects: 0,
  });
  expect(file.status()).toBe(401);
  expect(file.headers()["cache-control"]).toBe("private, no-cache");

  const token = await request.post("/api/documents/upload", {
    data: {
      type: "blob.generate-client-token",
      payload: { pathname: "users/user_x/a.pdf", clientPayload: null, multipart: false },
    },
    maxRedirects: 0,
  });
  expect(token.status()).toBe(401);
});
