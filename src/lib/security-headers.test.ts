import { describe, expect, it } from "vitest";

import {
  clerkFrontendApiHost,
  contentSecurityPolicy,
  ENFORCED_BASELINE_POLICY,
  securityHeaders,
} from "./security-headers";

const devKey = `pk_test_${Buffer.from("moving-bunny-8224.clerk.accounts.dev$").toString("base64")}`;
const liveKey = `pk_live_${Buffer.from("clerk.docchat.example.com$").toString("base64")}`;

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values];
    }),
  );
}

describe("clerkFrontendApiHost", () => {
  it("reads the host from the publishable key", () => {
    expect(clerkFrontendApiHost(devKey)).toBe("moving-bunny-8224.clerk.accounts.dev");
    expect(clerkFrontendApiHost(liveKey)).toBe("clerk.docchat.example.com");
  });

  it("refuses something that isn't a key", () => {
    expect(() =>
      clerkFrontendApiHost(`pk_test_${Buffer.from("a b;c$").toString("base64")}`),
    ).toThrow();
  });
});

describe("contentSecurityPolicy", () => {
  it("locks the page down and allows only Clerk, Cloudflare's challenge and Blob uploads", () => {
    const d = directives(contentSecurityPolicy({ publishableKey: liveKey, development: false }));

    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual([
      "'self'",
      "https://clerk.docchat.example.com",
      "https://*.protect.clerk.com:*",
      "https://vercel.com/api/blob/",
    ]);
    expect(d["script-src"]).toContain("https://clerk.docchat.example.com");
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
    // No wildcard hosts for scripts.
    expect(d["script-src"]).not.toContain("https:");
    expect(d["upgrade-insecure-requests"]).toEqual([]);
  });

  it("adds eval and Clerk's telemetry only where they're needed", () => {
    const d = directives(contentSecurityPolicy({ publishableKey: devKey, development: true }));

    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["connect-src"]).toContain("https://clerk-telemetry.com");
    expect(d["upgrade-insecure-requests"]).toBeUndefined();
  });
});

describe("securityHeaders", () => {
  const byKey = (reportOnly: boolean) =>
    Object.fromEntries(
      securityHeaders({ publishableKey: liveKey, development: false, reportOnly }).map((h) => [
        h.key,
        h.value,
      ]),
    );

  it("enforces the policy and sends the other headers", () => {
    const headers = byKey(false);

    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("publickey-credentials-get=(self)");
  });

  it("with CSP_REPORT_ONLY, only reports the policy but still enforces the baseline", () => {
    const headers = byKey(true);

    expect(headers["Content-Security-Policy"]).toBe(ENFORCED_BASELINE_POLICY);
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
  });
});
