# Web analytics as a measure source

A team measure can read its number straight out of Google Analytics, so
"qualified traffic this month" on the [Team performance](./team-performance.md)
report carries a **verified** chip instead of an agent's own count. This is the
second `verified` connector, alongside HubSpot.

It is read-only, it runs at report time, and it needs one credential per
workspace and no code.

## What it can measure

```yaml
# teams/<slug>.yaml
measures:
  - key: qualified_traffic
    label: Qualified sessions on the docs
    target: 500
    unit: sessions
    window: 30d
    source:
      kind: verified
      connector: web-analytics
      query:
        metric: sessions
        filter:
          pathPrefix: /docs
          channel: Organic Search
```

| Field | Values | Reads |
|---|---|---|
| `metric` | `sessions` | GA4 `sessions` |
| | `users` | GA4 `totalUsers` — people who reached the site, not the subset GA4 judged engaged |
| | `conversions` | GA4 `keyEvents` |
| | `signups` | GA4 `eventCount` for one named event; `filter.event` is **required** |
| `filter.pathPrefix` | a path, e.g. `/docs` | Sessions whose **landing page** begins with it |
| `filter.channel` | a GA4 default channel group, e.g. `Organic Search` | Exact match on `sessionDefaultChannelGroup` |
| `filter.event` | a GA4 event name, e.g. `sign_up` | Exact match on `eventName` |

Every predicate is ANDed: naming both a path prefix and a channel means "that
traffic, from that channel", never either.

There is deliberately **no pages-per-session or engagement filter.** The GA4
Data API has no session-level engagement predicate, so a `minPagesPerSession`
key could only filter something other than what it claimed to. Express
"qualified" with path, channel and key events instead.

### The window is days, not instants

A measure window is a range of instants; GA4 reports in whole days in the
**property's own timezone**. The reading is therefore over the days the window
covers, and the most recent day is still being processed for up to 48 hours.
Both facts travel with the reading and show in the chip's tooltip. Prefer `30d`
over `24h` for anything you plan to manage against.

## What a workspace has to supply

One credential, at **/dashboard/developers → Google Analytics**. Three values,
all from the same place:

| Field | Where it comes from | Stored |
|---|---|---|
| **GA4 property ID** | GA4 Admin → Property Settings. The numeric id, *not* the `G-XXXXXXX` measurement id — the Data API cannot address that one, and the form refuses it. | in the clear (an identifier, not a secret) |
| **Service account email** | `client_email` in the service-account JSON key file. Ends `.iam.gserviceaccount.com`. | in the clear |
| **Service account private key** | `private_key` in the same JSON file, starting `-----BEGIN PRIVATE KEY-----`. Escaped `\n` newlines are accepted. | encrypted under the workspace's DEK |

The property id lives with the credential and **never** in a team file. A
`teams/<slug>.yaml` says what is being measured; it does not name an account.
That is also why this is workspace configuration rather than a build-time
constant — two workspaces on one deployment measure two different properties.

### Setting the service account up in Google Cloud

1. In the Google Cloud project, **create a service account** and give it no
   project roles at all. It needs nothing in Google Cloud.
2. **Enable the Google Analytics Data API** on that project.
3. Create a **JSON key** for the service account and download it.
4. In **GA4 Admin → Property access management**, add the service account's
   email to the property with the **Viewer** role.

Viewer is the whole grant. It is the lowest GA4 property role that can run a
report, and it cannot change configuration, manage users, or see cost data.
Nothing here needs Editor, Administrator, or any Google Cloud IAM role — the
authorisation that matters is on the **property**, not on the project.

Only the property you grant is readable: the service account can see nothing
else in the Google account.

### A deployment-wide fallback

When a workspace has stored no credential, the read falls back to the server's
environment — the same org-key-first, env-var-second rule every outbound call
follows:

```
GOOGLE_ANALYTICS_PROPERTY_ID
GOOGLE_ANALYTICS_CLIENT_EMAIL
GOOGLE_ANALYTICS_PRIVATE_KEY
```

All three or none: a half-filled set counts as not configured rather than being
tried. On a multi-workspace deployment this is a convenience for a single-tenant
install, not a default — every workspace sharing it measures the same property.

## When it is not connected

**A measure with no analytics credential reads "not connected" and shows
nothing. It never shows 0.**

That is the point of the whole provenance model, and it is enforced in the
read: no credential returns an *unconfigured* state, a failed request returns
an *error* state, and only a report GA4 actually ran can produce a number —
including a zero, when GA4 says nothing matched.

| What happened | Report shows |
|---|---|
| No credential stored, no env vars | **—** · `Google Analytics · not connected` |
| Service account not granted Viewer on the property (403) | **—** · `Google Analytics · read failed`, with the role to grant |
| Property id does not exist (404) | **—** · `Google Analytics · read failed` |
| Key rotated or disabled (401) | **—** · `Google Analytics · read failed` |
| GA4 ran the report and nothing matched | **0** · `Verified · Google Analytics` |

A measure in any of the "—" states is excluded from "teams on target" and from
workspace goal progress rather than counted as a miss.

## Signups, and what stays weaker

Site-side signups are a GA4 event; app-side signups are Vocion's own rows. The
second is stronger evidence and does not need this connector at all:

```yaml
- key: signups
  label: Signups
  target: 20
  window: 30d
  source: {kind: observed, rows: workspace-members}
```

That counts `account_membership` rows created in the window for the account
that owns the workspace — people who actually joined, as recorded by the
system that let them in. It is `observed` rather than `verified` because the
system of record is Vocion itself.

## Where it lives

- `libs/platforms/registry.ts` — the `google-analytics` platform descriptor.
- `libs/analytics/credentials.ts` — which property, as whom: the org's stored
  credential first, the deployment's env vars second, null (→ *not connected*)
  otherwise.
- `libs/analytics/ga4.ts` — the Data API read. Signs a service-account JWT,
  mints an access token (cached against the exact key that minted it, never
  against an org), and runs one dimensionless `runReport`.
- `services/team-report/provenance.ts` — turns all of that into a reading with
  a provenance kind, or into a state.
