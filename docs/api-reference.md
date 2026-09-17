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
| methods | the `export async function GET` declarations |
| summary, description | each handler's own doc comment |
| query parameters | the doc comment's `Query parameters:` bullets, plus `readPagination` |
| request body | whether the handler calls `readJsonBody`, and the field names it reads |
| statuses and error codes | the handler's `jsonError(...)` calls, and the shared helpers it uses |
| required capability | the string passed to `requireCapability` |

## Where it lives

| Path | What it is |
|---|---|
| `packages/core/src/libs/openapi/parseRouteModule.ts` | Reads one route file. Pure — takes source text, returns operations. |
| `packages/core/src/libs/openapi/buildDocument.ts` | Assembles the OpenAPI 3.1 document. |
| `packages/core/src/scripts/generate-openapi.ts` | Walks `src/app/api/v1`, writes the document. |
| `packages/core/src/libs/openapi/openapi.generated.json` | The committed document. |
| `packages/core/src/app/api/v1/openapi/route.ts` | Serves it as JSON, behind the usual auth. |
| `packages/core/src/features/api-docs/` | The page that renders it. |
| `packages/core/src/app/[locale]/(auth)/dashboard/api-reference/page.tsx` | The page's route. |

The document is **committed** because production runs a bundle where `src/` does
not exist — the server cannot walk the route tree at request time.

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

## What it does not do yet

Response bodies are described as "a JSON object", with the fields named in the
endpoint's prose. Nothing in the code states a response shape a generator could
read — there are no schemas on these routes — so publishing field-by-field
response schemas would mean writing them by hand, which is the thing this design
set out to avoid. If we want them, the honest route is to declare the shapes in
the handlers (Zod, or an exported type) and read those.
