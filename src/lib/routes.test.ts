import { describe, expect, it } from "vitest";

import { isPublicPath } from "./routes";

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
