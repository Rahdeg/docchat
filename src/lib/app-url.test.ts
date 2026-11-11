import { describe, expect, it } from "vitest";

import { appOriginFrom } from "./app-url";

describe("appOriginFrom", () => {
  it("prefers APP_URL", () => {
    expect(
      appOriginFrom({
        APP_URL: "https://docchat.raheem.online",
        VERCEL_PROJECT_PRODUCTION_URL: "docchat.vercel.app",
      }),
    ).toBe("https://docchat.raheem.online");
  });

  it("drops a trailing slash", () => {
    expect(appOriginFrom({ APP_URL: "https://docchat.raheem.online/" })).toBe(
      "https://docchat.raheem.online",
    );
  });

  it("falls back to Vercel's production domain, then localhost", () => {
    expect(appOriginFrom({ VERCEL_PROJECT_PRODUCTION_URL: "docchat.vercel.app" })).toBe(
      "https://docchat.vercel.app",
    );
    expect(appOriginFrom({})).toBe("http://localhost:3000");
  });
});
