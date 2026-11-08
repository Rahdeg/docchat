// Sentry's tunnel (docs/adr/0009): the browser sends error reports to /monitoring on our own
// origin (rewritten here by withSentryConfig), and this forwards only the event payload to
// Sentry. Ad blockers don't drop them and the CSP needs no Sentry host. It accepts only our own
// DSN (403 otherwise) and payloads up to 20 MiB. Public: reports can come from signed-out
// pages. Without SENTRY_DSN nothing is ever sent here.
export { POST } from "@sentry/nextjs/tunnel";
