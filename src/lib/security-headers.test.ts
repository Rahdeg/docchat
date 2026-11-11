import { describe, expect, it } from "vitest";

import {
  clerkFrontendApiHost,
  contentSecurityPolicy,
  ENFORCED_BASELINE_POLICY,
  securityHeaders,
} from "./security-headers";

const devKey = `pk_test_${Buffer.from("moving-bunny-8224.clerk.accounts.dev$").toString("base64")}`;
// The production instance's key (pk_live_ + base64 of its Frontend API host). Publishable keys
// are public and built into every page.
const liveKey = `pk_live_${Buffer.from("clerk.docchat.raheem.online$").toString("base64")}`;

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
    expect(clerkFrontendApiHost(liveKey)).toBe("clerk.docchat.raheem.online");
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
      "https://clerk.docchat.raheem.online",
      "https://*.protect.clerk.com:*",
      "https://vercel.com/api/blob/",
    ]);
    expect(d["script-src"]).toContain("https://clerk.docchat.raheem.online");
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

// Every directive Clerk's CSP guide asks for (clerk.com/docs/guides/secure/best-practices/csp-headers),
// with the Frontend API host taken from whichever key the build has.
describe.each([
  ["production", liveKey, "https://clerk.docchat.raheem.online"],
  ["development", devKey, "https://moving-bunny-8224.clerk.accounts.dev"],
])("Clerk's directives with a %s key", (_name, publishableKey, frontendApi) => {
  const d = directives(contentSecurityPolicy({ publishableKey, development: false }));

  it("allows its Frontend API, bot protection and fraud protection", () => {
    expect(d["script-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        "'unsafe-inline'",
        frontendApi,
        "https://challenges.cloudflare.com",
        "https://*.protect.clerk.com",
      ]),
    );
    expect(d["connect-src"]).toEqual(
      expect.arrayContaining(["'self'", frontendApi, "https://*.protect.clerk.com:*"]),
    );
    expect(d["frame-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://challenges.cloudflare.com",
        "https://*.protect.clerk.com",
      ]),
    );
    expect(d["img-src"]).toEqual(expect.arrayContaining(["'self'", "https://img.clerk.com"]));
    expect(d["worker-src"]).toEqual(expect.arrayContaining(["'self'", "blob:"]));
    expect(d["style-src"]).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
  });

  it("allows no other Clerk instance", () => {
    const clerkHosts = Object.values(d)
      .flat()
      .filter((value) => /clerk\.accounts\.dev|clerk\.docchat/.test(value));
    expect(new Set(clerkHosts)).toEqual(new Set([frontendApi]));
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
