// Response headers for every route (next.config.ts, docs/adr/0008). Pure, so it's unit-tested.
//
// The Content-Security-Policy follows Clerk's manual CSP guide without a nonce: a nonce would
// make every page render per request and give up Cache Components' static shells. So scripts
// need 'unsafe-inline' (Next's App Router inlines its bootstrap), as Clerk's guide says.

type Header = { key: string; value: string };

// Clerk's Frontend API host, from the publishable key: pk_test_ or pk_live_, then base64 of
// "<host>$". Dev instances use *.clerk.accounts.dev; production uses clerk.<your domain>
// (clerk.docchat.raheem.online). So each build allows exactly the instance whose key it has:
// Production's pk_live_ key, Preview's and Development's pk_test_ one. Both Clerk bundles
// (clerk-js and @clerk/ui) load from this host.
export function clerkFrontendApiHost(publishableKey: string): string {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  if (!/^[a-z0-9.-]+$/i.test(decoded)) throw new Error("Unrecognised Clerk publishable key");
  return decoded;
}

type PolicyOptions = {
  publishableKey: string;
  // next dev: React's dev tools need eval.
  development: boolean;
};

export function contentSecurityPolicy({ publishableKey, development }: PolicyOptions): string {
  const clerk = `https://${clerkFrontendApiHost(publishableKey)}`;
  // Clerk sends SDK telemetry only from development instances.
  const telemetry = publishableKey.startsWith("pk_test_")
    ? ["https://clerk-telemetry.com", "https://*.clerk-telemetry.com"]
    : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
      clerk,
      // Clerk's bot protection (Cloudflare Turnstile) and abuse and fraud protection.
      "https://challenges.cloudflare.com",
      "https://*.protect.clerk.com",
    ],
    "connect-src": [
      "'self'",
      clerk,
      // Its hosts answer on ports other than 443, hence :*.
      "https://*.protect.clerk.com:*",
      ...telemetry,
      // Browsers upload files straight to Vercel Blob (src/features/documents/components/use-uploads.ts).
      "https://vercel.com/api/blob/",
    ],
    // Avatars come from Clerk; data: and blob: for small inline images.
    "img-src": ["'self'", "https://img.clerk.com", "data:", "blob:"],
    // next/font serves Geist and Newsreader from our own origin, so no Google Fonts hosts.
    "font-src": ["'self'", "data:"],
    // Clerk's components inject their styles at runtime.
    "style-src": ["'self'", "'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'", "https://challenges.cloudflare.com", "https://*.protect.clerk.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(development ? {} : { "upgrade-insecure-requests": [] }),
  };

  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

// What still applies while the full policy is report-only: frame-ancestors only works in an
// enforced policy, and these four can't break a page that works.
export const ENFORCED_BASELINE_POLICY =
  "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

export function securityHeaders(
  options: PolicyOptions & {
    // CSP_REPORT_ONLY: browsers report violations in the console instead of blocking.
    reportOnly: boolean;
  },
): Header[] {
  const policy = contentSecurityPolicy(options);
  return [
    ...(options.reportOnly
      ? [
          { key: "Content-Security-Policy", value: ENFORCED_BASELINE_POLICY },
          { key: "Content-Security-Policy-Report-Only", value: policy },
        ]
      : [{ key: "Content-Security-Policy", value: policy }]),
    // Older browsers' version of frame-ancestors 'none'.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "browsing-topics=()",
        // Passkeys in Clerk's sign-in, and the copy buttons on Settings.
        "publickey-credentials-get=(self)",
        "publickey-credentials-create=(self)",
        "clipboard-write=(self)",
      ].join(", "),
    },
    // Browsers ignore it over plain http (localhost).
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
