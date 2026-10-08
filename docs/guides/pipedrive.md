# Pipedrive as a CRM source

A workspace connects Pipedrive with an API token. Vocion syncs organizations,
people, deals, activities and notes into knowledge, agents read the CRM live
through the CRM tools, and two actions write back — a field update and a note —
each with Undo. No OAuth app is needed.

## What gets synced, and what never is

One `knowledge_document` per record, `externalId`
`pipedrive:<account|contact|deal|activity>:<id>`, linked to its page on
`<company>.pipedrive.com`.

- **Organizations, people, deals.** The embedded text is who or what the
  record is (name; a person's job title, organization and primary email; a
  deal's title and organization). Stage (by name), value, currency, status,
  expected close, owner and pipeline are metadata.
- **Activities and notes** changed in the last 90 days (`activityDays`),
  as plain text with what they are on.

Never stored: phone numbers, files, emails synced into Pipedrive, products,
leads, or anything the token's owner cannot see.

**Incremental.** Organizations, people, deals and activities come from API v2
with `updated_since`, so a run after the first reads only what changed; notes
come newest-updated first and the walk stops at the watermark. A daily full
run reconciles deletions. A 429 is waited out for as long as Pipedrive asks.

| Setting | Default | What it does |
|---|---|---|
| Records to sync | accounts, contacts, deals, activities | Accounts are organizations, contacts are people; activities include notes. |
| Index activity from the past (days) | 90 | How far back a full sync reads activities and notes. |

## Agent tools (the CRM family)

`crm_search_records`, `crm_get_record` (an organization's people and deals, a
person's deals, a deal's person), `crm_record_activity` (activities and notes),
`crm_list_deals` (open deals, least recently updated first) and
`crm_list_fields` (each object's fields by API key, with an option field's
labels). They name no vendor; the workspace's Pipedrive source answers.

## Actions

- `crm.update_record` — sets fields on an organization, person or deal. A
  custom field is named by its 40-character key; an option field takes the
  option's label, which Vocion turns into its id. The run records what each
  field held; **Undo** writes it back.
- `crm.add_note` — adds a note to the record. **Undo** deletes it.

Both are external and need the `update_crm` grant.

## Connecting it

Paste an **API token**, from Pipedrive → Settings → Personal preferences →
API. It acts as the person who made it: the sync reads what they see and the
actions write as them, so use the account whose visibility the agents should
have. It is sent as the `x-api-token` header, never in a URL, stored
encrypted under the workspace's key, and never shown again. Test connection
says whose token it is and reads one deal.
