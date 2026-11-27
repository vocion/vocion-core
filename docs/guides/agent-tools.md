# Agent tools that write

Most of what an agent can do is read: search the knowledge base, look up records, fetch a page,
render an artifact beside the conversation. This page is about the tools that **change
something**, because every one of them rides the same rail — *propose → gate → execute* — and the
rail is what makes an agent's writes safe to leave on by default.

The rule is one rule (design value 4, *autonomy that was earned*): a tool that writes never writes
directly. It **proposes** a registered action with a confidence; the [trust ladder](../entities/trust.md)
decides whether that runs at once or waits for a person; what runs is recorded as an `action_run`
with who, why, and what was there before; and anything reversible can be put back with one Undo
from the Review queue's Decided tab. A workspace moves the bar per kind in `trust.yaml`; an agent
loses a tool altogether with `harness.excludeTools` ([agent](../entities/agent.md)).

The tool surface is one list, `packages/core/src/services/agents/tools/registry.ts`, and every
harness — in-process, AgentCore, and the MCP server at `/api/mcp` — serves the same tools with the
same gates, built from one context (`services/agents/runtimeContext.ts`). The Tools page
(`/dashboard/tools`) reads that same list per agent and shows the union by family — the built-ins,
the typed filing tools, each connected source, each REST source's reads and writes — with the
agents that hold each tool, so what the page says an agent has is what the agent has.

## The tools

| Tool | Action it proposes | What it changes | Present for | Default on the ladder |
|---|---|---|---|---|
| `propose_action` | any registered id — `hubspot.update`, `gmail.send`, `objects.propose_candidate`, … | The outside world: a CRM record, an email, a candidate for a person to judge. | every agent | per action: `hubspot.update` done for you at 0.8; a send or a candidate always asks |
| `recommend_action` | none on emit — the card files `propose_action` when tapped | Nothing until a person taps. | every agent in a turn, `ask_workspace` included; not a tool you call over MCP. Over `ask_workspace` its card is filed to Review, or, with `end_user_cards: true`, returned in `cards` for the calling app's user to tap ([below](#running-a-card-an-end-user-tapped)) | — |
| `file_ask` | `ask.file` | Puts one question on Needs you ([ask](../entities/ask.md)): a ruling, an approval, an input, a credential, a merge, a recommendation, a gate. Owned by the agent, bound to its run, about the records it names. | every agent | low, reversible → done for you at 0.8; Undo withdraws it while open |
| `withdraw_ask` | `ask.withdraw` | Closes an open question **this agent** filed, as superseded with the reason. | every agent | low, reversible → done for you at 0.8; Undo reopens it |
| `wait_for_answers` | — parks the run on a resume gate | Stops this mission run (or the scheduled automation whose check this is) spending until the asks it names are answered; files one gate ask. | inside a mission run | — nothing is executed; answering resumes it |
| `update_object` | `objects.update_meta` | Declared fields on an existing record of an [object type](../entities/object-type.md) the agent works with — a priority, a state, the task that answered a request. Never the title, the lifecycle status or the id. | agents with `objectTypes:` — and only for those types | low, reversible → done for you at 0.8; Undo restores the previous values |
| `write_wiki_page` | `wiki.write_page` | A page of the workspace wiki. | while the `wiki` plugin is on | self-improving: the learning dial (the plugin sets 0.6) |
| `update_mission_notes` | `mission.update_notes` | The running mission's working notes. | inside a mission check (not over MCP) | self-improving: the learning dial |
| `remember_preference`, `add_learning`, `update_learning`, `remove_learning` | `learning.adopt_rule` and the learning services | Standing rules the agent reads on later turns. | every agent | self-improving: the learning dial |
| `file_feedback` | — proposes a rule for a person | A suggested rule on Needs you. | every agent | always a person |
| `propose_action` with `rest.request` (after reading `<prefix>_list_actions`) | `rest.request` | An endpoint a [`rest` source](./rest.md) declares under `actions[]` — a write to the workspace's own API. | agents with a REST source in `connectorSources:` | external, not reversible → always asks, until `trust.yaml` promotes one endpoint (`rest.request.<source>.<action>`) |
| `apollo_add_to_list`, `apollo_remove_from_list` | Apollo, direct | A prospect list that can feed a live cadence. | agents granted them (`harness.grantTools`) with an Apollo source | the grant is the gate |
| `zendesk_list_help_center_articles`, `zendesk_get_help_center_articles` | — (reads) | Nothing: every public Help Center article's id, title and a 120-character snippet in one call (it walks up to 10 pages of 100 itself, says `truncated: true` past that, and is cut at 40,000 characters); then 1 to 3 articles by id as plain text, cut at 8,000 characters each. Live and anonymous (no `Authorization` header), so drafts and articles behind a login are never visible. A missing id comes back as `not_found` and an unreadable one as `status: 'error'` while the others return; a timeout, 5xx or 429 is retried once (except a 429 that asks for a wait over 5 seconds, which is returned at once), then returned as a typed error. See [zendesk.md](./zendesk.md#help-center-articles). | agents with a `zendesk` source in `connectorSources` | — |
| `repo_read_pull`, `repo_read_diff`, `repo_read_file` | — (reads) | Nothing: a pull request, a diff (with the files outside a task's `allowedPaths`), a file at a ref, read live from the connected code host with the workspace's own connection. | agents with a code-host source (`github` today) in `connectorSources` | — |
| `repo_read_tree` | — (read) | Nothing: a repository's whole layout at a ref in one call — top-level folders with file counts and extensions, every path to three levels (capped), the manifest files found near the root and the text of up to eight of them inside one character budget. Dependencies, build output and lockfiles are excluded and named. The call for an architecture map; walking folders with `fetch_url` is the thing it replaces. | agents with a code-host source in scope, or granted it by name (`harness.grantTools`; the software factory's Release seat) | — |
| `describe_setup` | — (read) | Nothing: what each plugin that is on still needs before it works, from the plugin's own `setup:` declaration (`plugin.yaml`) — a connector to connect, a first record to file — with whether each step is done and the link for it (the Connectors page's add flow for the connector, the same one `offer_connection`'s card opens). The same judgement the chat's "Set up your <plugin>" chip is built from (`services/plugins/setupState.ts`). | every agent | — |
| `draw_architecture` | — writes the record's `architecture` block and two artifacts | A product's architecture: the agent hands over a typed graph (components, relationships, a summary, which repositories at which ref it was read from) and the platform lays it out into an SVG, files it as a versioned artifact on the product at role `architecture-diagram` with the summary at `architecture-summary`, and points the record at them. Nothing is painted by a model and no diagram lives in a code fence. | agents granted it (`harness.grantTools`; the software factory's Release seat) | the record write, as the agent's |
| `repo_read_check_logs`, `repo_read_pipeline_runs` | — (reads) | Nothing: a red check's failing step and log tail; a pipeline's runs with their jobs. Former names `github_read_check_logs`, `github_read_workflow_runs`. | agents granted them (`harness.grantTools`) | the grant is the gate |
| `propose_action` with `repo.comment_pull`, `repo.submit_review`, `repo.cancel_pipeline_run` | the same ids | A comment on a pull request (Undo deletes it); a review with inline findings (Undo dismisses it); a pipeline run stopped (Undo starts it again). | every agent with the family in scope | low / medium / low → done for you at 0.8 |
| `propose_action` with `repo.rerun_failed_checks`, `repo.open_pull`, `repo.dispatch_pipeline`, `repo.revert_pull` | the same ids (formerly `github.rerun_failed_jobs`, `github.open_pull`, `github.dispatch_workflow`, `github.revert_pull`) | The failed jobs re-run; a pipeline fix opened as a pull request; a pipeline started; a merged pull request reverted. Each with Undo. | the pipeline's owner — a seat whose harness grants the id — or a person | the software-factory plugin's trust.yaml: done for you at 0.8 |
| `tracker_read_issue`, `tracker_search_issues`, `tracker_read_attachment` | — (reads) | Nothing: an issue live with its comments, attachments and transitions; a search in the tracker's own language bounded to the configured projects; an attachment (an image becomes an artifact). | agents with a tracker source (`jira` today) in `connectorSources` | — |
| `propose_action` with `tracker.create_issue`, `tracker.transition_issue`, `tracker.update_issue`, `tracker.attach_file` | the same ids | An issue filed from a request; its status moved; its priority, labels, version or remote link; a file attached. Each with Undo. | every agent with the family in scope | medium / low / low / low → done for you at 0.8 |
| `propose_action` with `tracker.comment` | `tracker.comment`, or `tracker.comment.<kind>` | A comment the asker reads on their issue. Undo deletes it. | every agent with the family in scope | medium; the plugin holds it at a person's approval like `notify.requester` |
| `finance_list`, `finance_get`, `finance_report` | none (reads) | Nothing: customers, vendors, invoices, bills, payments, subscriptions, payouts, card spend, reimbursements or accounts from the connected finance system, live, with the workspace's own credential; each record with its amount, what is still owed and its link. `finance_report` runs a profit and loss or a balance sheet where the vendor runs statements (QuickBooks today). See [finance-and-people.md](finance-and-people.md). | agents with a finance source (Stripe, QuickBooks, Xero, NetSuite, Ramp, BILL) in `connectorSources` | none |
| `propose_action` with `finance.recategorize_expense`, `finance.post_journal_entry` | the same ids | An expense line moved to another account (Undo moves it back); a balanced journal entry posted (Undo deletes it). They change the books and move no money. QuickBooks today; refused on the sample company. | every agent with the family in scope | medium / high, and `approvalRequired`: a person approves every one an agent proposes |
| `propose_action` with `finance.draft_invoice` | `finance.draft_invoice` | An invoice created as a draft in the finance system — never sent or charged. Undo deletes it. Only where the vendor's drafts can be deleted (Stripe today). | every agent with the family in scope | medium → a person approves until promoted |
| `people_list`, `people_get` | — (reads) | Nothing: workers, departments, time off and pay-run totals from the connected HR system, work information only. | agents with an HR source (Gusto, Rippling, Workday) in `connectorSources` | — |
| `chat_read_thread`, `chat_read_file` | — (reads) | Nothing: a thread read live with the chat's own token (the workspace's `slack` source first, the deployment's app second); a file on a message (an image becomes an artifact). | agents with a chat source (`slack` today) in `connectorSources` | — |
| `propose_action` with `chat.post_message` (formerly `slack.post_message`) | `chat.post_message` | A post in a channel the workspace bound; Undo deletes it. | every agent | medium → a person approves until promoted |
| `propose_action` with `chat.reply_in_thread` | `chat.reply_in_thread`, or `.<kind>` | A reply in the thread the ask came from; Undo deletes it. | every agent with the family in scope | medium; a kind reads the parent's rule unless given its own |
| `propose_action` with `chat.add_reaction` | `chat.add_reaction` | A reaction on a message; Undo removes it. | every agent with the family in scope | low → done for you at 0.8 |
| `warehouse_schema`, `warehouse_query` | — (reads) | Nothing: the allowed schemas, a schema's tables, a table's columns; one read-only SQL query, rows back. The warehouse itself refuses anything but a query (compiled as a subquery, a BigQuery dry run, a Redshift `READ ONLY` transaction), a query that reads outside the source's allowed schemas is refused before it runs, and the source caps rows, bytes and time. See [snowflake.md](./snowflake.md), [bigquery.md](./bigquery.md), [databricks.md](./databricks.md), [redshift.md](./redshift.md). | agents with a warehouse source (`snowflake`, `bigquery`, `databricks`, `redshift`) in `connectorSources` | — |
| `analytics_events`, `analytics_event_counts`, `analytics_funnel`, `analytics_cohorts` | — (reads) | Nothing: the events a product analytics project tracks, their counts per day, week or month, conversion through steps, its saved cohorts — read live. See [mixpanel.md](./mixpanel.md), [amplitude.md](./amplitude.md). | agents with an analytics source (`mixpanel`, `amplitude`) in `connectorSources` | — |
| `ads_campaigns`, `ads_performance` | — (reads) | Nothing: campaigns or ad sets with status and budget; impressions, clicks, spend and conversions over a range. See [linkedin-ads.md](./linkedin-ads.md), [meta-ads.md](./meta-ads.md). | agents with an ads source (`linkedin-ads`, `meta-ads`) in `connectorSources` | — |
| `propose_action` with `ads.set_status` | `ads.set_status` | A campaign or ad set paused or resumed; Undo puts it back. Refused, before anything is queued, on a connection that can only read (every LinkedIn connection). | every agent | medium → a person approves until promoted |
| `offer_connection` | — (read) | A link card in chat that opens the Sources connect flow for one connector and returns to the conversation; no Approve (#1080). On a person's turn the card ends the turn: nothing is written behind it (`agents/handOff.ts`). | every agent | — |
| `connect_system` | — (read) | One `connect-systems` card in chat that docks "Connect your systems" above the composer: a ranked list from evidence, each system connected by login or inline key, verified, then a summary. Takes the connector slugs the person named and/or an app id; any registry connector. On a person's turn the card ends the turn. See [Connect your systems](./connect-your-systems.md). | every agent | — the person decides each step |
| `setup_options` | — (read) | Nothing: where a shared workspace stands on its four first steps (a system connected, an app or template added, an agent hired, someone invited — the same reading the sidebar's Getting started checklist makes, `services/workspace/gettingStarted.ts`) and what this installation offers: apps, plugins, systems to connect, catalog roles not yet hired, and whether this person may invite. | agents granted it (`harness.grantTools`) in a shared workspace — the seeded workspace's lead | — |
| `propose_setup` | none on emit — each card runs `app.install`, `app.install_template`, `plugin.enable`, `team.hire_agent` or `members.invite` when the person presses it, proposed as the person (`review.actAsPerson`), with Undo; a `connect` step is the ordinary `offer_connection` card, and two or more become one `connect_system` card | Nothing until a person presses a card. Typed steps in (`{kind, id, emails, why}`), one `setup` card per step out; a step that could only fail (already done, unknown, not this person's to take) is left out and named in the result. Its cards end the turn like any card a person acts on. See [Getting started in a new workspace](./getting-started-in-a-workspace.md). | agents granted it (`harness.grantTools`) in a shared workspace — the seeded workspace's lead | — the person's press is the decision |
| `open_team_thread` | — runs a [team thread](./team-threads.md) | One run (a `mission_run` with its `thread`): the lead's specialists post in rounds and answer each other until a settle rule holds, and the lead writes the outcome. Spends model turns, bounded by the thread's round and budget caps (3 rounds and $3.00 unless the lead sets them). | every agent; refused, in words, for one with no specialists and inside a thread | — the caps are the bound; each member's own writes ride their own actions |
| `lookup_person` | — (read) | Nothing: one person's chat user, tracker account and code-host login, found by email across the families the agent reaches. | agents with any of the three families in scope | — |
| `serp_search`, `serp_compare`, `keyword_metrics` | — (reads; `serp_compare` files a SERP brief artifact) | Nothing outside the workspace: Google's results page for a query, the top pages compared into a **SERP brief** (folder `seo/serp`, every row linked and dated) with the agent's synthesis written into it, and keyword volume from DataForSEO. With no SERP provider the results come from `web_search` and say they are not Google's ranking. See [seo-research.md](./seo-research.md). The same grant carries `search_console_queries`, `search_console_pages`, `ahrefs_organic_keywords` and `ahrefs_brand_radar` ([seo-data.md](./seo-data.md)). | agents granted them (`harness.grantTools: [serp]`, or a tool by name) | — the grant is the gate; every call is charged to `seo.research` |

The `repo`, `tracker` and `chat` rows are three **connector families**
(`libs/connectors/families.ts`): tools and actions named for the construct —
a pull request, an issue, a thread — never for the vendor. GitHub, Jira and
Slack are the first provider of each; the source a workspace connected decides
which answers. An action renamed from its vendor's id keeps the old id as an
alias (`Action.aliases`), so a run, a trust rule or a grant written against
`github.open_pull` still resolves to `repo.open_pull`.

The `warehouse`, `analytics` and `ads` rows are families in the same sense: one
SQL tool for Snowflake, BigQuery, Databricks and Redshift alike, one set of
event, funnel and cohort reads for Mixpanel and Amplitude, one campaign and
spend read for LinkedIn Ads and Meta Ads. A campaign is what groups spend
toward one objective (LinkedIn: campaign group) and an ad set is where budget
and audience are set (LinkedIn: campaign).

Project filing (`file_to_project`, `unfile_from_project`) and artifact editing
(`update_artifact`, `edit_document`) write inside the workspace and the conversation and are not
on the ladder: nothing leaves, and every version is kept.

## What a receipt says

Every write tool returns one of a few sentences, and the agent is told to repeat the right one:

- **Done for you** — the write ran (`run #N`), a person can undo it from Review › Decided. The agent
  says it was done.
- **Pending** — the confidence was under the bar, or the workspace holds the kind at approval. The
  agent says it is *queued for approval*, never that it happened.
- **Refreshed** — a pending card for the same target already existed and now carries this payload.
  Nothing new was queued.
- **Already decided** — a person judged this exact record before. The agent moves on.
- **Refused** — the rail said no before any row existed: an unknown field, a record that is not
  there, an option shape the service does not take. The reason is a sentence the agent can act on.

An ask's receipt also carries the ask's id and its URL on Needs you, so the agent can link the
question where it reports — and the agent is told it does *not* have the answer yet.

## Asking a person — `file_ask`

An ask is not a proposal: nothing executes when it is answered. It is the right tool when the
decision is a person's to make and the agent's job is to put it in front of them well — the
question as the title, two to four lines of why, options whose description is the consequence of
picking each, the long form behind `context_md`. [Writing a good ask](../entities/ask.md#writing-a-good-ask)
is the reference.

What the tool adds on the agent's behalf: `agentSlug` from the run, `sourceRef` as the action run
(so a retry updates rather than doubles), and `contextUrl` as the mission run the question came up
in. What the agent should add: `object_refs` — the records the question is about — because they
ride the `ask.decided` event beside the agent slug and the kind, and an automation filtered on
those writes the person's answer back onto the record. A batch shares a `group_key` and is
decided as one sheet; `decision_cost` is the minutes each question takes, which is what a batch is
metered by.

Why it is on the ladder at all: an agent that asks too much is a cost, and *whether this agent may
interrupt people unasked* is the workspace's call. The default says yes above 0.8 with Undo; a
`trust.yaml` rule parking `ask.file` at `execute-with-approval` means a person first sees "this
agent wants to ask you something" and approving it is what files the question.

A question nobody answers does not wait forever: at its `due_at` (or a window by risk) the
recommended option applies by default where the trust ladder allows it, and otherwise it stays and
its owner is told again — [deadlines](../entities/ask.md#deadlines-defaults-and-who-hears-about-it).
So recommend the option you would stand behind, and say how sure you are.

## Waiting on answers — `wait_for_answers`

When everything an agent has left to do is blocked on questions a person has not answered, another
turn only spends money to find that out again. `wait_for_answers({ ask_ids, waiting_for })` names
the open asks it is blocked on — by id, never inferred from its words — and one line saying what it
waits for. Core files ONE gate ask (*Nothing pricing-lead can do until the Northwind tier is
answered*) and parks what would keep spending: the mission run before its next task, else the
scheduled automation whose check this is; with nothing more scheduled it parks nothing and says so.
Answering the asks resumes it on its own (`services/needsYou/ResumeGateService.ts`). Offered only
inside a mission run; a person's own chat has a person in it.

## Writing a record — `update_object`

The write beside `lookup_objects`. It is scoped twice: the agent's own `objectTypes:` list says
which types it may write at all (a type outside it is refused before anything is proposed), and
the type's `schema.properties` says which fields — an undeclared field, or a value outside its
field's enum or type, is refused with the list of what the type does declare, so a new field is
a change to `type.yaml` first. The row's own columns (`title`, `status`, `id`, the bookkeeping)
are never written through here; each has its own path.

Every write records the previous values on its run, which is what makes it reversible and
therefore done for you by default. The runs are the record's write history — who, why, what
changed, what was there before — under a dedup key that names the record and the fields, so a
re-scored priority refreshes one pending card while a write to other fields on the same record
stands beside it.

The ladder keys each write on its type — `objects.update_meta.<objectType>` — so `product` can be
held at approval while `request` earns its way; a type with no rule reads the action's default.
See [trust](../entities/trust.md#the-agents-own-writes).

## Over MCP

### Where MCP sits

`/api/mcp` is a standard MCP server, and the standard splits the work in two. The server lists its
tools, each with a name, a description and a JSON schema for its arguments (`tools/list`), and runs
the one a caller names (`tools/call`). The server never chooses which MCP tool to run: the
`tools/call` request names it. Choosing a tool from a person's words is the job of the model on the
caller's side, such as Claude Code or Claude Desktop. A tool can still use a model once it runs:
`ask_workspace` routes the message to an agent, and that agent's model then picks from its own
tools to answer it.

Three things follow from that, and each one surprises people:

- **A caller does not need a model.** A backend can call a tool by name with one JSON-RPC POST and
  no handshake first, because the server is stateless. The `Accept` header has to list both
  `application/json` and `text/event-stream`, or the transport answers 406.
- **Agents Vocion runs itself don't reach their tools through `/api/mcp`.** Inside a turn, the agent's
  model picks from the internal registry (`services/agents/tools/registry.ts`). In-process the tool
  runs directly; on `agentcore-container` the call posts back to `/api/internal/agent-tools`
  ([Where an agent turn runs](../agent-execution.md)). `/api/mcp` is the door for outside callers,
  which includes an `external-worker` agent such as Claude Code: by design it reaches
  `propose_action` and `add_learning` by adding the Vocion MCP server
  ([ADR 0004](../adr/0004-external-worker-provider.md)).
- **Calling someone else's MCP server is a separate path.** An agent's tool call reaches another
  system's MCP server through a `kind: mcp` source ([MCP sources](./mcp-sources.md)), where Vocion
  is the client. The Slate integration (`libs/slate/recording.ts`) also calls Slate's MCP server
  from core code directly.

```bash
curl -s https://your-install/api/mcp \
  -H "Authorization: Bearer $VOCION_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"ask_workspace","arguments":{"message":"Where is the Q3 pricing deck?"}}}'
```

### Running as an agent

The agent tools in this guide are served by the MCP server (`/api/mcp`), running **as an agent**: the default is
the workspace's lead or `VOCION_MCP_AGENT_SLUG`, and every tool takes `agent_slug` to run as another
one, re-gated at call time. `file_ask` and `withdraw_ask` are present for every agent;
`update_object` only for one with object types, and only for those types. The MCP credential never
widens what the agent may do: a proposal from over MCP rides the same agent principal, at working
autonomy, judged by the same ladder.

### Asking the workspace

Working *as* an agent is one thing; asking one is another. `ask_workspace` takes a `message` and
runs one real turn — the same harness, tools, trust gating, enabled plugins and wiki mount the
dashboard chat runs — as the token's principal, and persists it as a conversation (surface `mcp`,
visible on `/dashboard/conversations`). Who answers is the **router's** call
([agent → Behaviour](../entities/agent.md#behaviour)): the message is matched against what each
agent `handles`, its description and its suggestions, a tie goes to the higher `initiative`, and
nothing convincing means the workspace's lead. The result carries the whole `reply` (no stream),
`agentSlug` and `agentName`, `routing` — the candidates considered, the chosen slug, `defaulted`,
one sentence of reason — `conversationId` to continue with, `turnId`, `traceId`, `actions` (anything
the agent filed for a person, with ids, statuses and inbox links), `url`, and, only when you asked
for them, `cards`. Pass `agent_slug` to skip the router, `conversation_id` to continue a thread (its
agent answers, no routing), `title` to name a new one, and `end_user_cards: true` if your app has
end users who tap buttons (default `false`: every card the agent puts up is filed to Review for a
person, and the result has no `cards` key). A turn longer than `VOCION_CHAT_TURN_LIMIT_MS` (120s) returns what was said so far
with `truncated: true`; the rest lands in the conversation when the turn finishes. With
`end_user_cards: true`, `cards` holds the cards put up before the cut; a card the agent puts up
after it has no reply left to ride on, so it is filed to Review as without cards. `list_agents` is
the roster the router chooses from — slug, name, `handles`, `initiative`, suggestions, `lead`.

### Running a card an end user tapped

A support chat in your own app can show the user the buttons an agent puts up, and run one when they
tap it. Ask with `ask_workspace` and `end_user_cards: true`; `cards` then lists each card the turn
put up for an action that opted in, as `{ id, label, actionId, actionLabel?, input, rationale?,
draft? }`. The agent writes its `label`, `rationale` and `input`, so show them as untrusted text; so is `draft.prompt`, which embeds the agent-written label, and your app sends it back as the user's words. A card whose input is not whole carries `draft.prompt`: send that back through
`ask_workspace` so the agent drafts it, because the card cannot run until then. Every other card
(an action that did not opt in) is filed to Review, as it always was. A card for an action that did
opt in but that the workspace turned off, or whose input names a `caller`, is marked unfiled: it is
never returned and never filed to Review. A card put up after the time limit has cut the reply is
filed to Review, whichever action it is for.

`run_workspace_card` runs one when the user taps it. It takes:

- `conversation_id`: the `conversationId` from the `ask_workspace` reply.
- `card_id`: the card's `id`.
- `caller`: `{ id, name, email }`, the end user as **your app** knows them.

The caller comes from your app and from nowhere else. It is never read from the model or from a
card's input (a card whose input carries a `caller` key is refused), and the action receives it as
`ctx.caller`. The tap goes through the same `proposeAction` as any other: the token's grant, the
gates and the audit row all apply.

A card is bound to the `caller.id` of its first tap, whatever that tap came to: a tap by a different
`caller.id` is refused with `CARD_NOT_AVAILABLE`, so each end user needs their own conversation.

**A tap is not a workspace person's approval.** The card was written by an agent that may have read
untrusted text (a Help Center article, the user's own message), and your end user is not a member of
the workspace. So the tap is proposed as the card's agent proposing it, never as a person's own word:
the action's declared gates and holds apply, and the workspace's autonomy ladder decides. At the
`execute-with-approval` rung the run **waits for a workspace person in Review**, the tap returns
`status: 'pending'`, and the action has not run (tell your user their request was received and is
waiting for review, not that it was done). The action runs at once on the tap only where the ladder
lets an agent's proposal run on its own: a kind set to `execute-within-bounds` or `autonomous` with
the agent's confidence in the card at or above the rung's floor, or a kind the ladder says nothing
about that can be undone and is low-risk, with the agent's confidence at or above the platform's default bar (0.8, or a per-kind bar; the platform's done-for-you default). A declared gate's
hold, or a card the agent gave no confidence for, keeps it waiting at any rung. When a person
approves the waiting run, the action still gets the user who tapped as `ctx.caller`.

It returns `{ conversationId, cardId, actionId, runId, status, outcome, result, error?, retryable?, underway? }`.
`retryable: true` comes only with status `failed`: offer your user Try again, which is a tap on the
same card. Without it, do not offer Try again.
`result` is what the action returned when this tap ran it, and `null` otherwise, including on
`already_decided`. `underway` is `{ line }`: the action's link to its run stays in the workspace.
Branch on `outcome` as well as `status`:

| `outcome` | Meaning |
|---|---|
| `created` | This tap made the run. It ran if `status` is `done` or `failed`; it is waiting for a person if `pending`. |
| `refreshed` | The card's earlier run was `pending` or had `failed`. It was updated in place and is `pending` for a person; this tap ran nothing. After a `retryable` failure (Try again) it ran again now if `status` is `done` or `failed`, and still waits for a person if `pending`. |
| `already_decided` | The card's earlier run, in any other status, is returned unchanged; this tap ran nothing. |
| `already_underway` | What was asked is already happening, or another tap on this card is running it right now; this tap ran nothing, so show `underway.line` even when `status` reads `done` or `pending`. |

`status` is `pending` (waiting for a workspace person in Review; the action has not run), `done` (it
ran), `failed` (the action did not complete and the run is recorded; `error` is fixed text, never the action's own message, which stays on the run for the workspace's people. Without `retryable`, it says a later tap puts the same request back in front of a workspace person in Review and does not run it again: tell your user it did not go through. With `retryable: true`, a service the action needs was busy or unreachable, so it may or may not have gone through: tell your user that, and that Try again cannot do it twice), `awaiting_execution` (a person approved it and
the work is waiting to be done), `rejected` or `undone`, and `executing` for an earlier tap's run
still going.

**One card, one run.** A second tap, or two at once, never starts a second run. If the earlier run is
`done`, `rejected`, `undone`, `executing` or `awaiting_execution`, the later call gets it back
unchanged (`already_decided`). If it is `pending`, or `failed`, the tap refreshes that same run and
it is `pending` for a person (`refreshed`), except TRY AGAIN: after a failure that came back with
`retryable: true`, the next tap is judged by the autonomy ladder again like the first and runs that
same run at once, or leaves it waiting in Review. A run stops coming back `retryable` after
`MAX_AUTOMATIC_ATTEMPTS` (3) failed tries, counting the first (`libs/actions/failureRecovery.ts`); any
other failed run goes to a workspace person in Review. Only a card minted for an end user on a turn that asked for `end_user_cards` can be run: a card filed to Review, deferred,
expired or never put up is refused, and so is any card the dashboard chat drew.

A refusal carries a typed code and nothing ran: `CONVERSATION_NOT_FOUND`, `CARD_NOT_FOUND`,
`CARD_NOT_AVAILABLE` (the card can no longer be run; the message says why), `CARD_NOT_RUNNABLE` (the
action behind a card that was put up is gone or is no longer card-runnable; tell your user it cannot
be done from the card), `WORKSPACE_PAUSED` (a workspace person has paused the workspace and the tap
would have run at once; nothing ran and the card's run is left `pending`. The message is fixed text (the card did not run, your request is kept) and never carries the pause note or who paused it and when. A tap after the workspace is
resumed refreshes that same run (`refreshed`, `pending`) and does not run it: a workspace person approves
it in Review. The paused tap itself leaves the card with no `runId` and no `lastAttempt` (the pause throws after the run exists, before the card is written); the next tap refreshes the run and stamps the card. Tell your user the request was received and cannot run right now), `ACTION_DISABLED`,
`CARD_NEEDS_DRAFT`, `CARD_INPUT_INVALID`, `CALLER_INVALID` (the tool's input
schema refuses a malformed caller; this is an action's own stricter rule), `FORBIDDEN` (the token
lacks the action's grant), `VALIDATION_FAILED`, `RETURNED_FOR_REVISION` (the workspace's own check sent the request back before it ran, so nothing ran; the message is fixed text, never the check's note to the agent; tell your user it could not be done as asked and was not carried out) and `UNKNOWN_ACTION`.
`INTERNAL_ERROR` is different: a server error the code did not expect, after which whether the card ran
is not known. Its message is fixed text and the real error is only in the server log; a repeat tap
never runs the card twice and says what happened.

**Opting an action in.** Set `cardRunnable: { callerSchema }` on the registered action
(`libs/actions/types.ts`); `callerSchema` is required, `CardCallerSchema` is the standard one to pass, and an action that
needs a real address can pass a stricter one. Nothing else changes: it is one field on the existing registry entry.
Three things the action writes reach the app's end user word for word, so keep them end-user safe (no
internal ids, links into the workspace, other people's data or a downstream system's error text): what
`execute` returns (`result`), the `line` from `underway`, and a `precheck` refusal's reason (sent as
`VALIDATION_FAILED: <reason>`). Errors `execute` throws never leave: a failed run answers fixed text. To offer Try again, also set
`retryableFailure(error)`: it reads the run's stored error and says yes only for a failure that is safe
to run again at once with the same input (nothing was written, or a repeat lands on the same record, as
`zendesk.create_ticket` does with its Idempotency-Key and external id). Such a failure answers
`retryable: true` with `CARD_RUN_RETRYABLE_MESSAGE`. It cannot be
combined with `ownsDedupKey`: such an action is treated as not card-runnable (its cards are not shown, they are filed
to Review without the end-user marker, and a tap on one is `CARD_NOT_FOUND`), because its own key would beat the per-card key and a refresh could execute it. **Turning it off
per workspace** uses the autonomy ladder: put the action below `execute-with-approval` (`observe`,
`recommend` or `assist` in `trust.yaml`) and its cards are not shown and a tap does not run.

### Deciding what waits on a person

The Review queue is decided the same way on every surface: the Review page, chat (`decide_proposal`,
`decide_ask`), the API and MCP. Over MCP, `review_list` and `review_get` read the queue
(`GET /api/v1/reviews`, `/api/v1/reviews/:kind/:id`). `review_decide` approves, rejects or closes a
hand-off (`POST /api/v1/reviews/decide`), and `ask_decide` answers an ask with one of its options
(`POST /api/v1/asks/:id/decide`). They run as the **token**, not an agent: each calls the same
function its API route calls, needs the same `approve` capability, and records the token as the
decider. `review-tools.test.ts` holds the parity table; a review verb added to one surface and not
the others fails it.

## Which tools a turn loads

An agent holds 90 to 135 tools; a turn does not carry all of them in full. On the direct Anthropic
API some are **deferred**: the model sees them only through Anthropic's tool search, and loads one
the moment it needs it. `harness.toolLoading` on the agent, or `defaults.toolLoading` on the
workspace, decides which ([ADR 0009](../adr/0009-tool-loading.md), `services/agents/toolLoading.ts`):

| Mode | Loaded in full |
|---|---|
| `history` (default) | What the agent used in its last 30 days, its grants, the tools its prompt names, and tools marked `alwaysLoaded`. An agent with no history loads everything. |
| `core` | The core tier (the action, ask and decision tools, `query_state`, `search_knowledge`, `lookup_objects`, `page_context`, `where_to`, `list_capabilities`, `describe_sources`), grants, tools named in the prompt, skills or playbooks, recent use, and every declared connector's tools, within 40 tools or 64k characters. The search note lists what is deferred, by family. |
| `all` | Everything (`toolSearch: false` means the same). |

```yaml
defaults:
  toolLoading: core # every agent in the workspace
---
harness:
  toolLoading: all # one agent, overriding the workspace
```

- **Over the budget**, `core` keeps the core tier, grants and named tools whatever it costs, then
  adds recent use, then whole connector families while they fit. A family that does not fit is
  deferred whole and named in the note. Grants and named tools alone over the budget are logged
  (`overBudget`); fix that in the agent (fewer grants, or a teammate).
- **A tool an agent must always see** is better named in its prompt or a skill than marked
  `alwaysLoaded`, which loads it for every agent.
- **What a turn did** is on its trace: the mode, how many tools were loaded and deferred, the tool
  searches it ran, calls to a tool it does not have, and tool errors. `run_meta` carries the
  loading.
- **Measure** an agent's catalog with `tsx src/scripts/measure-tools.ts [workspace-dir]`, and check
  a change with the `agent-behaviour` eval (`src/scripts/eval-agent-behaviour.ts`, needs
  `ANTHROPIC_API_KEY`). CI holds the catalog's caps (`toolMeasure.test.ts`).

## Related

[Trust rules](../entities/trust.md) · [Earned autonomy](./earned-autonomy.md) ·
[Needs you](./needs-you.md) · [Ask](../entities/ask.md) · [Object type](../entities/object-type.md) ·
[Agent](../entities/agent.md)
