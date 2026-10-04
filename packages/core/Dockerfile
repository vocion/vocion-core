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
# Needs BuildKit, which `docker build` uses only when Docker's buildx plugin is
# installed. Without it Docker falls back to its legacy builder and stops with
# "the --mount option requires BuildKit". `infra/aws/install-buildx.sh`
# installs a pinned, checksum-checked plugin; a parent project's deploy
# scripts should call it before building this file.
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
# White-label brand slot (sidebar + sign-in). Defaults to the Vocion identity
# from vocion.ai (public/brand/vocion-primary-mark.svg + wordmark "Vocion");
# a deployment overrides via --build-arg. NEXT_PUBLIC_* is inlined at build
# time, so these must be ARG+ENV here (not runtime env).
#   BRAND_NAME        — wordmark text (e.g. "Metacto")
#   BRAND_TAGLINE     — subhead under the wordmark (e.g. "agents by Vocion")
#   BRAND_MARK        — glyph image src / data: URI; empty = Vocion primary mark
#   BRAND_LOCKUP[_DARK] — mark+wordmark as one image (light / dark variants)
#   BRAND_ATTRIBUTION — sidebar footer line
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
# V8's default old-space cap is sized off the machine and is well under what a
# webpack build of this app now needs: on 2026-09-10 the build died with
# "Ineffective mark-compacts near heap limit" and the worker took SIGABRT, at a
# point where the same build had been finishing a half hour earlier. That is a
# heap ceiling rather than the box running out of memory, so the cap is named
# here instead of left to be inferred. Kept at 6 GiB so it stays safe on the
# smaller instance size, with Postgres and Langfuse resident on the
# same box while the image builds. That failure was a webpack build. Since
# #670 the build runs on Turbopack, whose compiler is native code and lives
# outside V8's heap, so the cap now bounds the JavaScript half of the build
# (collecting page data, prerendering, the type check). The cap stays.
#
# The cache mount on the build step keeps Turbopack's build cache
# (`.next/cache`) on the box between image builds, so a deploy recompiles only
# what changed. Measured on Next 16.3.6 (#670): the compile's peak memory is
# about 3.3 GB on a warm cache, even after editing a file 204 others import,
# against 6.6 GB for a build that starts with an empty cache. The first build
# on a new box is that cold one and still needs the full amount. The cache
# stays out of the image: a mount is never part of a layer. It is one
# directory per box that every build reuses (about 1.3 GB after a local
# build), and `docker builder prune` clears it. `sharing=locked`
# makes a second build started on the same box wait for the first, so two
# builds never write the cache at once. There's no `# syntax=` line: the
# cache mount is in the Dockerfile frontend built into BuildKit, and a pinned
# frontend would add a Docker Hub image to every build.
# The build says what it is (#417): `public/version.txt` + the account-menu
# stamp. `npm run build` runs this, but the image calls `next build` directly,
# so the step is explicit here — the first deploy of #417 shipped an image with
# no version.txt at all (2026-09-17). The context has no .git (.dockerignore),
# so the parent's bootstrap hands in the core commit it is building.
ARG VOCION_DEPLOY_PIN=
ARG VOCION_BUILD_SHA=
ARG VOCION_BUILD_SUBJECT=
ARG VOCION_BUILD_REF=
ARG VOCION_BUILD_DESCRIBE=
ARG VOCION_AGENT_RUNTIME_IMAGE=
RUN VOCION_DEPLOY_PIN="${VOCION_DEPLOY_PIN}" VOCION_BUILD_SHA="${VOCION_BUILD_SHA}" \
    VOCION_BUILD_SUBJECT="${VOCION_BUILD_SUBJECT}" VOCION_BUILD_REF="${VOCION_BUILD_REF}" \
    VOCION_BUILD_DESCRIBE="${VOCION_BUILD_DESCRIBE}" \
    VOCION_AGENT_RUNTIME_IMAGE="${VOCION_AGENT_RUNTIME_IMAGE}" \
    node scripts/write-version.mjs

# Two passes, compile then generate (2026-10-03): in one process the compile's
# memory (~4.6 GB) is still held while pages render (+~1.3 GB), and the 7 GB
# deploy runner was killed twice (ResourceExhausted). Each pass now has the
# memory to itself; the standalone output is the same.
# One prerender worker, and a database that refuses at once (127.0.0.1:9),
# never a hostname that can sit in DNS. v0.6.0's build on the deploy runner
# (2 CPU, 7 GB) was killed at "Generating static pages using 2 workers (0/185)"
# with ResourceExhausted (2026-10-02, run 37024351912): each worker inherits
# the 6 GB heap the compile needs.
RUN --mount=type=cache,id=vocion-core-next-build-cache,sharing=locked,target=/app/packages/core/.next/cache \
    NODE_OPTIONS=--max-old-space-size=6144 \
    NEXT_BUILD_CPUS=1 \
    SKIP_ENV_VALIDATION=1 \
    VOCION_TYPES_CHECKED=1 \
    NEXT_PUBLIC_SENTRY_DISABLED=1 \
    DATABASE_URL="postgres://stub@127.0.0.1:9/stub" \
    CLERK_SECRET_KEY="sk_test_Y2xlcmsuYWNjb3VudHMuZGV2JA" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}" \
    NEXT_PUBLIC_LANGFUSE_BASE_URL="${NEXT_PUBLIC_LANGFUSE_BASE_URL}" \
    NEXT_PUBLIC_LANGFUSE_PROJECT_ID="${NEXT_PUBLIC_LANGFUSE_PROJECT_ID}" \
    OPENAI_API_KEY="sk-build-stub" \
    ANTHROPIC_API_KEY="sk-ant-build-stub" \
    LANGFUSE_PUBLIC_KEY="pk-stub" \
    LANGFUSE_SECRET_KEY="sk-stub" \
    npm run build:next:staged \
 && npm run docs:index

# The standalone output still carries some of core's source, specs and test
# output, which the server never reads: it runs the compiled bundle. Turbopack
# matches runtime paths by name, so reading `join(pluginDir, 'agents')` pulls
# every `agents/` folder in the project into the trace (#832). Drop them here,
# before the runtime stage copies the standalone output.
RUN cd .next/standalone/packages/core \
 && rm -rf src e2e tests docs deliverables scripts test-results vitest-test-results

# ----------------------------------------------------------------------
# Stage 3 — runtime
# ----------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# The app handles SIGTERM itself (src/instrumentation.ts): a turn in flight finishes before the process exits (backlog 056).
# Set here, in the stage that runs, not in the builder: the first attempt put it there and the container never saw it (2026-10-04).
ENV NEXT_MANUAL_SIG_HANDLE=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root.
# Chromium for the document engine (`libs/documents/render.ts`): documents are
# rendered, measured and printed in a real browser. Alpine's own Chromium,
# not Playwright's download (glibc); the engine finds it through
# PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. Fonts so text has a face to fall back
# to when a document's web fonts do not load.
# ffmpeg (with ffprobe, libvpx and libx264) for recordings: Playwright encodes
# the live check's video with it (VP8 WebM, linked below), and a narrated
# recording is composed with it (`libs/media/ffmpeg.ts`, H.264/AAC MP4).
# Alpine's `ffmpeg` is the smallest package that has all three.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-dejavu ttf-liberation font-noto-emoji ffmpeg \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Where Playwright looks for its own binaries, fixed so it does not depend on
# the runtime user's HOME (it was /home/nextjs/.cache/ms-playwright).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

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

# Playwright records video by piping frames to its OWN ffmpeg build, which it
# downloads for glibc and never for Alpine: with recording on, every page of the
# live check failed with "Executable doesn't exist at
# /home/nextjs/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux" (2026-10-03, #1107
# falls back to checking without recording). Alpine's ffmpeg (VP8 via libvpx)
# takes the same arguments, so it is linked where the installed playwright-core
# looks — the path asked of its own registry, so a Playwright upgrade that moves
# the revision moves the link with it. A build whose playwright-core cannot say
# fails here rather than shipping an image that cannot record.
RUN cd /app/packages/core \
 && FFMPEG_AT="$(node -e "process.stdout.write(require('playwright-core/lib/server/registry/index').registry.findExecutable('ffmpeg').executablePath('javascript') || '')")" \
 && test -n "$FFMPEG_AT" \
 && mkdir -p "$(dirname "$FFMPEG_AT")" \
 && ln -sf /usr/bin/ffmpeg "$FFMPEG_AT" \
 && chown -R nextjs:nodejs "$PLAYWRIGHT_BROWSERS_PATH" \
 && echo "playwright ffmpeg -> $FFMPEG_AT" \
 && "$FFMPEG_AT" -hide_banner -encoders 2>/dev/null | grep -q libvpx

USER nextjs
EXPOSE 3000

# Default command runs the Next.js standalone server.
# The worker container in docker-compose.prod.yml overrides this CMD.
CMD ["node", "packages/core/server.js"]
