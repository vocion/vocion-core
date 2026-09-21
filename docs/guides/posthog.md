# PostHog as a knowledge source

A workspace connects one PostHog project and, once a day, Vocion writes one
document per day into knowledge: how many times each event happened, how many
people did it, the day's totals, and the day's error counts. An agent reads
those days with the same tools it reads everything else — `search_knowledge`
for "what happened around the launch", `posthog_event_counts` for "events for
product send, last 7 days" as numbers — and a team measure can point at the
document its figure came from.

It is read-only, it stores aggregates and nothing else, and it needs one
credential per workspace and no code.

## What gets stored, and what never does

One `knowledge_document` per day per source, titled
`PostHog · <project name> · 2026-09-19`, whose body is:

```
PostHog · Send · 2026-09-19

Project 4242 · product = send · days in the project's timezone · aggregates only — no people, no event properties, no content

| Event | Count | Unique users |
|---|---:|---:|
| Document Sent | 120 | 45 |
| Link Opened | 300 | 210 |
| Document Signed | 0 | 0 |

Totals for the day: 1204 events · 260 active users.
Errors: 3 $exception events · 2 users affected · 2 issues active (3 occurrences, error tracking API).
```

The same numbers ride in the document's metadata — `kind: analytics-daily`,
`product`, `date`, `events.<name>.{count,uniques}`, `totalEvents`,
`activeUsers`, `exceptions`, `errorIssues` — so the count tool sums them
without parsing prose.

**Never stored:** distinct ids, person properties, event properties, session
recordings, URLs visited, exception messages or stack traces, issue names. Every
query the connector runs is a `GROUP BY` over counts; the error line is a count
of `$exception` events and of issues, never their text. A person cannot be
reconstructed from what this connector writes, because no person was ever read.

Unique users are **per day**. Someone active on three days is three in a
seven-day sum, and the count tool names its field `unique_user_days` for that
reason. Deduplicating people across days would need their ids, which is exactly
what is not kept.

## Connecting it

1. **Add the source** at `/dashboard/connectors` → PostHog. Settings:

   | Setting | Default | What it does |
   |---|---|---|
   | Name in document titles | the product, then the project id | `PostHog · Send · …` |
   | Events to count | every event the project defines (up to 50, PostHog's own `$` events left out, `$pageview` kept) | The table's rows. Pin a list to choose. |
   | Product | whole project | Only count events whose `product` property equals this. One product line into one project is the usual shape; a second source over the same project with a different product shares the credential. |
   | Re-read the last (days) | 7 | Recent days keep changing as late events arrive, so every sync rewrites them. |
   | Keep (days) | 90 | How far back a **full** sync reads. Days older than this are retired from search. |
   | Count error-tracking issues per day | on | Counts only. Skipped, and said so in each day's document, on a PostHog that does not expose the API. |

2. **Connect the credential.** Three values, kept together because the key is
   only ever spent against that host and project:

   | Field | Where to find it | Shown |
   |---|---|---|
   | PostHog host | `https://us.posthog.com`, `https://eu.posthog.com`, or your own install's origin | in full |
   | Project ID | Settings → Project — the number after `/project/` in the URL | in full |
   | Personal API key | Settings → **Personal API keys** → create one, starting `phx_` | masked |

   The personal API key is **private to whoever created it** and is used
   **read-only** here: scope it to `query:read` and `event_definition:read` on
   this project and nothing more. It is stored AES-256-GCM encrypted under the
   workspace's key (KMS-backed on a deployed install), never written to the
   workspace YAML, and never shown again.

   The **public project token (`phc_…`)** that ships inside your app is *not*
   what goes here. It can only send events and reads nothing; the form refuses
   it at paste time and says why, so the mistake never becomes a source that
   looks connected and syncs nothing.

3. **Test connection** before saving. It runs four read-only checks and stores
   nothing: the key reads the project (with its name and timezone), the events
   to count, one day of counts through the Query API, and whether the error
   tracking API is exposed. A 401 comes back as one failed check with PostHog's
   own message, not a spinner.

4. **Sync.** The first run reads the trailing 90 days (one Query API statement
   per 31-day chunk, two statements per chunk, plus one issue query per day when
   error tracking is on). Then either schedule it in the source manifest or let
   an automation call `freshen_source` before a weekly read.

### In a workspace manifest

```yaml
# sources/posthog-send.yaml
slug: posthog-send
name: PostHog — Send
description: Daily behaviour counts for the Send product.
kind: posthog
config:
  projectName: Send
  product: send
  events:
    - Document Created
    - Document Sent
    - Link Opened
    - Document Signed
    - Plan Upgraded
    - Account Deleted
schedule: '30 6 * * *' # after the day has closed in the project's timezone
enabled: true
```

The event vocabulary belongs to the workspace, not to core: nothing in the
connector knows a product's event names. Leave `events` blank and it counts what
the project defines; list them and the table is exactly those rows, in that
order, zero-filled on quiet days.

The credential is attached after the source exists — on the Connectors page or
through `POST /rpc/sources/{id}/credentials` — and is never part of the manifest.

## Days, windows and the checkpoint

Days are whole days in the **project's own timezone**: the HogQL statements
bind the range as project-local wall-clock times, so the day a document is
titled with is the day PostHog's own dashboards show. The newest day written is
**yesterday**; today is still being counted.

Each run's window is decided from the source's sync checkpoint:

- **Incremental** (the scheduled sync, `freshen_source`): from the day before
  the stored watermark, or the last 7 days, whichever is earlier — so a gap in
  syncing is back-filled and recent days are always re-read — but never
  further back than `Keep (days)`.
- **Full** (Sync now on the Connectors page, the reconcile schedule): the last
  `Keep (days)`. That window *is* the mirror: the tombstone pass retires days
  that fell out of it, which is how the source stays bounded.

Re-syncing a day rewrites the same document — the external id is the day — so a
late-arriving event changes one row rather than adding a duplicate.

## Reading it

- **`search_knowledge`** finds days by relevance, like any other document. Good
  for "what did the week of the launch look like".
- **`posthog_event_counts`** sums the mirror over a trailing window, resolved
  on the server clock: `{ days: 7, events: ['Document Sent'], product: 'send' }`
  → per-event counts and unique-user-days, day totals, the errors line, and —
  deliberately — `days_missing` and `unknown_events`, so a sum over five of
  seven days is reported as such rather than as the week. It is present for any
  agent whose `connectorSources` include a posthog source, narrowed by the
  per-user connection ACL, and it reads the mirror only: two paths to the same
  number would eventually disagree.

Neither tool can name a person, because the mirror does not hold one.

## What it does not do

- **No live queries.** Agents read the daily mirror, never PostHog directly.
  Freshness is `freshen_source`'s job, and the count tool reports `as_of`.
- **No funnels, retention or breakdowns by property** beyond the optional
  `product` filter. Those are questions with many right shapes; the daily
  table is the one shape every reader shares. Ask in PostHog, or add a second
  source with a different `product`.
- **No error details.** Error tracking contributes counts. The issue itself —
  its message, its stack, who hit it — is read in PostHog.
- **One PostHog project per workspace.** The credential names its host and
  project, and a workspace holds one live PostHog credential. Several sources
  may share it — one per `product` filter, each with a slug beginning
  `posthog` so the count tool finds them — but a second *project* is a second
  workspace.
