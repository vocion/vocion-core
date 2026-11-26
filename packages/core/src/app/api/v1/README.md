# `/api/v1`: one route entry for every handler

Every `/api/v1/...` request goes through one Next route,
[`[...path]/route.ts`](./[...path]/route.ts), which hands it to the handler
Next would have picked if that handler were its own route. The handlers
themselves live in [`_routes/`](./_routes), laid out exactly as they used to
be (`_routes/reviews/decide/route.ts` serves `POST /api/v1/reviews/decide`).

This is an unusual pattern for a Next app, so this page explains why it is
here, what stays the same, and what changed.

## Why

Each v1 handler imports `_shared.ts`, which reaches about 1,300 modules
(1,324, counted with `reachOf` in `src/scripts/check-route-graph.ts`).
Building the 114 handlers as one route entry instead of 114 cut the build's
peak memory by about 1.8 to 1.9 GiB with CI settings and about 3.5 GiB with
the image's defaults. These are cold image builds of v8.48.0 (Next 16.4.6),
all in one workflow run
([45866594160](https://github.com/vocion/vocion-core/actions/runs/45866594160),
#1598), each on its own GitHub-hosted `ubuntu-latest` runner for a public
repo, which has 4 CPUs and 16 GB of memory
([GitHub's runner specs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)):

| Build | 114 v1 route entries (before) | One v1 route entry (this) |
|---|---|---|
| CI settings: `CI=1`, so no Turbopack build cache is written | 8,937 MiB | 6,987 and 7,081 MiB |
| Image default: `VOCION_BUILD_FS_CACHE=1`, build cache written | 12,801 MiB | 9,241 MiB |

How it was measured: while `docker build --target builder` ran
`packages/core/Dockerfile`, a script read `/proc/meminfo` every second. Each
figure is the peak of anonymous memory (`AnonPages`) plus swap in use
(`SwapTotal` minus `SwapFree`), minus the median of six samples taken on the
idle runner just before the build (280 to 295 MiB in this run). The
workflow added a 24 GB swap file; only the 12,801 MiB build touched it,
96 MiB at most. Measured instead as the whole runner's used memory above
idle (`MemTotal` minus `MemAvailable`, the way #670 measured), each build
comes out within 125 MiB of its figure in the table. 1 MiB is 1,048,576
bytes.

For the CI settings builds the workflow also added `turbopackSourceMaps:
false` at the top of `experimental` in `next.config.ts`. That changes
nothing on these commits: the file's own `turbopackSourceMaps` comes later
in the same object, so it wins.

The builds of this change ran at commit 7ba8df928. The change's later commits
touched only comments, docs, and the route table generator and its test,
which no route imports.

Each cell is one build except the two CI settings builds of this change. Two
identical builds of the same commit, in another run, peaked 209 MiB apart
(8,931 and 9,140 MiB, below), so read differences of a couple hundred MiB as
noise. The run's artifacts with the per-second samples expire on
3 December 2026.

Changing Turbopack's own settings instead didn't lower the peak beyond
run-to-run noise. On the Next 16.4.6 build before this change (114 entries,
CI settings), turning off input source maps, scope hoisting or minify, or
turning on its GC, peaked at 8,911, 9,003, 9,159 and 8,964 MiB, and all four
together at 9,038 MiB
([45861167136](https://github.com/vocion/vocion-core/actions/runs/45861167136)).
Two runs with none of them changed peaked at 8,931 and 9,140 MiB
([45857991270](https://github.com/vocion/vocion-core/actions/runs/45857991270)).
The GC result tells nothing: Next's docs say `turbopackGc` has no effect
when the build cache is off (`turbopackGc.md` in `next/dist/docs`), and
these were CI settings builds, so it is untested with the cache on.

## How a request reaches its handler

```
GET /api/v1/reviews/proposal/42
  -> api/v1/[...path]/route.ts           path = ['reviews', 'proposal', '42']
  -> dispatch.ts  matchV1Route()         finds _routes/reviews/[kind]/[id]
  -> _routes/reviews/[kind]/[id]/route.ts  GET(request, { params: { kind, id } })
```

- `_routes/` starts with an underscore, so Next never routes it
  ([private folders](https://nextjs.org/docs/app/getting-started/project-structure#private-folders)).
- [`[...path]/routeTable.generated.ts`](./[...path]/routeTable.generated.ts)
  imports every `_routes/**/route.ts` and records its folders. It is
  generated, never edited by hand.
- [`[...path]/dispatch.ts`](./[...path]/dispatch.ts) matches the path against
  that table the way Next does: same number of segments, a plain folder beats
  a `[param]` folder at the first place they differ, and params reach the
  handler as a `Promise`, as before.

## Adding or changing a handler

1. Write `_routes/<path>/route.ts` as a normal Next route handler.
2. Run `npm run v1-routes:generate` (the route table) and
   `npm run openapi:generate` (the API reference).
3. Commit both generated files.

`generate-v1-route-table.test.ts` fails if the committed table is not what the
folders generate, so a handler can't be left out by mistake.

What a handler can't do any more, and the generator refuses:

- **Set route segment config** (`dynamic`, `maxDuration`, `runtime`,
  `revalidate` and the rest). Next reads it from `[...path]/route.ts` only,
  so it is set there once for every handler. Change it there.
- **Use a catch-all, optional catch-all, route group, parallel or
  intercepting folder**, or a private `_folder`, below `_routes/`. The
  dispatcher only knows plain and `[param]` folders, which is all v1 uses.
- **Put two different param names in the same place** (`[id]` beside
  `[slug]`). Next refuses that too.

## What stays the same

For a path that matches a handler, the answer is the same as when each handler
was its own route, for every method:

- The handler gets the same request and the same `{ params }`.
- A method the handler doesn't export answers `405`.
- `HEAD` falls back to the handler's `GET`.
- `OPTIONS`, unless the handler exports it, answers `204` with an `Allow`
  header listing the methods.
- An error the handler throws reaches Next untouched.

The 405, HEAD and OPTIONS rules are not copied by hand:
[`dispatch.test.ts`](./[...path]/dispatch.test.ts) runs every method against
every export shape the handlers use, through both the dispatcher and Next's
own `autoImplementMethods`
(`next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`),
and checks the status, `Allow` header and body match.

The URLs, the OpenAPI document and the `/api-docs` page don't change.

## What is different

- **An unknown `/api/v1/...` path** answers an empty `404`. It used to render
  the app's not-found page as HTML, also with a `404`.
- **`maxDuration = 120`** now applies to every v1 handler, where only
  `objects/[id]/analyze` set it. Next documents it as a limit deployment
  platforms read from the build output (`maxDuration.md` in Next's docs), and
  only Next's build code reads it, never its request-time server.
- **`dynamic = 'force-dynamic'`** now applies to every v1 handler, where only
  `live` set it. Every v1 handler was already dynamic (`ƒ` in the build
  output), so nothing that was cached stops being cached.
- **All 114 handlers load together.** The route table imports every handler
  module, so the first `/api/v1` request after the server starts loads all of
  them, and a handler module that throws while it loads fails every
  `/api/v1` request, not only its own path. Before, each handler was its own
  route with its own module. How long that first request takes, and how much
  server memory the loaded handlers use, weren't measured.
- **A percent-encoded folder name matches.** The catch-all gets its path
  segments already decoded, so `/api/v1/%61gents` reaches the `agents`
  handler. Next's own route matcher, run on the same path, doesn't match it
  to `agents`.

## Undoing it

Reverting the commits of PR #1601 undoes all of it. By hand:

1. Move `_routes/*` back up into `api/v1/` and delete `[...path]/`.
2. Put `dynamic = 'force-dynamic'` back on `live/route.ts` and
   `maxDuration = 120` on `objects/[id]/analyze/route.ts`.
3. Point `V1_ROUTES_DIRECTORY` in `src/scripts/generate-openapi.ts` back at
   `api/v1`. Delete `src/scripts/generate-v1-route-table.ts`, its test, and
   the `v1-routes:generate` scripts in the root `package.json` and
   `packages/core/package.json`. The `_` folder skip in `routeEntries`
   (`src/scripts/check-route-graph.ts`) and the `**/*.generated.ts` ignore in
   the root `eslint.config.mjs` can stay or go; nothing else depends on them.
4. Change every `@/app/api/v1/_routes/` import back to `@/app/api/v1/`. Six
   files outside `api/v1` import `_routes/_shared`:
   `app/api/artifacts/[id]/_serve.ts`, `app/api/chat/attachments/route.ts`,
   `app/api/deliverables/[artifactId]/_shared.ts`,
   `app/api/media/[recordId]/[filename]/route.ts`,
   `app/api/mobile/share/route.ts` and `app/api/mobile/workspaces/route.ts`.
   Some tests import handlers directly too.
5. Search the repo for `api/v1/_routes` and `api/v1/[...path]` and change
   what is left (paths in tests, comments and docs, such as the comment in
   `src/proxy.ts` and the `api/v1/README.md` pointer in `AGENTS.md`). Delete
   this README.

Expect the build's peak memory to go back up by about 1.8 to 1.9 GiB with CI
settings and about 3.5 GiB with the image's defaults.

## Other ways to lower build memory

What else was looked at during #1598, so a next attempt can start here.
Anything marked as an estimate or unknown hasn't been measured.

Tried, with no clear saving:

- **Turbopack settings**: input source maps, scope hoisting and minify off
  (see "Why" above). `turbopackGc` is still untested with the build cache on.
- **React Compiler off** peaked at 8,774 MiB, and **a 3 GB V8 heap cap** at
  9,228 MiB, against 8,931 and 9,140 MiB with neither (Next 16.4.6, before
  this change, CI settings, one build each,
  [45857991270](https://github.com/vocion/vocion-core/actions/runs/45857991270)).
- **Cutting `_shared.ts`'s imports** raised peak memory by 1 GB on
  2026-10-09. Turbopack shares chunks between routes that reach the whole
  server, and a route left with only part of it gets its own
  (`src/scripts/check-route-graph.ts`, header comment).
- **`await import()`** doesn't take a module out of a route: Turbopack
  compiles its target into the route too (same header comment).
- Server source maps and the type check are already off in the image
  (`NEXT_PUBLIC_SENTRY_DISABLED=1` and `VOCION_TYPES_CHECKED=1` in
  `packages/core/Dockerfile`).

Not tried yet:

- **More catch-alls.** 22 API routes outside `/api/v1`, and 10 routes under
  `[locale]/rpc/` besides `rpc/[[...rest]]`, each reach 1,300 or more modules,
  close to the whole server (counted with `reachOf`). Serving them through
  catch-alls like this one is an estimated 0.5 GiB: 32 routes at this
  change's saving of about 17 MiB per route, and Turbopack's chunk sharing can
  make it less. Webhooks that read the raw body and streaming routes need
  care.
- **Fewer page entries.** Deleting every page (`src/app/[locale]`) took the
  peak from 8,931 and 9,140 to 5,747 MiB (same run as above), so pages are
  the larger share. Serving groups of dashboard pages through catch-alls, as
  `dashboard/automations/[[...path]]` already does, could cut part of that.
  How much is unknown, and those pages would share one entry's code
  splitting, loading and error boundaries.
- **Not bundling heavy server packages**, such as the LangChain packages,
  `openai` and `@anthropic-ai/sdk`, by adding them to `serverExternalPackages`
  in `next.config.ts`. The saving is unknown, and each one must still load at
  runtime from the standalone output.
- **`turbopackGc` with the build cache on**, for the image's default build.
  The saving is unknown.

Not supported, or not worth it now:

- **Building only some routes.** `next build --debug-build-paths` builds a
  subset, but Next documents it for debugging (`next.md` in
  `next/dist/docs`), and separate builds can't be merged into one app.
- **Separate apps under one domain**
  ([multi-zones](https://nextjs.org/docs/app/guides/multi-zones)). Each app
  builds on its own, but it needs routing in front of the apps, moving
  between apps is a full page load, and an app whose routes reach the shared
  server code still compiles all of it.
- **Seeding Turbopack's build cache for a first build.** A warm cache compiled
  at about 3.3 GB against 6.6 GB cold (#670), but restoring it on a fresh
  2-CPU runner compiled slower, 11.3 min against 4.5 (`next.config.ts`). Docker
  also doesn't export `type=cache` mounts with `--cache-to`
  ([moby/buildkit#1512](https://github.com/moby/buildkit/issues/1512)).
- **Removing unused code.** Files nothing imports cost the build nothing. A
  search during #1598 found no imported page or route that is provably
  unused.

What already works on a machine too small to build: build the image once
where there's enough memory and pull it ("Pull a CI-built image" in
`infra/aws/README.md`).
