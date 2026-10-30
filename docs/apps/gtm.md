# GTM — engagements, their proposals, and growth judged on what it returned

**GTM** is a prebuilt app (id `gtm`): proposals for each engagement, follow-ups after client calls, and the growth loop's briefs.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/gtm/app.yaml` |
| **Plugins** | `proposals` (the proposal writer), `meeting-followup` (the follow-up writer), `growth-loop` (the growth team) |
| **Surfaces** | `/gtm/proposals`, `/gtm/discovery`, `/gtm/personalization` |

## Home

The app opens on its home (`/dashboard/apps/gtm/home`; see [the app manifest](../entities/app-manifest.md#home--where-the-app-opens)).

- **Start something**, in the order a seller reaches for them on a working day: Prepare for a meeting, Follow up on calls, Find proposals to write (the empty home's one tile), Write a proposal, Revive quiet deals (the deals with no change in two weeks, ranked, with a nudge drafted for the top five), and Plan the next brief. Every tile starts work; the Proposals board is in the nav.
- **Needs you**: the GTM seats' open decisions, decided in place.
- **Where things stand**, read live at every load and dated by each system's last sync:

| Figure | Read from |
|---|---|
| Open pipeline | the `crm.deal` state set: open HubSpot deals (not closed won or lost), amounts added up, with the count |
| Follow-ups to approve | follow-up drafts (`meeting.draft_followup`) waiting in Review, dated by the oldest |
| Client meetings, next 7 days | the `calendar.event` state set: meetings in the next seven days with someone from outside |
| Deals quiet 14+ days | the core `stale-deals` view: open deals with no change in the CRM for 14 days |

Follow-ups owed are counted from the drafts waiting now, never from a label stored on a thread.

- **Each engagement** (a project anchored to a CRM deal whose stage does not say closed): one row with the deal's amount and stage, as of the project's last status, and its follow-ups waiting on you. A won or lost deal leaves the list.
