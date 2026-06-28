# Propagate to the app (dashboard UX)

A capability users can't see in the app doesn't feel shipped. Confirm the change surfaces in
`vocion-core/packages/core/src`.

## Catalog surfaces (under the "Capabilities" sidebar section)

| Primitive | Route | Page |
|---|---|---|
| Built-in tools | `/dashboard/tools` | `app/[locale]/(auth)/dashboard/tools/page.tsx` (reads `libs/tools/catalog.ts`) |
| Operations (skills) | `/dashboard/skills` | `dashboard/skills/page.tsx` (reads DB `skillSchema` via `listSkills`) |
| Sources | `/dashboard/sources` | … |
| Workflows / Agents | `/dashboard/{workflows,agents}` | … |

## Adding a tool to the catalog

1. Register it in `libs/tools/catalog.ts` (`BUILTIN_TOOLS` + a status in `capabilityStatuses()`).
2. The `/dashboard/tools` page renders it automatically (name, provider, key status).

## Sidebar

`features/dashboard/AppSidebar.tsx` — add nav items under the right section with a lucide icon.
Use a literal `title` string, or add an i18n key to `src/locales/en.json` (and the `t('…')` call)
to keep `npm run check:i18n` green.

## Verify

- `npm run check:types` and `npm run lint` clean.
- If you touched i18n, `npm run check:i18n`.
- Load the route locally (`npm run dev:next`, then `/dashboard/<route>`) when in doubt.
