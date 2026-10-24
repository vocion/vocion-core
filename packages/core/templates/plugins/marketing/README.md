# Marketing

Paid search, run by an agent and approved by a person.

- **Marketing lead** (`agents/marketing-lead.yaml`) reads the connected Google Ads account, writes the daily update, and proposes every change as a card.
- **Daily marketing update** (`missions/daily-marketing-update.yaml`), run each weekday morning (`automations/marketing-daily-update.yaml`) and mailed to the accountable person (`automations/marketing-update-email.yaml`).
- **Skills:** `search-terms-review` (wasted spend into negatives, winners into keywords) and `launch-search-campaign` (a landing page into a Search campaign).

Connect Google Ads at /dashboard/connectors with one Google login. Since Google retired developer tokens (2026-09-09), the OAuth client's Google Cloud project needs Explorer access or above for a real account (Cloud Console → Google Ads API Overview). The app's pages are at /dashboard/marketing. See `docs/apps/marketing.md`.
