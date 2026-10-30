# GTM — engagements, their proposals, and growth judged on what it returned

**GTM** is a prebuilt app (id `gtm`): proposals for each engagement, follow-ups after client calls, and the growth loop's briefs.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/gtm/app.yaml` |
| **Plugins** | `proposals` (the proposal writer), `meeting-followup` (the follow-up writer), `growth-loop` (the growth team) |
| **Surfaces** | `/gtm/proposals`, `/gtm/discovery`, `/gtm/personalization` |

## Home

The app opens on its home (`/dashboard/apps/gtm/home`; see [the app manifest](../entities/app-manifest.md#home--where-the-app-opens)).

- **Start something**: Find proposals to write (the empty home's one tile), Write a proposal, Follow up on calls, Prepare for a meeting, Plan the next brief, and Proposals (the board).
- **Needs you**: the GTM seats' open decisions, decided in place.
- **Where things stand**, read live at every load and dated by each system's last sync:

| Figure | Read from |
|---|---|
| Open pipeline | the `crm.deal` state set: open HubSpot deals (not closed won or lost), amounts added up, with the count |
| Follow-ups to approve | follow-up drafts (`meeting.draft_followup`) waiting in Review, dated by the oldest |
| Client meetings, next 7 days | the `calendar.event` state set: meetings in the next seven days with someone from outside |
| Deals gone quiet | the core `stale-deals` view: open deals with no change in the CRM for 14 days |

Follow-ups owed are counted from the drafts waiting now, never from a label stored on a thread.

- **Each engagement** (a project anchored to a CRM deal): the deal's amount and stage, as of the project's last status, and its follow-ups waiting on you.
