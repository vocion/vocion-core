# Salesforce as a CRM source

A workspace connects one Salesforce org. Vocion syncs its accounts, contacts,
opportunities and recent activity into knowledge, agents read and search the
org live through the CRM tools, and two actions write back: a field update and
a logged note, each with Undo.

## What gets synced, and what never is

One `knowledge_document` per record, `externalId`
`salesforce:<account|contact|deal|activity>:<id>`, linked to the record's
Lightning page.

- **Accounts, contacts, opportunities.** The embedded text is only who or what
  the record is: an account's name, domain, industry and description; a
  contact's name, title, account and email; an opportunity's name and account.
  Stage, amount, close date, owner and dates are metadata, so a stage change
  never re-embeds a record.
- **Activity.** Tasks and events changed in the last 90 days (`activityDays`):
  subject, when, what it is on, and the description.

Never stored: phone numbers, cases, leads, attachments, files, Chatter, or any
field the run-as user cannot see.

**Incremental.** Each run after the first asks only for records whose
`SystemModstamp` moved since the last one. A daily full run reconciles
deletions. Each page of up to 2,000 records is one API request against the
org's daily allowance; Test connection shows what is left.

| Setting | Default | What it does |
|---|---|---|
| Records to sync | accounts, contacts, deals, activities | Any subset. Deals are opportunities. |
| Index activity from the past (days) | 90 | How far back a full sync reads tasks and events. |
| API version (advanced) | `v61.0` | The REST version called. |

## Agent tools (the CRM family)

Present for an agent whose sources include a CRM; they name no vendor.

- `crm_search_records` — accounts by name or website, contacts by name or
  email, deals by name. Every word is quoted into SOQL, never pasted into it.
- `crm_get_record` — one record whole, with an account's contacts and deals,
  a deal's contacts (contact roles), or a contact's deals.
- `crm_record_activity` — tasks and events on a record, newest first.
- `crm_list_deals` — open opportunities, least recently updated first.
- `crm_list_fields` — each object's fields by API name, writable or not, with
  pick-list values.

## Actions

- `crm.update_record` — sets fields on an account, contact or opportunity.
  The run records what each field held before; **Undo** writes it back.
- `crm.add_note` — logs a completed Task on the record (Salesforce's own
  "logged activity"). **Undo** deletes that Task.

Both are external and need the `update_crm` grant, so an agent's proposal
meets the workspace's trust ladder; a person asking for it themselves runs it.

## Connecting it

**Log in with Salesforce** — needs an OAuth app registered once per server or
per workspace: `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET` in the
server's env, or a **Salesforce login app** saved on Developers. Scopes
`api refresh_token offline_access id`, PKCE, callback
`<NEXT_PUBLIC_APP_URL>/api/connect/salesforce/callback`. Set-up steps:
[login-apps.md](login-apps.md#salesforce). Until one exists, the Connectors
page says which values are missing and offers the paste below.

**Paste a client-credentials app — works today, no Vocion OAuth app.** In your
own org: Setup → App Manager → New Connected App, enable OAuth with the `api`
scope, turn on **Enable Client Credentials Flow**, and under Manage → Edit
Policies pick a **run-as user**. Paste three values:

| Field | Where | Shown |
|---|---|---|
| My Domain URL | `https://<your-domain>.my.salesforce.com` | in full |
| Consumer key | the app's Consumer Details | in full |
| Consumer secret | the same page | masked |

Vocion reads and writes as the run-as user, so give it a profile that sees
what the agents should, and edit rights only if you want the actions. The
secret is encrypted under the workspace's key and never shown again.
