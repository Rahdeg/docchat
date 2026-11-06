"use client";

import { z } from "zod";

// Zod 4 compiles object parsers with `new Function` when it can, and finds out by trying once.
// Under our Content-Security-Policy (no 'unsafe-eval', docs/adr/0008) that try is blocked and
// reported as a violation, though Zod then falls back. jitless skips the try: same results,
// no eval. Runs when the root layout's client code loads, before any page parses.
z.config({ jitless: true });

export function ZodBrowserConfig() {
  return null;
}
