# Meridian Outdoor — Revenue (bundled sample workspace)

The sample workspace behind the **"Load the sample revenue workspace"**
button on `/dashboard/teams` (`teams.seedSample`). Everything here is
realistic-but-fictional flavor for Meridian Outdoor Supply, a mid-market
outdoor-equipment B2B: pipeline numbers, deals, and MQL trends live ONLY
in agent descriptions and prompts — no structured KPI data (that's F3).

## Shape

- Workspace lead: `revenue-director` (`lead:` in workspace.yaml).
- Four teams, flat: RevOps (indigo), Deal Desk (teal), Founder GTM
  (violet), Marketing (rose). Each has a lead + specialists.
- Accountability: `workspace.yaml` deliberately omits `accountableUser` —
  `teams.seedSample` injects the seeding admin's email at apply time, so
  three teams inherit a real person from YOUR account ("workspace
  default"), while **Marketing** overrides with the bundled sample user
  `lili.chen@meridianoutdoor.example` (created by the seed; display-only,
  cannot sign in).
- Two operations wire the plain-language approval boundary on team detail:
  `pipeline-health-report` (query, runs freely) and
  `draft-follow-up-email` (mutation, waits for approval).

## Applying manually

The seed button is the intended path (admin-only, only when the workspace
has zero teams). To apply by hand:

```bash
npm run workspace:check -- packages/core/templates/workspaces/meridian-revenue
npm run workspace:apply -- packages/core/templates/workspaces/meridian-revenue --project <id|slug>
```

Note: a manual apply resolves no owner (the file omits `accountableUser`)
and won't create the Lili Chen sample user — add `accountableUser:
<email>` and seed the user yourself, or just use the button.

Negative fixtures for tests (lead-less team, team-less workspace) live in
`../fixtures/` — they are test-only and never reachable from the seed
button.
