---
title: Lists and the CRM starter
description: Create durable personal Lists, administer shared structures, and maintain linked CRM records from chat or the table.
---

# Lists and the CRM starter

Lists store typed records in your workspace. A List can serve one short project or ongoing team work. Closing the chat does not remove it, and personal Lists do not expire automatically.

## Start in chat

In your personal assistant, ask:

> Build me a follow-up List for the people in these notes. Include the person, company, next action, owner, due date and source. Leave unknown facts empty.

The agent discovers existing Lists, defines fields and writes records. Its answer links to the saved table under **Lists**. You can add or edit a record there, or ask the assistant to change it.

Shared workspace chat works with shared Lists. Personal List data is kept out of shared conversations and their activity logs. You can also create a personal List in a shared workspace directly on the Lists page; it is owner-only and is not exposed to shared chat tools.

## Who can do what

| Capability | Member | Admin |
|---|---|---|
| Create and maintain personal Lists | Yes | Yes |
| Read another person's personal Lists | No | No |
| Read and edit shared List records | Yes, in an accessible workspace | Yes |
| Create shared Lists; change their fields and views | No | Yes |
| Publish an owned personal List to a shared workspace | Only if admin in the destination | Yes, in a destination they administer |
| Install the CRM starter | No | Yes |

Sharing exposes the List's records **and history** to workspace members. Only the owner can publish a personal List. Moving it between workspaces retains record IDs and history. Existing relationships must remain valid: a shared List cannot point into a personal List, and moving a List that another List references is refused.

## Create a List without chat

Open **Lists**, then **New List**. Choose Leads, Follow-ups or Plan, name it, and choose the audience. The default is **Only me**. Admins can choose **Workspace members**.

Open the saved List to add records, edit values, add fields, or archive it. Records use text, numbers, dates, choices, yes/no values and references to records in another List. References are validated against their target List. In the initial editor, copy the target record's ID and paste it into a reference field; chat can make those links for you.

## Install the CRM starter

An admin can choose **Install CRM starter** or ask the workspace lead:

> Set up our workspace CRM with companies, contacts, deals and follow-ups.

The starter creates four shared Lists:

- **Companies:** name, website, owner and notes.
- **Contacts:** name, email, company reference and source.
- **Deals:** name, company and contact references, stage, amount, currency and owner.
- **Follow-ups:** action, contact and deal references, owner, due date, status and source.

Installation can be retried; it reuses the starter Lists without resetting customizations. It does not connect another CRM, schedule reminders, or send outreach. Those require separate setup and authorization. An owner field is a stored label in this release; it does not itself notify or assign a user.

## Views, totals and changes

Ask chat to save a named view, for example an exact status filter with selected columns and sorting. Pick the saved view in the table. Views currently support equality filters. Lists contain explicit records, not live external searches.

Ask for counts or sums using `aggregate_list`. Aggregates run in PostgreSQL over every matching record, independently of the current page. Group or filter monetary values by currency. Up to 500 groups are returned, with an explicit truncation flag when more exist.

Every write checks the latest List version. If another person or agent changed it, the save is rejected with a conflict; read the new version and reconcile. A batch is atomic: one invalid record means none of that batch is saved. Changes keep before/after values and the actor in the revision history. The page shows the latest 20 revision entries; there is no one-click revision restore yet.

Field additions are allowed at runtime. Existing field types cannot be changed or removed through these tools. This avoids silently reinterpreting stored data. Workspace YAML apply does not overwrite runtime Lists.

## Tools and API

The workspace lead and personal assistant discover `list_lists`, `create_list`, `read_list`, `write_list_records`, `configure_list`, `aggregate_list` and `install_crm`. `list_lists` returns the shipped **Build and maintain Lists** skill along with accessible Lists.

The table uses `GET /api/v1/lists` and `POST /api/v1/lists`. These endpoints require a signed-in person; generic tenant API tokens cannot impersonate a personal List owner. Reads are paginated. Write batches are bounded to 100 records. Requests cannot choose their own actor or admin role.

## Storage and operations

Migration `0234_workspace_lists` adds `workspace_list`, `list_record` and `list_revision`. Definitions, views and record payloads use PostgreSQL JSONB. Workspace and owner access is enforced by the service on every read and write. Personal rows are isolated from the older workspace-wide business-object search.

Lists use the installation's existing PostgreSQL backup and recovery policy. Archiving keeps data and history and prevents record writes until restored. The initial UI refreshes from the server every 15 seconds while not editing; it does not claim subsecond collaborative editing.
