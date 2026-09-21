# Routing: the workspace lives in the URL

A URL that means a different thing for each reader — or for the same reader in
a second tab — is not a URL. This is the shape that fixes that, and the one
place to read before changing a link, a redirect or the proxy.

## The canonical URL

```
/{locale}?/w/{workspace}/{page…}
```

`/w/metacto-revenue/dashboard/objects/88201` is what the address bar shows,
what a copy-paste produces, and what decides which workspace the page is
about. Everything else is a spelling of it:

| You ask for | You get |
|---|---|
| `/w/metacto-revenue/dashboard/inbox` | that page, rendered; the URL is unchanged |
| `/dashboard/inbox` | `307` → `/w/<last active>/dashboard/inbox` |
| `/w/metacto-revenue/inbox` | that page — a bare page name is a dashboard page |
| `/w/metacto-revenue/gtm/discovery` | that page — a registered surface stands on its own |
| `/w/metacto-revenue` | `/w/metacto-revenue/dashboard` |
| `/w/not-yours/dashboard` | `404`, whether the slug is unknown or on another account |
| `/fr/w/metacto-revenue/inbox` | the same, in French |

## How it works

1. **The proxy** (`src/proxy.ts`) parses the path. A canonical URL is
   **rewritten** — not redirected — to `/{locale}/{page}`, which is what the
   route tree under `app/[locale]/` holds. Rewriting is the whole point: the
   address bar keeps the workspace, so a refresh, a second tab and a mailed
   link all resolve the same one.
2. The proxy resolves the slug **within the signed-in user's account** and
   sets the resolved project on the rewritten request as
   `x-vocion-project-id` (`WORKSPACE_HEADER`), plus the slug for the layout.
3. **Tenancy** (`resolveTenancyForUser`, `libs/Auth.ts`) reads that header
   first, the `vocion_active_project` cookie second, and the account's first
   project last. Each candidate is accepted only when the project belongs to
   this user's account — so a forged header buys nothing that an edited cookie
   did not already buy.
4. **The layout** (`app/[locale]/(auth)/layout.tsx`) reads the slug header and
   publishes it to the client (`libs/workspaceSlug.ts`).
5. **Links** go through `libs/I18nNavigation.ts`, which prefixes every `Link`
   href and every `router.push` with the active slug, and gives `usePathname()`
   back as the **app path**. So a click keeps the workspace without a redirect
   round-trip, and SSR and hydration agree on every href.
6. A bare `/dashboard/…` — a bookmark, a legacy link, a `push` that skipped the
   wrapper — is redirected to its canonical spelling, so there is one URL per
   page per workspace.

## The rules

- **`libs/links.ts` is the only place the shape is written down.** Build links
  with `workspaceUrl()`, read them with `parseWorkspacePath()`, strip them with
  `stripWorkspacePrefix()`. Never hand-assemble `/w/…`.
- **Read the pathname from `@/libs/I18nNavigation`, never from
  `next/navigation`.** The browser sees `/w/<slug>/dashboard/x`, the server
  sees the rewritten `/en/dashboard/x`; only the wrapper returns the same value
  for both. A direct `next/navigation` read is a hydration mismatch waiting to
  be shipped.
- **A project slug is a path segment.** `projectSlugProblem()` is the rule:
  lowercase, 2–40 of `a–z 0–9 -`, and never a `RESERVED_SEGMENT` — the routes,
  the surface segments (from the registry) and the locales (from the routing
  config), so registering a surface cannot silently make an existing slug
  ambiguous.
- **The cookie is "last active", nothing more.** It decides where a bare URL is
  sent and which workspace a fresh sign-in lands in. It never overrides a URL.
- **Pages that do not belong to a workspace are left alone**: `/rpc` (the oRPC
  transport), `/onboarding` (which runs before a workspace exists), `/api-docs`
  (account-wide), `/api/*` (owns its own routing). `isWorkspacePath()` is that
  rule, read by both the proxy and the link wrapper.

## What this fixed

Switch workspace in one tab, refresh a record URL in another, and the id
resolved against the newly-active project, which does not hold it: a 404 on a
page you were just reading. The URL now carries the workspace, so it cannot
happen — and the two tabs stay right independently.

Design principles: 8 ("where am I" must be obvious), 10 (a claim you can reach
in one move), 6 (one shape, used everywhere).

## The fallback

`app/[locale]/(auth)/w/[workspace]/[[...path]]/route.ts` still exists. It runs
only where the proxy cannot resolve a workspace — the demo sandbox, where
PGlite cannot run in the middleware bundle — and does the older, weaker thing:
set the cookie and 302 to the bare page. Keep it.
