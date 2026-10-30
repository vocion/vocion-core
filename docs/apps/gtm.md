# GTM — engagements, their proposals, and growth judged on what it returned

**GTM** is a prebuilt app (id `gtm`): proposals for each engagement, follow-ups after client calls, and the growth loop's briefs.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/gtm/app.yaml` |
| **Plugins** | `proposals` (the proposal writer), `meeting-followup` (the follow-up writer), `growth-loop` (the growth team) |
| **Surfaces** | `/gtm/proposals`, `/gtm/discovery`, `/gtm/personalization` |

## Home

The app opens on its home (`/dashboard/apps/gtm/home`; see [the app manifest](../entities/app-manifest.md#home--where-the-app-opens)).

- **Start something**: Draft a proposal is the primary launcher. It opens a composer for the engagement name rather than starting an unscoped research run. Supporting launchers prepare a meeting, draft call follow-ups, find the next proposal, or open the proposal board. Drafts remain subject to review. Growth briefs remain available through Chat and the Growth navigation.
- **Needs you**: the GTM seats' open decisions, decided in place.
- **Where things stand**, read live at every load and dated by each system's last sync:

| Figure | Read from |
|---|---|
| Follow-up drafts awaiting approval | follow-up drafts (`meeting.draft_followup`) waiting in Review, dated by the oldest |
| External meetings, next 7 days | the `calendar.event` state set: meetings in the next seven days with someone from outside |

Follow-ups owed are counted from the drafts waiting now, never from a label stored on a thread.

- **Each engagement** (a project anchored to a CRM deal): the deal's amount and stage, as of the project's last status, and its follow-ups waiting on you.

Pipeline totals and quiet-deal counts are intentionally absent from this launcher. Filtering only the default `closedwon` and `closedlost` stage IDs can include closed deals in custom pipelines. Restore those measures only when the state query can use normalized closed-stage metadata. External meetings are labelled as such: an outside attendee does not establish that a meeting is with a client.
