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
(1,324, counted with `reachOf` in `src/scripts/check-route-graph.ts`). Building the 114 handlers as one route entry
instead of 114 cut the build's peak memory by about 2 to 3.5 GB, measured on
cold image builds of v8.48.0 (Next 16.4.6) on a GitHub runner (#1598):

| Build | 114 v1 route entries (before) | One v1 route entry (this) |
|---|---|---|
| CI settings, no build cache written | 8,937 MB | 6,987 MB and 7,081 MB |
| Image default, build cache written | 12,801 MB | 9,241 MB |

Each figure is the build's anonymous memory plus swap above the idle runner,
sampled every second.

Turning Turbopack's scope hoisting, minify or input source maps off, or its
GC on, didn't move the peak beyond run-to-run noise (#1598).

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

## Undoing it

Move `_routes/*` back up into `api/v1/`, delete `[...path]/`, put
`dynamic = 'force-dynamic'` back on `live/route.ts` and `maxDuration = 120` on
`objects/[id]/analyze/route.ts`, and point `V1_ROUTES_DIRECTORY` in
`src/scripts/generate-openapi.ts` back at `api/v1`. Expect the build's peak
memory to go back up by about 2 GB.
