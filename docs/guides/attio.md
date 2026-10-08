# Attio as a CRM source

A workspace connects Attio with an access token. Vocion syncs companies,
people, deals and notes into knowledge, agents read the CRM live through the
CRM tools, and two actions write back — an attribute update and a note — each
with Undo. No OAuth app is needed.

## What gets synced, and what never is

One `knowledge_document` per record, `externalId`
`attio:<account|contact|deal|activity>:<record id>`, linked to the record in
Attio.

- **Companies, people, deals.** The embedded text is who or what the record is
  (a company's name, domain and description; a person's name, job title,
  company and email; a deal's name and company). Stage, value, currency and
  owner are metadata. Every attribute is read by its type, custom ones too.
- **Notes** written in the last 90 days (`activityDays`), with what they are on.

Never stored: phone numbers, lists, emails and calendar events Attio synced,
comments, files.

**Every run reads every record.** Attio has no "changed since" filter on
records, so an incremental run is a full read; the content hash downstream
keeps an unchanged record from being embedded again, so a re-read costs
requests, not embeddings. A record's newest value stands in for its
last-modified time. Attio does not mark a deal stage won or lost, so the deal
tools list every deal with its stage and say so.

| Setting | Default | What it does |
|---|---|---|
| Records to sync | accounts, contacts, deals, activities | Accounts are companies, contacts are people; activities are notes. |
| Index activity from the past (days) | 90 | How far back notes are kept. |

## Agent tools (the CRM family)

`crm_search_records`, `crm_get_record` (a company's team and deals, a
person's deals, a deal's people — read from the record's own reference
attributes), `crm_record_activity` (notes and tasks), `crm_list_deals` and
`crm_list_fields` (attributes by slug, with select options and statuses).
They name no vendor; the workspace's Attio source answers.

## Actions

- `crm.update_record` — sets attributes by slug: text, a number, a select
  option or status by its title, a date. The run records what each held;
  **Undo** writes it back, and an attribute that was empty is cleared.
- `crm.add_note` — adds a plaintext note to the record. **Undo** deletes it.

Both are external and need the `update_crm` grant.

## Connecting it

Paste an **access token**, from Attio → Workspace settings → Developers →
New access token. Scopes: read on records, object configuration, tasks and
user management (owners' names); read-write on records and notes for the
actions. It is stored encrypted under the workspace's key and never shown
again. Test connection names the workspace and reads one company.
