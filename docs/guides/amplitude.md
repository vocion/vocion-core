# Amplitude

A workspace connects one Amplitude project and its agents read it live:
which events the project tracks, how often they happened, the conversion
through any steps, and the saved cohorts. Nothing is synced or copied into
Vocion — no person, property or event payload — and nothing is written to
Amplitude.

## What agents can do

The four tools of the analytics family (the same four on Mixpanel), present
for an agent whose sources include an Amplitude source:

| Tool | Reads |
|---|---|
| `analytics_events` | The project's visible events, busiest first, with this week's totals. |
| `analytics_event_counts` | Counts per day, week or month for up to 10 named events, as totals or unique people per interval (Event Segmentation). |
| `analytics_funnel` | A funnel built from any steps, in order, within the conversion window you give (default 7 days): people per step, step-to-step and overall conversion, computed by Vocion from the step counts. There are no saved funnels to read by id. |
| `analytics_cohorts` | Behavioral cohorts that are neither archived nor hidden: name, description, size, last computed. Never the people in them. |

**Actions:** none. The connector is read-only.

## Connecting it

1. **Credential** (`amplitude` platform): the project's **API key** and
   **secret key**, from Settings → Projects → your project → General. The API
   key also ships in your tracking code, so it is shown in full; the secret
   key is stored AES-256-GCM encrypted and never shown again. Vocion only
   calls the Dashboard REST and Behavioral Cohorts APIs with them, never the
   ingestion API.
2. **Source settings:** the **data residency** — US (`amplitude.com`) or EU
   (`analytics.eu.amplitude.com`).
3. **Test connection** reads the project's event list once and says what it
   tracks.

No OAuth app is needed.

## Limits

Amplitude limits each project's concurrent queries and hourly query cost.
Every count is one query per event. A 429 that says how long to wait (up to
10 seconds) is waited out once; otherwise the agent is told the limit is
spent.
