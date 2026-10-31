import "server-only";

import { RetryError } from "ai";

export type CallLimits = {
  // Minimum gap between starting two requests.
  minIntervalMs: number;
  // Per request, on rate limits (429) and server errors.
  maxRetries: number;
  // Give up rather than wait longer than this before a retry. For requests someone is watching:
  // a per-minute quota can ask for most of a minute.
  maxDelayMs?: number;
};

// A function that runs model calls on one schedule, retrying rate limits and server errors.
// Rate limits are per API key and model, so every call through one caller in this process
// shares the schedule: each starts at least `minIntervalMs` after the previous one. `limits` is
// read on every call, so tests can change it.
//
// The SDK's own retries (2 s, 4 s, 8 s) are too short for a per-minute quota, so callers turn
// them off (maxRetries: 0) and this waits as long as the provider asks, or 5 s doubling up to a
// minute.
export function createModelCaller(label: string, limits: () => CallLimits) {
  let nextStart = 0;

  async function paced<T>(call: () => PromiseLike<T>): Promise<T> {
    const { minIntervalMs } = limits();
    if (minIntervalMs === 0) return call();
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + minIntervalMs;
    if (wait > 0) await sleep(wait);
    return call();
  }

  return async function callModel<T>(call: () => PromiseLike<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await paced(call);
      } catch (error) {
        const delay = retryDelayMs(error, attempt);
        const { maxRetries, maxDelayMs = Infinity } = limits();
        if (delay === null || attempt >= maxRetries || delay > maxDelayMs) throw error;
        console.warn(
          `${label} request failed (${statusOf(error) ?? "network"}); retry ${attempt + 1} in ${Math.round(delay / 1000)} s`,
        );
        await sleep(delay);
      }
    }
  };
}

type CallFailure = {
  statusCode?: number;
  isRetryable?: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
};

// APICallError and the gateway's errors both carry these fields.
function failureOf(error: unknown): CallFailure | null {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  return typeof cause === "object" && cause !== null ? (cause as CallFailure) : null;
}

export function statusOf(error: unknown): number | undefined {
  return failureOf(error)?.statusCode;
}

// A free-tier daily quota is used up: retrying today won't help.
export function isDailyQuotaError(error: unknown): boolean {
  const failure = failureOf(error);
  return failure?.statusCode === 429 && /PerDay/.test(failure.responseBody ?? "");
}

// The provider refused for quota: a rate limit or a used-up daily quota (a 429, or Google's
// RESOURCE_EXHAUSTED). By the time a caller sees it, the retries have given up.
export function isQuotaError(error: unknown): boolean {
  const failure = failureOf(error);
  if (failure?.statusCode === 429) return true;
  const message = error instanceof Error ? error.message : "";
  return /RESOURCE_EXHAUSTED/.test(`${failure?.responseBody ?? ""} ${message}`);
}

// How long to wait before retrying, or null to give up now.
export function retryDelayMs(error: unknown, attempt: number): number | null {
  const failure = failureOf(error);
  if (!failure) return null;
  if (failure.statusCode === 429) {
    return hintedDelayMs(failure) ?? Math.min(60_000, 5_000 * 2 ** attempt);
  }
  if (failure.isRetryable) return Math.min(30_000, 1_000 * 2 ** attempt);
  return null;
}

// A retry-after header (seconds), or Google's RetryInfo in the body ("retryDelay": "37s").
function hintedDelayMs(failure: CallFailure): number | null {
  const header = Number(failure.responseHeaders?.["retry-after"]);
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = failure.responseBody?.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
