# Marketing

Paid search, run by an agent and approved by a person.

- **Marketing lead** (`agents/marketing-lead.yaml`) reads the connected Google Ads account, writes the daily update, and proposes every change as a card.
- **Publish the daily marketing update** (`missions/daily-marketing-update.yaml`): run weekday mornings at 6:30 Pacific (`automations/marketing-daily-update.yaml`), summarized on Saturdays (`marketing-weekend-summary.yaml`), and mailed to the accountable person when each check finishes (the mission's `deliver:`).
- **Check ad approvals, budget pacing and first conversions** (`automations/marketing-guard.yaml`): every four hours, three reads and no model; when an ad is limited, spend runs off budget or a young campaign records its first conversion, it raises an event and `marketing-alert.yaml` has the lead explain it and propose the fix.
- **Skills:** `search-terms-review` (wasted spend into negatives, winners into keywords) and `launch-search-campaign` (a landing page into a Search campaign).

Connect Google Ads at /dashboard/connectors with one Google login. Since Google retired developer tokens (2026-09-09), the OAuth client's Google Cloud project needs Explorer access or above for a real account (Cloud Console → Google Ads API Overview). The app's pages are at /dashboard/marketing. See `docs/apps/marketing.md`.
