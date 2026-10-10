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
| `recommend_action` | none on emit — the card files `propose_action` when tapped | Nothing until a person taps. | every agent (not over MCP) | — |
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

Data-room filing (`file_to_data_room`, `unfile_from_data_room`) and artifact editing
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

The same tools are served by the MCP server (`/api/mcp`), running **as an agent**: the default is
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
the agent filed for a person, with ids, statuses and inbox links) and `url`. Pass `agent_slug` to
skip the router, `conversation_id` to continue a thread (its agent answers, no routing), `title` to
name a new one. A turn longer than `VOCION_CHAT_TURN_LIMIT_MS` (120s) returns what was said so far
with `truncated: true`; the rest lands in the conversation when the turn finishes. `list_agents` is
the roster the router chooses from — slug, name, `handles`, `initiative`, suggestions, `lead`.

### Deciding what waits on a person

The Review queue is decided the same way on every surface: the Review page, chat (`decide_proposal`,
`decide_ask`), the API and MCP. Over MCP, `review_list` and `review_get` read the queue
(`GET /api/v1/reviews`, `/api/v1/reviews/:kind/:id`). `review_decide` approves, rejects or closes a
hand-off (`POST /api/v1/reviews/decide`), and `ask_decide` answers an ask with one of its options
(`POST /api/v1/asks/:id/decide`). They run as the **token**, not an agent: each calls the same
function its API route calls, needs the same `approve` capability, and records the token as the
decider. `review-tools.test.ts` holds the parity table; a review verb added to one surface and not
the others fails it.

## Related

[Trust rules](../entities/trust.md) · [Earned autonomy](./earned-autonomy.md) ·
[Needs you](./needs-you.md) · [Ask](../entities/ask.md) · [Object type](../entities/object-type.md) ·
[Agent](../entities/agent.md)
