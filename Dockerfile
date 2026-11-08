# syntax=docker/dockerfile:1.7
# DocChat as a container: a Next.js standalone server on Node 24, as a non-root user. Built and
# run by docker-compose.yml with a local Postgres (pgvector); Clerk, Vercel Blob and the AI
# provider stay external, with their keys from .env.local (README, "Run with Docker").

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    # No git hooks inside the image.
    LEFTHOOK=0 \
    PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm
WORKDIR /app

# Dependencies, cached until the lockfile changes.
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# The production build. .env.local is mounted as a build secret: `next build` validates the env
# and inlines the public values (the Clerk publishable key, the CSP, the Sentry DSN) from it,
# and the file never lands in an image layer.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV BUILD_STANDALONE=1
# public/ has no tracked files, so a fresh clone has no folder for the runner to copy.
RUN mkdir -p public
RUN --mount=type=secret,id=env_local,target=/app/.env.local,required=true \
    pnpm build

# One-off: applies the migrations (docker compose runs it before the app starts).
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
CMD ["pnpm", "db:migrate"]

# The image that runs: the traced standalone server and its static files, nothing else.
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# /api/health pings the database; no curl or wget in the image, so Node's fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
