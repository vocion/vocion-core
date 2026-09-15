# Routing — the workspace in the URL

**Status:** phase 1 shipped (`/w/<slug>/…` entry route); phase 2 is a design, not a
plan of record until its first PR is opened.

## Why

The daily team report for *Vocion Workforce* linked to
`https://agents.metacto.com/dashboard/inbox`. Opening it showed *Revenue Team*,
because every dashboard URL is `/dashboard/...` and the workspace is session state:
`auth()` resolves `projectId` from the `vocion_active_project` cookie on every read
(`packages/core/src/libs/Auth.ts`, `resolveTenancyForUser`). A URL that means a
different thing for each reader fails [MANIFESTO §11](./MANIFESTO.md#11-make-the-important-things-obvious):
*where am I* must be obvious, and a link must open what it is about.

The target is Vercel's model — `vercel.com/{team}/{project}/analytics` — where the
account and the workspace are path segments and the page is the same for everyone
who holds the link.

## Phase 1 — what is live

- **Entry route** `packages/core/src/app/[locale]/(auth)/w/[workspace]/[[...path]]/route.ts`.
  `/w/<slug>/<path>` resolves `<slug>` case-insensitively within the signed-in
  user's account (`services/ProjectService.ts`, `resolveProjectForUser`), sets
  `vocion_active_project` with the same name/path/lifetime the switcher uses
  (`libs/activeProject.ts`), and **302s** to `/<path>` with the query string kept.
  No path → `/dashboard`; a bare page name (`/w/x/inbox`) → `/dashboard/inbox`; a
  registered surface segment (`/w/x/gtm/discovery`) stands on its own. Unknown slug
  and non-member both 404 — indistinguishable on purpose.
- **Protected** in the auth proxy (`src/proxy.ts`, `PROTECTED_SEGMENTS`) so an unsigned
  reader gets sign-in with a `callbackUrl` that round-trips the `/w/…` URL.
- **One helper** `libs/links.ts` — `workspaceUrl(slug, path, { absolute })` — builds
  every outbound link: the daily team report (`services/reports/dailyTeamReport.ts`),
  and `ask.url` on every `/api/v1/asks` response (`app/api/v1/asks/_lib.ts`).
- **Switcher** (`features/dashboard/WorkspaceMenu.tsx`) navigates through
  `/w/<slug>/<current page>` instead of writing the cookie itself — one mechanism.
  The top bar shows the active slug as a chip linking to `/w/<slug>`
  (`features/dashboard/AppSidebarHeader.tsx`).

What phase 1 does **not** do: the address bar still ends at `/dashboard/…` after the
redirect, so a copied URL from the bar is still ambiguous. That is phase 2.

## Phase 2 — `/{account}/{workspace}/…` as the canonical URL

### Route tree

Move `app/[locale]/(auth)/dashboard/*` and `app/[locale]/(auth)/gtm/*` to
`app/[locale]/(auth)/[account]/[workspace]/*`, so `/metacto/vocion-workforce/inbox`
renders what `/dashboard/inbox` renders today. `AppShell` moves with it. Nothing
under `app/api/*`, `app/[locale]/rpc/*`, or `/api/mcp` moves: MCP and the v1 API are
token-scoped to a project already and never see these URLs.

### Deriving `orgId` from the URL

Today `auth()` → `session.user.projectId` comes from a cookie. Phase 2 makes the URL
authoritative:

1. **Per-request resolver.** Middleware (`src/proxy.ts`) parses
   `/{locale}?/{account}/{workspace}/…`, looks the pair up (one indexed query on
   `project_account_slug_idx`, `models/Schema.ts`), checks membership, and forwards
   the result to the app as request headers (`x-vocion-account-id`,
   `x-vocion-project-id`). Unknown pair or non-member → 404 before any page code runs.
2. **Compatibility shim.** `resolveTenancyForUser` in `libs/Auth.ts` reads those
   headers first, the cookie second, first-project last. `auth().user.projectId`,
   `clerkAuth().orgId`, `guardAuth().orgId` (`routers/AuthGuards.ts`) keep working
   unchanged — the ~130 services that take `orgId` never learn the URL changed.
3. **Cookie demoted to "last active".** Visiting `/{account}/{workspace}/…` still
   writes `vocion_active_project` so bare `/dashboard/*` and `/w/*` can redirect to
   the last workspace. It no longer decides what a page shows.

### Reserved top-level segments

`api`, `rpc`, `webhook`, `sign-in`, `sign-up`, `setup`, `invite`, `onboarding`, `w`,
`dashboard`, `gtm` (and every id in `features/navigation/surfaces.ts`
`SURFACE_PATH_SEGMENTS`), `docs`, `_next`, `monitoring`, plus every locale id in
`utils/AppConfig.ts`. One exported list, `RESERVED_SEGMENTS` in `libs/links.ts`, used
by the router, the middleware and the slug validator, so a new surface cannot
silently shadow an account.

### Legacy redirects

- `/dashboard/*` → 301 to `/{account}/{workspace}/*` for the last-active workspace
  (cookie), else the user's first project. Kept for one release cycle, then removed.
- `/w/<slug>/*` stays permanently as the short, account-less form for mail and chat;
  it 302s to the canonical URL. Every link builder switches to canonical via
  `workspaceUrl` — one edit.
- Emails, Slack replies and `ask.url` emit the canonical form once the tree moves.

### Single-account deployments

Self-hosted core has one `tenant_account`. When the deployment has exactly one,
`/{account}` collapses: `/vocion-workforce/inbox` is canonical and `/{account}/…`
301s to it. Decided per request from a cached count; a second account flips the
deployment to the long form without a config change.

### Slug rules

Lowercase `[a-z0-9-]{2,40}`, no leading/trailing hyphen, not in `RESERVED_SEGMENTS`,
unique per account (already `project_account_slug_idx`). Renames insert a
`project_slug_redirect(account_id, old_slug, project_id, created_at)` row; the
resolver consults it and 301s to the current slug. Account slugs get the same table
shape. `workspace.yaml` `slug:` is validated on `workspace:check`.

### Migration — three PRs

| PR | Scope | Risk notes |
|---|---|---|
| **A. Resolver + shim** | Middleware parses the pair into headers; `resolveTenancyForUser` reads headers → cookie → default; `RESERVED_SEGMENTS`; slug validator; redirect table + migration. No route moves. | Middleware order: the pair lookup needs the DB, and the demo sandbox (`VOCION_DEMO_SEED_DIR`) cannot load PGlite in the edge bundle — gate it the same way `hasSession` is gated. `next-intl` must run **after** the pair is parsed or `/fr/metacto/x` is read as account `fr`. |
| **B. Route move** | `git mv` `dashboard/*` → `[account]/[workspace]/*`; `AppShell` reads the pair from params; in-app `href`s (`InboxService`, `ActivityService`, sidebar, `workspace/pages.ts`) go through a `pageUrl()` that prefixes the pair; `/dashboard/*` legacy redirect. | Largest diff, lowest logic risk. `Link` from `libs/I18nNavigation.ts` keeps locale handling. Watch `usePathname()` consumers that match on `/dashboard`. |
| **C. Canonical links + collapse** | `workspaceUrl` emits canonical URLs; `/w/*` becomes a 302 to canonical; single-account collapse; docs. | Only after A and B have been in production for a week: mail already sent keeps working through `/w/*`. |

MCP (`app/api/mcp`) and the v1 API are unaffected throughout: they authenticate by
token and scope by `orgId` from the token, never from a path.
