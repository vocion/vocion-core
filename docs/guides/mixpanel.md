# Mixpanel

A workspace connects one Mixpanel project and its agents read it live:
which events the project tracks, how often they happened, a saved funnel's
conversion, and the saved cohorts. Nothing is synced or copied into Vocion —
no person, property or event payload — and nothing is written to Mixpanel.

## What agents can do

The four tools of the analytics family (the same four on Amplitude), present
for an agent whose sources include a Mixpanel source:

| Tool | Reads |
|---|---|
| `analytics_events` | The project's top event names of the last 31 days (names only: the endpoint carries no volume). |
| `analytics_event_counts` | Counts per day, week or month for up to 10 named events, as total occurrences or unique people. Weekly totals are the days summed; Mixpanel counts unique people per day or per month only, so weekly uniques are refused with that sentence. |
| `analytics_funnel` | A **saved** funnel, by id: people per step, step-to-step and overall conversion (computed by Vocion from the step counts). Mixpanel's API builds no funnel from steps, so a call with steps answers with the saved funnels to pick from. |
| `analytics_cohorts` | Saved cohorts: name, description, size. Never the people in them. |

**Actions:** none. The connector is read-only.

## Connecting it

1. **Credential** (`mixpanel` platform): a service account — Organization
   settings → Service accounts → Add, with the **Consumer** role on the
   project (least privilege: it can read reports, not change the project).
   Paste its username and secret; the secret is stored AES-256-GCM encrypted
   and never shown again.
2. **Source settings:** the **project id** (the number after `/project/` in
   the project's URL) and the **data residency** — US (`mixpanel.com`), EU
   (`eu.mixpanel.com`) or India (`in.mixpanel.com`).
3. **Test connection** reads the project's top event names once, proving the
   service account, project and region together, and says which it reached.

No OAuth app is needed.

## Limits

Mixpanel's Query API allows 60 queries an hour and 5 at once per project.
Every count is one query per event, so ask for the events that matter. A 429
that says how long to wait (up to 10 seconds) is waited out once; otherwise
the agent is told the quota is spent.
