import type { Page } from "@playwright/test";

// Collects Content-Security-Policy violations on a page: the browser's
// securitypolicyviolation events and console errors that mention the policy.
export function watchCsp(page: Page): () => string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Content-Security-Policy/i.test(text)) violations.push(text);
  });
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} blocked ${event.blockedURI} (${event.sourceFile}:${event.lineNumber}:${event.columnNumber})`,
      );
    });
  });
  return () => [...violations];
}
