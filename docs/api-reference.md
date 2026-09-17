# The API reference — generated from the handlers

**Status:** shipped (#396).

## Why it is generated

`/api/v1` gains endpoints most weeks. A spec written by hand beside them is
accurate right up until the first person adds a route and forgets to update it,
and after that it is worse than nothing: a client integrates against a contract
the server never agreed to.

So the document is read out of the code. Nothing here is a list to maintain.

| In the document | Read from |
|---|---|
| path, path parameters | where the route file sits on disk |
| methods | the exported handlers, written either way — `export async function GET` or `export const GET = …` |
| summary, description | each handler's own doc comment |
| query parameters | every `searchParams.get('…')` the handler makes, described by the doc comment's `Query parameters:` bullets, plus `readPagination`. A name the handler guards with `if (!name)` publishes as required |
| response media type | `NextResponse.json` (JSON), `NextResponse.redirect` (no body) and the `content-type` header on a `new Response(…)` |
| request body | whether the handler calls `readJsonBody`, and the field names it reads. A handler that checks `content-length` or defaults the body with `?? {}` publishes an optional body |
| statuses and error codes | the handler's `jsonError(...)` calls, and the shared helpers it uses |
| required capability | the string passed to `requireCapability` |

## Where it lives

| Path | What it is |
|---|---|
| `packages/core/src/libs/openapi/parseRouteModule.ts` | Reads one route file. Pure — takes source text, returns operations. |
| `packages/core/src/libs/openapi/buildDocument.ts` | Assembles the OpenAPI 3.0.3 document. |
| `packages/core/src/scripts/generate-openapi.ts` | Walks `src/app/api/v1`, writes the document. |
| `packages/core/src/libs/openapi/openapi.generated.json` | The committed document. |
| `packages/core/src/app/api/v1/openapi/route.ts` | Serves it as JSON, behind the usual auth. |
| `packages/core/src/features/api-docs/ApiReference.tsx` | Swagger UI, loaded in the browser only. |
| `packages/core/src/app/[locale]/(auth)/api-docs/page.tsx` | The page's route, `/api-docs`. |

The document is **committed** because production runs a bundle where `src/` does
not exist — the server cannot walk the route tree at request time.

## The page

`/api-docs` is Swagger UI (`swagger-ui-react`), on a page of its own rather than
inside the dashboard shell: this is the tab an integrator keeps open beside
their editor, and the sidebar and breadcrumb are noise there. Signing in is
still required — `api-docs` is in the proxy's protected segments — and the page
links back to Developers.

Swagger UI renders in the browser only (`ssr: false`); it reads `window` as it
mounts, and fetches the document from `/api/v1/openapi` with the reader's own
cookie rather than being handed it — the document is around 200 KB, and passing
it into a client component would ship every byte twice.

**"Try it out" is limited to GET.** The document's server is `/`, so an Execute
runs against this very deployment carrying the reader's session and acting as
them: a POST or DELETE fired from a page someone opened to read would be a real
write against real records. A GET is safe to fire by accident, so that is all
the page will send; a tenant token goes in the Authorize button, and anything
that writes is called from the reader's own client.

## Why 3.0.3 and not 3.1

Swagger UI resolves a 3.1 document through `@swagger-api/apidom-ns-openapi-3-1`,
and that package does not survive this app's bundler: expanding any operation
throws `OpenApi3_1Element.refract is not a function` in the console and leaves
the operation body spinning forever, with nothing on screen to say why. A 3.0.3
document goes down Swagger UI's own resolver and renders. Nothing in this API
needs 3.1 — no webhooks, no JSON Schema dialect, no type unions — so the whole
cost is a version string. The e2e spec expands an operation and asserts the
Responses table appears, so a future move back to 3.1 fails there rather than in
a reader's browser.

## Regenerating

```bash
npm run openapi:generate
```

`src/scripts/generate-openapi.test.ts` regenerates it during the unit suite and
fails when the committed copy has fallen behind, so a new endpoint cannot ship
undocumented. Add a route, run the command, commit the JSON with it.

## Documenting an endpoint well

The generator can only publish what the handler says. A route with no doc
comment still appears — with `GET /api/v1/thing` as its summary, which tells a
reader nothing. Write the comment the way the existing routes do:

```ts
/**
 * GET /api/v1/reviews
 *
 * The unified pending-review queue — paused workflow runs, missions awaiting
 * review, and pending action proposals — for the caller's org.
 *
 * Query parameters:
 * - `kind` — `workflow` | `mission` | `action`, to see one plane only.
 * - `limit`, `offset` — the page window. The response carries the real total.
 * @param req - Request.
 */
```

What each part becomes:

- **First line** — dropped. The document already knows the method and the path.
- **First sentence after it** — the summary, the line shown in the endpoint list.
- **The rest** — the description, rendered as Markdown when the endpoint is opened.
- **`Query parameters:` bullets** — one parameter each, described. A bullet may
  name two (`` `limit`, `offset` ``), and an indented continuation line belongs
  to the bullet above it.

## What the generator cannot know

Some handlers hand a thrown service error to a shared mapper
(`writeApiErrorResponse`, `workerRunErrorResponse`), which reads the status off
the error itself. No reading of the handler can predict those, so the document
says so on the endpoint — "can answer with statuses beyond the ones listed" —
rather than publishing a list that looks complete and is not.

## What it does not do yet

Response bodies are described as "a JSON object", with the fields named in the
endpoint's prose. Nothing in the code states a response shape a generator could
read — there are no schemas on these routes — so publishing field-by-field
response schemas would mean writing them by hand, which is the thing this design
set out to avoid. If we want them, the honest route is to declare the shapes in
the handlers (Zod, or an exported type) and read those.
