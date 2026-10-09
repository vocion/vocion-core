# State and saved views

"What do I need to answer?", "which deals have gone quiet?", "what is overdue?" are questions about **state**, not content. A phrase search cannot see state. On 2026-10-09 one of these questions took 35 steps and 3m20s of guessed searches. Vocion answers them from typed state with one query, `query_state`, and keeps the questions people ask often as **saved views**.

## Facets: state on the index

A *facet set* names one kind of thing and the state it carries (`libs/retrieval/facets.ts`):

| Kind | Source | Facets |
|---|---|---|
| `mail.thread` | Gmail | `reply_state` (needs_my_reply · waiting_on_them · fyi · outbound_spam), `category`, `counterpart`, `last_inbound_at`, `last_outbound_at`, `mailbox`, `ask` |
| `calendar.event` | Google Calendar | `start`, `organizer`, `attendees`, `external_attendees` |
| `crm.deal` | HubSpot | `stage`, `amount`, `close_date`, `owner` |
| `tasks.issue` | Jira | `assignee`, `status`, `completed`, `due` |
| `code.pull_request` | GitHub | `state`, `author`, `requested_reviewers`, `draft` |
| `chat.message` | Slack | `channel`, `author`, `mentions` |
| `finance.invoice` | QuickBooks | `customer`, `due`, `balance`, `status` |

Every kind also has `updated_at`, which is the date the source last changed the item.

Two record kinds read Vocion's own tables in the same shape:
- `vocion.decision`: decisions waiting on the person.
- `vocion.connection`: connections whose last sync failed.

Where facets come from:
- **Fields the connector already stores**, read in place. A set's `path` says where each facet lives, so a new set needs no re-ingest.
- **Deterministic facts worked out at sync**, with no model involved: a calendar event's external attendees, a pull request's requested reviewers, Slack's `<@U…>` mentions, and who wrote last in a mail thread.
- **One classifier label for a mail thread**, only when its last message changed (`services/mail/threadLabeller.ts`). It is charged to `platform:retrieval.state`.

## Filters

```json
{
  "reply_state": "needs_my_reply",
  "category": ["sales", "customer"],
  "mailbox": "$me",
  "last_inbound_at": { "since": "-14d" },
  "stage": { "not": ["closedwon", "closedlost"] },
  "balance": { "gt": 0 },
  "start": { "since": "now", "until": "+24h" }
}
```

- A value or a list matches any of the values.
- `{"not": …}` excludes.
- Dates take ISO strings or relative values: `now`, `-30m`, `-24h`, `-14d`, `+24h`, `-2w`.
- Numbers take `gt` and `lt`.
- `{"exists": true}` matches any item that has the facet at all.
- `"$me"` stands for the person asking: their address, its local part and their name.
- Text matches a substring; lists match whole elements; enums match exactly.

The same filter works in all three places:
- `search_knowledge` (`facets`), which ranks within the filtered set;
- `query_state`, which lists it;
- a saved view, which stores it.

## query_state

One tool for every state question. It either runs a view by slug (`{"view": "owed-replies"}`) or runs a composed query (`{"sets": […], "filter": {…}, "sort": {…}}`).

- Each row is citable and appears in the sources sidebar.
- The output says when each source last synced.
- `live: true` reads mail newer than the sync watermark, from headers. Use it only for "right now" questions. Live rows are marked LIVE.
- The tool is marked `alwaysLoaded`, so it never waits behind tool search.

## Saved views

A view is a row in `state_view`: a name, a sentence, a stored query and an owner. The owner is `core`, `org`, `workspace` or `person`; for any slug, the narrowest owner wins.

Core views ship as data in `libs/state/coreViews.json`:

| Slug | Shows |
|---|---|
| `owed-replies` | Email threads where the other side wrote last and is waiting on my answer |
| `awaiting-their-reply` | Email threads where I wrote last more than 3 days ago and heard nothing |
| `meetings-needing-prep` | Meetings in the next 24 hours with an outside attendee |
| `stale-deals` | Open deals unchanged for 14 days |
| `my-overdue-tasks` | Issues assigned to me, past due, not done |
| `prs-awaiting-my-review` | Open pull requests where my review is requested |
| `slack-mentions` | Slack messages mentioning me in the last 7 days (save your own copy with your member id) |
| `approvals-waiting-on-me` | Decisions in the review queue that are mine |
| `overdue-invoices` | Invoices past due with a balance owed |
| `broken-connections` | Connections whose last sync failed |

`waiting_on_me` and the morning brief read `owed-replies` from the person's own mailbox, plus every view the person marked `in_brief`.

## Learning a person's views

Every `query_state` call is logged by its **shape**: its kinds and its filter, never its words. The third time the same shape appears in 14 days, the tool tells the agent. This only happens if the person has no view of their own for that shape.

The agent may then offer, once, to save the shape as the person's view. It makes the offer as a Decision card using `recommend_action` with `view.save`. The system notices and the assistant offers; nothing is saved without the person.

When a person asks directly ("keep an eye on overdue invoices over $5k"), their words run `view.save` straight away, with Undo.

A schedule or automation built on a view is a separate ask. It follows the trust ladder and is never switched on automatically.

## Adding a facet

- **A fact the connector already stores.** Add the facet to its set, with a `path` pointing at the field. Nothing is re-ingested.
- **A deterministic fact the connector can compute** (structure such as headers, markup or domains, never meaning). Add it under the connector's `metadata.facets` and declare it. Existing items pick it up when they next sync, because metadata is refreshed even when content is unchanged.
- **A new classifier**, such as "contract-related". It costs a model call per item, so it needs a cost estimate and an approval Decision before it runs, plus a backfill of recent items. Estimate it the way thread labels are estimated: about $0.0008 per item on Haiku 4.5, multiplied by the items in the window. The labeller pattern (`threadLabeller.ts`: free rules first, reuse unchanged labels, a per-sync allowance, the feature's spend cap) is the template to follow.
