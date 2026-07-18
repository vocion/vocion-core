# Vocion production Dockerfile (Phase F — single-EC2 + Docker Compose).
#
# Multi-stage build:
#   Stage 1 (deps)    — install workspace deps with npm ci.
#   Stage 2 (builder) — run `npm run build` to produce .next/standalone.
#   Stage 3 (runner)  — minimal runtime image, no dev deps, non-root user.
#
# Build from the repo root:
#   docker build -t vocion-app -f packages/core/Dockerfile .
#
# Run locally:
#   docker run --rm -p 3000:3000 --env-file packages/core/.env.local vocion-app
#
# In production the same image runs both the web tier (default CMD) and
# the feedback worker (override CMD; see infra/aws/docker-compose.prod.yml).

# ----------------------------------------------------------------------
# Stage 1 — install dependencies
# ----------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Workspace structure: copy every package.json so npm ci sees the graph.
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/plugins/transcript-highlights/package.json ./packages/plugins/transcript-highlights/

# `--ignore-scripts` skips lefthook + husky hooks that aren't needed inside Docker.
RUN apk add --no-cache libc6-compat python3 make g++ \
  && npm ci --ignore-scripts

# ----------------------------------------------------------------------
# Stage 2 — build the app
# ----------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Disable Sentry source-map upload at build time — production deploys
# can re-enable by passing NEXT_PUBLIC_SENTRY_DISABLED='' at build.
ENV NEXT_PUBLIC_SENTRY_DISABLED=1
# t3-env validates required env at module load. The real values come
# from .env.production at runtime; skip validation during build.
ENV SKIP_ENV_VALIDATION=1

# NEXT_PUBLIC_* values are inlined into the client JS bundle at build
# time — they CANNOT be overridden by runtime env. Pass real values
# via --build-arg when building for production (update.sh does this).
# Defaults below are safe stubs for local image builds without prod env.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuYWNjb3VudHMuZGV2JA
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_LANGFUSE_BASE_URL=http://localhost:3200
ARG NEXT_PUBLIC_LANGFUSE_PROJECT_ID=demo
# White-label brand slot (sidebar + marketing). Defaults to Vocion; a deployment
# overrides via --build-arg. NEXT_PUBLIC_* is inlined at build time, so these
# must be ARG+ENV here (not runtime env).
#   BRAND_NAME    — wordmark text (e.g. "metacto")
#   BRAND_TAGLINE — subhead under the wordmark (e.g. "agents by Vocion")
#   BRAND_MARK    — glyph image src / data: URI (deployment supplies its own art)
ARG NEXT_PUBLIC_BRAND_NAME=Vocion
ENV NEXT_PUBLIC_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME}
ARG NEXT_PUBLIC_BRAND_TAGLINE=
ENV NEXT_PUBLIC_BRAND_TAGLINE=${NEXT_PUBLIC_BRAND_TAGLINE}
ARG NEXT_PUBLIC_BRAND_MARK=
ENV NEXT_PUBLIC_BRAND_MARK=${NEXT_PUBLIC_BRAND_MARK}
ARG NEXT_PUBLIC_BRAND_LOCKUP=
ENV NEXT_PUBLIC_BRAND_LOCKUP=${NEXT_PUBLIC_BRAND_LOCKUP}
ARG NEXT_PUBLIC_BRAND_LOCKUP_DARK=
ENV NEXT_PUBLIC_BRAND_LOCKUP_DARK=${NEXT_PUBLIC_BRAND_LOCKUP_DARK}
ARG NEXT_PUBLIC_BRAND_ATTRIBUTION=
ENV NEXT_PUBLIC_BRAND_ATTRIBUTION=${NEXT_PUBLIC_BRAND_ATTRIBUTION}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `output: 'standalone'` in packages/core/next.config.ts produces
# packages/core/.next/standalone/ with only the runtime deps the
# server needs. Keep build context-aware (we're at repo root).
#
# Skip the `db:migrate` step that ships with `npm run build` — we
# don't have DATABASE_URL at build time, and migrations should run
# at boot anyway (bootstrap.sh fires them post-container-start).
WORKDIR /app/packages/core
RUN SKIP_ENV_VALIDATION=1 \
    NEXT_PUBLIC_SENTRY_DISABLED=1 \
    DATABASE_URL="postgres://stub@stub/stub" \
    CLERK_SECRET_KEY="sk_test_Y2xlcmsuYWNjb3VudHMuZGV2JA" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}" \
    NEXT_PUBLIC_LANGFUSE_BASE_URL="${NEXT_PUBLIC_LANGFUSE_BASE_URL}" \
    NEXT_PUBLIC_LANGFUSE_PROJECT_ID="${NEXT_PUBLIC_LANGFUSE_PROJECT_ID}" \
    OPENAI_API_KEY="sk-build-stub" \
    ANTHROPIC_API_KEY="sk-ant-build-stub" \
    LANGFUSE_PUBLIC_KEY="pk-stub" \
    LANGFUSE_SECRET_KEY="sk-stub" \
    npm run build:next \
 && npm run docs:index

# ----------------------------------------------------------------------
# Stage 3 — runtime
# ----------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy the standalone server + the static + public + context tree.
# The standalone output already includes the trimmed node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/packages/core/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/core/.next/static ./packages/core/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/core/public ./packages/core/public
# The workspace-as-code tree lives OUTSIDE the repo since the
# workspace-removal change: deployments mount their own tree and point
# WORKSPACE_PATH at it, so nothing is baked into the image.
# Drizzle migrations the runtime applies on first boot.
COPY --from=builder --chown=nextjs:nodejs /app/packages/core/migrations ./packages/core/migrations
# Public docs corpus served by the in-product viewer + the marketing
# /docs route. `libs/docs.ts` reads from these paths at request time
# via `getRepoRoot()` + readFileSync — they must exist in the runtime
# WORKDIR. Phase K.1 fix.
COPY --from=builder --chown=nextjs:nodejs /app/docs ./docs
COPY --from=builder --chown=nextjs:nodejs /app/requirements ./requirements
COPY --from=builder --chown=nextjs:nodejs /app/README.md ./README.md
# package.json + the workspace root marker so `getRepoRoot()` resolves
# to /app inside the container (the standalone build's CWD).
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs
EXPOSE 3000

# Default command runs the Next.js standalone server.
# The worker container in docker-compose.prod.yml overrides this CMD.
CMD ["node", "packages/core/server.js"]
