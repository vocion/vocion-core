# First-run workspace onboarding

The first time an admin opens a workspace that has a lead agent, the lead opens
a setup conversation. It asks what the workspace is for, offers one-tap cards to
connect the right tools, and hands off to the enabled plugins' teams.

## What opens setup

- The first admin visit to the chat page, once per workspace. The chat client
  POSTs `onboarding.start` on mount; the server claims the start atomically, so
  two admins arriving together get one conversation. A member never opens it, and
  a workspace with no lead is skipped.
- The "onboard this workspace" door in chat, for a workspace that wants it again.

A visit that is already going somewhere (`?conversation=`, `?new=1`, `?prompt=`,
or a connect return) never auto-opens setup.

## The three steps

`workspace_setup` returns where setup stands and the one next step:

1. **Describe** the workspace (the reversible `workspace.describe` action).
2. **Connect** the tools it uses (an `offer_connection` card per tool).
3. **Grow**: enable plugins and hand off to their teams.

"Done" is computed from rows: a description plus at least one connected source.
There is no stored flag to drift.

## Connecting from chat

A connect card links to `/dashboard/connectors?add=<connector>&returnTo=<chat path>`.
Sources opens that connector's dialog and carries `returnTo` through the vendor
flow (`/api/connect/<provider>/start?source=…&returnTo=…`). `returnTo` must pass
`safeReturnPath`: only in-app `/dashboard` paths, otherwise the person lands on
Sources. Back in the conversation the composer is pre-filled ("I connected
github. What's next?"), or names the failure honestly if the connect was cancelled
or refused. Pressing Send continues setup; there is no `source.connected` event in v1.

## Measuring time to first connected source

`project.onboarding_started_at` against the earliest `knowledge_source.created_at`
for the same project:

```sql
SELECT p.id, min(ks.created_at) - p.onboarding_started_at AS time_to_first_source
FROM project p
JOIN knowledge_source ks ON ks.project_id = p.id
WHERE p.onboarding_started_at IS NOT NULL
GROUP BY p.id, p.onboarding_started_at;
```

## Deviations from the issue

- The skill became a tool (`workspace_setup`), because a core skill cannot reach every lead.
- The card deep-links into the existing Sources flow rather than creating the row itself; a source's config must be valid before its row exists.
- No `source.connected` event in v1.
- Two columns only: `onboarding_started_at` and `onboarding_started_by`.
- Auto-open is a POST from the mounted client, so a link prefetch cannot trigger it.
- The OAuth round trip is unit-tested, not e2e-stubbed.
