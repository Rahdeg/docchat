// Per-user rate limits beyond the daily chat limit (src/server/ai/limits.ts). Every number is
// here; src/server/rate-limit.ts enforces them over a sliding window (docs/adr/0008).

export const rateLimitBuckets = ["mcp", "search", "upload"] as const;
export type RateLimitBucket = (typeof rateLimitBuckets)[number];

export type RateLimit = { max: number; windowSeconds: number };

export const RATE_LIMITS = {
  // Every MCP tool call from a connected AI app.
  mcp: { max: 60, windowSeconds: 60 },
  // Every search that embeds a query: questions on /chat (POST /api/chat) and MCP
  // search_documents. Embeddings share one provider quota.
  search: { max: 30, windowSeconds: 60 },
  // Upload tokens (POST /api/documents/upload): one per file.
  upload: { max: 20, windowSeconds: 60 * 60 },
} as const satisfies Record<RateLimitBucket, RateLimit>;

// Events older than this are never counted again, so they can be deleted.
export const LONGEST_WINDOW_SECONDS = Math.max(
  ...Object.values(RATE_LIMITS).map((limit) => limit.windowSeconds),
);

function waitText(seconds: number): string {
  if (seconds < 60) {
    const s = Math.max(1, Math.ceil(seconds));
    return `${s} second${s === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function rateLimitMessage(bucket: RateLimitBucket, retryAfterSeconds: number): string {
  const wait = waitText(retryAfterSeconds);
  switch (bucket) {
    case "mcp":
      return `Your AI app has made ${RATE_LIMITS.mcp.max} requests to DocChat in the last minute. Try again in ${wait}.`;
    case "search":
      return `That's a lot of searches in a minute. Try again in ${wait}.`;
    case "upload":
      return `You've uploaded ${RATE_LIMITS.upload.max} files in the last hour. You can upload more in ${wait}.`;
  }
}
