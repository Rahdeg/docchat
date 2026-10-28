import { describe, expect, it } from "vitest";

import { documentFileUrl, isPublicPath } from "./routes";

describe("isPublicPath", () => {
  it.each(["/", "/sign-in", "/sign-in/factor-one", "/sign-up", "/sign-up/verify-email-address"])(
    "allows %s",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(true);
    },
  );

  it.each(["/library", "/chat", "/tasks", "/sign-inx", "/sign-up-admin", "/api/chat"])(
    "protects %s",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(false);
    },
  );
});

describe("documentFileUrl", () => {
  it("points at the authed file route", () => {
    expect(documentFileUrl("abc")).toBe("/api/documents/abc/file");
  });

  it("opens a PDF at a page", () => {
    expect(documentFileUrl("abc", 3)).toBe("/api/documents/abc/file#page=3");
  });
});
