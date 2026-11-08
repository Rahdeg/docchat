import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  DATA_COLLECTION,
  DROPPED_INTEGRATIONS,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  sentryOptions,
} from "./monitoring";

describe("scrubText", () => {
  it("removes emails, storage paths and quoted text", () => {
    expect(scrubText("Couldn't email priya.n+test@example.co.uk about it")).toBe(
      "Couldn't email [email] about it",
    );
    expect(scrubText("Couldn't delete blob users/user_2abc/0b5c-Lease 2026.pdf")).toBe(
      "Couldn't delete blob users/[path] 2026.pdf",
    );
    expect(scrubText('Deleted "Pay the deposit to Marlowe"')).toBe("Deleted [quoted]");
    expect(scrubText("Title “My tenancy” not found")).toBe("Title [quoted] not found");
  });

  it("drops long text after a colon and caps the length", () => {
    const passage =
      "The Tenant must pay the rent on the first day of each month by standing order. ".repeat(3);
    expect(scrubText(`Indexing failed: ${passage}`)).toBe("Indexing failed: [text]");
    expect(scrubText("x".repeat(1000))).toHaveLength(300);
  });

  it("keeps ordinary error messages", () => {
    expect(scrubText("connect ECONNREFUSED 127.0.0.1:5432")).toBe(
      "connect ECONNREFUSED 127.0.0.1:5432",
    );
  });
});

describe("scrubEvent", () => {
  function event(): ErrorEvent {
    return {
      type: undefined,
      user: { id: "user_2abc", email: "a@b.co", ip_address: "1.2.3.4", username: "priya" },
      request: {
        method: "POST",
        url: "https://docchat.app/api/chat?documentId=x&q=rent",
        headers: { cookie: "__session=secret", authorization: "Bearer t" },
        cookies: { __session: "secret" },
        data: '{"message":"What is the rent?"}',
        query_string: "q=rent",
      },
      transaction: "/chat/abc?documentId=x",
      server_name: "host-1",
      extra: { passage: "The rent is 1,150 pounds" },
      contexts: { os: { name: "Linux" }, response: { status_code: 500 } },
      message: 'Failed to save "My lease.pdf" for a@b.co',
      exception: {
        values: [
          {
            type: "Error",
            value: "Couldn't read users/user_2abc/0b5c-Lease.pdf",
            stacktrace: { frames: [{ function: "f", vars: { question: "What is the rent?" } }] },
          },
        ],
      },
      breadcrumbs: [
        { category: "console", message: "The rent is 1,150 pounds" },
        { category: "fetch", data: { url: "https://x.blob/users/u/Lease.pdf" } },
        { category: "ui.click", message: "button[aria-label=Pay the rent]" },
        { category: "navigation", data: { from: "/library", to: "/chat/abc?documentId=x" } },
      ],
    };
  }

  it("keeps only the Clerk user id", () => {
    expect(scrubEvent(event()).user).toEqual({ id: "user_2abc" });
    expect(scrubEvent({ ...event(), user: { id: "1.2.3.4" } }).user).toBeUndefined();
  });

  it("keeps the method and path of the request, nothing else", () => {
    expect(scrubEvent(event()).request).toEqual({
      method: "POST",
      url: "https://docchat.app/api/chat",
    });
    expect(scrubEvent(event()).transaction).toBe("/chat/abc");
  });

  it("drops extra data, unknown contexts and stack variables, and scrubs messages", () => {
    const scrubbed = scrubEvent(event());
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.contexts).toEqual({ os: { name: "Linux" } });
    expect(scrubbed.message).toBe("Failed to save [quoted] for [email]");
    expect(scrubbed.exception?.values?.[0]?.value).toBe("Couldn't read users/[path]");
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it("keeps only navigation breadcrumbs, without query strings", () => {
    expect(scrubEvent(event()).breadcrumbs).toEqual([
      { category: "navigation", message: undefined, data: { from: "/library", to: "/chat/abc" } },
    ]);
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
  });

  it("never lets document text through, whatever the field", () => {
    const text = JSON.stringify(scrubEvent(event()));
    for (const secret of ["1,150", "rent", "Lease", "a@b.co", "secret", "Bearer", "priya"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("sentryOptions", () => {
  it("collects no personal data and records no AI inputs or outputs", () => {
    const options = sentryOptions("https://key@o1.ingest.sentry.io/1", "production");
    expect(options.dataCollection).toBe(DATA_COLLECTION);
    expect(DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    });
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeSend).toBe(scrubEvent);
  });

  it("drops the integrations that record logs, prompts or inputs", () => {
    const options = sentryOptions("https://key@o1.ingest.sentry.io/1", undefined);
    const defaults = ["Http", "VercelAI", "Console", "ZodErrors", "LinkedErrors"].map((name) => ({
      name,
      setupOnce: () => {},
    }));
    const integrations = options.integrations;
    if (typeof integrations !== "function") throw new Error("expected a function");
    expect(integrations(defaults).map((i) => i.name)).toEqual(["Http", "LinkedErrors"]);
    expect(DROPPED_INTEGRATIONS.has("VercelAI")).toBe(true);
  });
});
