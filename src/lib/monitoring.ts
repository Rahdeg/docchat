import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/nextjs";

type InitOptions = NonNullable<Parameters<typeof import("@sentry/nextjs").init>[0]>;

// Error monitoring with Sentry (docs/adr/0009): on only when SENTRY_DSN is set, errors only (no
// tracing, no Replay, no feedback), and nothing personal. Sentry gets an error's type, its
// scrubbed message and stack, the route, the runtime, and the Clerk user id. Never document
// text, passages, prompts, answers, file names, emails, request bodies, headers or cookies.
//
// Shared by the server, edge and browser setups. Types only from Sentry, so importing this
// costs no bundle.

// Turns off every kind of data Sentry collects on its own. Sentry 11's dataCollection replaces
// sendDefaultPii.
export const DATA_COLLECTION: InitOptions["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

// Default integrations that record what code logs or holds: console output (can quote a
// document), the AI SDK's prompts and outputs, Zod issues and extra error fields (can carry
// input values).
export const DROPPED_INTEGRATIONS = new Set([
  "Console",
  "ConsoleLogs",
  "CaptureConsole",
  "VercelAI",
  "ZodErrors",
  "ExtraErrorData",
]);

const MAX_TEXT = 300;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Storage paths carry the file name: users/<userId>/<uuid>-<name>.
const STORAGE_PATH = /users\/[^\s"'`)\]]+/g;
// Anything quoted: a message that quotes a title, a file name or a passage.
const QUOTED = /"[^"\n]{1,2000}"|“[^”\n]{1,2000}”|`[^`\n]{1,2000}`/g;
// Long runs of words after a colon ("Indexing failed: <whatever the PDF said>").
const AFTER_COLON = /(:\s)([^:\n]{120,})$/;

// An error message or breadcrumb, with what could identify a person or a document removed.
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(STORAGE_PATH, "users/[path]")
    .replace(QUOTED, "[quoted]")
    .replace(AFTER_COLON, "$1[text]")
    .slice(0, MAX_TEXT);
}

function withoutQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.split(/[?#]/)[0];
}

const KEPT_CONTEXTS = new Set(["os", "runtime", "browser", "device", "app", "cloud_resource"]);

// beforeSend: keeps an allowlist of fields and scrubs the messages.
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  const userId = event.user?.id;
  event.user =
    typeof userId === "string" && userId.startsWith("user_") ? { id: userId } : undefined;

  if (event.request) {
    event.request = { method: event.request.method, url: withoutQuery(event.request.url) };
  }
  if (event.transaction) event.transaction = withoutQuery(event.transaction);
  delete event.extra;
  delete event.server_name;
  if (event.contexts) {
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).filter(([key]) => KEPT_CONTEXTS.has(key)),
    );
  }

  if (event.message) event.message = scrubText(event.message);
  if (event.logentry) {
    event.logentry = { message: event.logentry.message && scrubText(event.logentry.message) };
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubText(value.value);
    for (const frame of value.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return event;
}

// beforeBreadcrumb: page navigations only, without query strings. Console, fetch, XHR and UI
// breadcrumbs can carry document text, file names or what someone typed.
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category !== "navigation") return null;
  const data = crumb.data ?? {};
  return {
    ...crumb,
    message: undefined,
    data: {
      from: withoutQuery(typeof data.from === "string" ? data.from : undefined),
      to: withoutQuery(typeof data.to === "string" ? data.to : undefined),
    },
  };
}

// The options every runtime shares.
export function sentryOptions(dsn: string, environment: string | undefined): InitOptions {
  return {
    dsn,
    environment,
    dataCollection: DATA_COLLECTION,
    // Errors only: spans would carry storage URLs (file names) and query text.
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    integrations: (defaults) =>
      defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name)),
  };
}
