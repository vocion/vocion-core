/**
 * Shared types for the deepagents-based agent runtime (Phase 4+).
 *
 * Keep the wire shape (`AgentEvent`) compatible with the existing
 * `AskChat.tsx` consumer so the frontend doesn't have to change in
 * lock-step. New runtime, same events.
 */

import type { SelfUpdateReceipt } from '@/libs/actions/selfUpdate';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';

export type { SelfUpdateReceipt };

/* ------------------------------------------------------------------ */
/* Event shape — what the SSE adapter emits over the wire             */
/* ------------------------------------------------------------------ */

export type SearchDocument = {
  document_id: string;
  semantic_identifier: string;
  link: string;
  source_type: string;
  blurb: string;
  metadata?: Record<string, unknown>;
  updated_at?: string;
  /**
   * Global 1-based citation number for THIS turn — matches the `[n]` marker
   * the model is instructed to cite inline, so the UI can map a tapped marker
   * to this source. Stable across multiple searches in one turn.
   */
  citationIndex?: number;
  /** Display name of the specialist that surfaced this source (set only when a delegate's search found it). */
  foundBy?: string;
};

export type SkillResultEventPayload = {
  skillName: string;
  skillSlug: string;
  runId: number;
  content: string;
  status: 'pending' | 'auto';
  prospectName?: string;
  prospectCompany?: string;
};

/**
 * A2UI: an actionable recommendation rendered as a clickable card in the chat
 * answer. NO side effect on emit — the gated review item (action_run) is
 * JIT-created only when the user taps the card (review.propose), reusing the
 * agent's authority so it lands `pending` for approval like any agent proposal.
 */
export type RecommendedActionPayload = {
  /** Registered action to propose on click, e.g. 'gmail.send'. */
  actionId: string;
  /** Pre-filled payload for that action (draft to/subject/body, CRM props, …). */
  input: Record<string, unknown>;
  /** Short button label, e.g. "Draft the note to Nadia Brandt". */
  label: string;
  /** One-line why. */
  rationale?: string;
  /** Agent confidence 0–1 from grounding quality. */
  confidence?: number;
  /** Recommending agent — reconstructs the propose principal on click. */
  agentSlug?: string;
  /**
   * Set when the server already filed this recommendation into the review
   * queue (conversation autonomy `act-within-bounds`): the card shows the
   * run's status instead of a "Prepare" button. Additive; absent on tap-mode.
   */
  runId?: number;
  /**
   * What the agent thinks a reviewer should do with this once it is filed,
   * and one short sentence for why — the agent's own answer, asked for by
   * `recommend_action`. They travel together: filing this card sends them as
   * the proposal's recommendation.
   *
   * Optional on the type because an event can arrive without them (an older
   * client, a model that skipped the field). The card then files with no
   * recommendation rather than one core invented for it.
   */
  suggestedDecision?: SuggestedDecision;
  suggestedDecisionReason?: string;
  /** The page of the record the card is about (a feature, a deal) — the card's title links there. */
  href?: string;
  /** The words on that link, from the page's name: "Open feature". */
  hrefLabel?: string;
  /**
   * DRAFT NEEDED: a filing that still misses its type's bar after the typed
   * pass (`cardBackstop.ts`). Nothing is filed; the card's one button sends
   * `prompt` to the agent, which drafts the full record in the conversation
   * (Chris, 2026-09-28: "not a card: this request fails the proposal-ready
   * bar" was a dead line). `missing` is what the bar said.
   */
  draft?: { prompt: string; missing: string };
};

/**
 * One live artifact — a table, a markdown note, a chart, a record card, a
 * link, a file — persisted as an `artifact` row (0095) with a version
 * history (0101), and emitted so the pane beside the conversation opens on
 * it and the message gets a chip. `spec` is the card payload without its
 * `__card` slug; the client resolves it through `libs/cards` with
 * `cardPayloadFor(kind, spec)`.
 */
export type ArtifactPayload = {
  id: number;
  conversationId: number | null;
  kind: 'table' | 'markdown' | 'chart' | 'record' | 'link' | 'file' | 'sequence' | 'document' | 'mission' | 'playbook';
  title: string;
  spec: Record<string, unknown>;
  url?: string | null;
  /**
   * The external link an image arrived with, when Vocion copied its bytes
   * and `url` now serves the copy (0151). Absent on payloads built before.
   */
  sourceUrl?: string | null;
  /**
   * The RECORD this artifact belongs to (0112), when it belongs to one rather
   * than only to a conversation — `{ type, id }` of a `RecordRef`, plus what
   * the artifact IS to that record (`brief` | `recommendation` | `sequence`).
   */
  recordType?: string | null;
  recordId?: string | null;
  recordRole?: string | null;
  /** The assistant turn that produced this version — where the chip hangs in the transcript. */
  messageId: number | null;
  /** Path-like grouping in the artifacts log, e.g. `revenue/weekly`. */
  folder: string | null;
  /** Head version number. */
  version: number;
  authorKind: 'agent' | 'human' | 'system';
  authorId: string | null;
  /** Who a share opens for (`libs/share/audience.ts`). Absent on payloads built before sharing existed. */
  shareAudience?: 'me' | 'workspace' | 'anyone';
  shareOwnerId?: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Typed hierarchical trace — reasoning / tools / skills / delegation  */
/* / citations, attributed to an actor (lead or a specialist) and      */
/* nested via parentId. Consumed by the chat WorkTimeline renderer.    */
/* ------------------------------------------------------------------ */

export type TraceActor = {
  /** Stable actor id — 'lead' for the front-door agent, or the delegation node id for a specialist. */
  id: string;
  kind: 'lead' | 'specialist';
  /** Human display name (agent/subagent). */
  name: string;
};

export type TraceCitation = {
  /** Source system, e.g. 'granola' | 'hubspot' | 'gmail' | 'web'. */
  sourceType: string;
  /** Human title/identifier of the cited doc. */
  title: string;
  link?: string;
  snippet?: string;
  /** Which actor surfaced it (lead or a specialist) — so the UI can attribute delegate citations. */
  actorId: string;
};

/**
 * What a trace node represents. `reason` = model chain-of-thought;
 * `tool` = a generic tool call; `skill` = a skill read; `search` = retrieval
 * (produces citations); `delegate` = a `task` dispatch to a specialist
 * (children hang under it via parentId); `draft` = a proposed action.
 */
export type TraceNodeKind = 'reason' | 'tool' | 'skill' | 'search' | 'delegate' | 'draft';

/**
 * One node in the hierarchical activity trace. Emitted repeatedly as it
 * progresses — the renderer keys on `id` and folds `start → progress* →
 * done`. `label` tense is a pure function of `status`, so a node reads
 * "Searching…" while active and "Searched" only when done (no more
 * past-tense-while-running bug). `parentId` nests delegate work.
 */
export type TraceNodeEvent = {
  type: 'trace_node';
  id: string;
  parentId?: string;
  actor: TraceActor;
  kind: TraceNodeKind;
  status: 'start' | 'progress' | 'done' | 'error';
  label: string;
  /** Input summary — the query, the record type, the delegate brief. Never a raw dump. */
  detail?: string;
  /** Raw tool name (e.g. `lookup_objects`) — shown in the call-detail drill. */
  tool?: string;
  /** Compact input args for the call-detail drill (e.g. `{"type_slug":"follow-up"}`). Never a raw dump. */
  args?: string;
  /** Curated result preview for the drill — record names / hit titles, never raw JSON. */
  resultDetail?: string;
  /** Incremental text for `reason`/`progress` nodes; the renderer appends. */
  delta?: string;
  /**
   * Where a long call has got to, as a plain phrase — `sheet 7 of 12`. Shown
   * on the running step line after its label, never as a second surface.
   * Cleared when the step lands.
   */
  progress?: string;
  /** Output summary — a count or short synopsis. Never a raw dump. */
  result?: string;
  /**
   * Both tenses of the step's name, once known (`libs/chat/stepLabels.ts`):
   * `label` is the one for the current status; a renderer that has the pair
   * re-derives it when the status changes.
   */
  labels?: { running: string; done: string };
  /** For skills / drafts / delegates. */
  confidence?: number;
  /** Sources this node surfaced — bubbles up to the message-level "Grounded in". */
  citations?: TraceCitation[];
};

export type HitlGatePayload = {
  /** Unique name for the gate, e.g. 'blueprint-review' or 'send-email'. */
  name: string;
  /** Human-readable summary of what is being asked. */
  question: string;
  /** Free-form payload the UI renders (deck preview, draft email, etc.). */
  payload?: Record<string, unknown>;
  /** Optional URL for the UI to deep-link to (workflow run, deck edit page, etc.). */
  resumeUrl?: string;
};

export type AgentEvent
  = | { type: 'thinking' }
    /**
     * Incremental chunk of the model's chain-of-thought (Anthropic
     * extended thinking). Only emitted when `VOCION_THINKING_BUDGET`
     * is set — see `libs/llm/langchain.ts`. Never contains response
     * text; response text streams separately as `response_delta`.
     */
    | { type: 'thinking_delta'; delta: string }
    | { type: 'tool_start'; tool: string; input: Record<string, unknown> }
    | { type: 'tool_end'; tool: string; input: Record<string, unknown>; output: string }
    | { type: 'subagent_start'; name: string }
    | { type: 'subagent_end'; name: string }
    | { type: 'answering' }
    /** What the turn is doing right now, in words, for the live status line ("Writing the decision cards"). */
    | { type: 'status'; label: string }
    | { type: 'response_delta'; delta: string }
    | { type: 'documents'; documents: SearchDocument[] }
    | { type: 'retrieval_progress'; stage: 'started' | 'candidates' | 'fused' | 'reranking' | 'complete'; meta?: Record<string, number | string> }
    | { type: 'skill_result'; skillResult: SkillResultEventPayload }
    | { type: 'recommended_action'; recommendation: RecommendedActionPayload }
    /**
     * A card in front of the person (backlog 025) — the typed form every
     * producer's recommendation becomes at the route. `card_update` moves
     * its state (filed with a proposal id, decided, deferred) without
     * re-rendering the turn.
     */
    | { type: 'card'; card: import('@/libs/cards/card').Card }
    | { type: 'card_update'; cardId: string; state?: import('@/libs/cards/card').CardState; runId?: number; reason?: string; ref?: { type: string; id: number }; decision?: { action: string; at: string; by?: string }; answer?: { optionId: string; text: string; at: string; by?: string } }
    /**
     * An artifact was created or changed (0095/0101). The pane beside the
     * conversation opens or switches to it and the message gets a chip.
     *
     * `pending` marks a placeholder emitted BEFORE the content is written —
     * the title is known, the body is not — so a long markdown write shows a
     * shell filling in rather than nothing. `delta` appends to the pending
     * body. Both are folded by `mergeArtifactEvent` in
     * `features/dashboard/chat/traceReducer.ts`; the settled event that
     * follows carries the real row.
     */
    | { type: 'artifact'; artifact: ArtifactPayload; pending?: boolean; delta?: string }
    | TraceNodeEvent
    /**
     * The system improved ITSELF during this turn — a wiki page, a mission's
     * notes, a playbook, an agent's own instructions, a remembered rule, a
     * capability. Rendered as one quiet chip under the turn that did it, with
     * Undo on each entry; several in a turn group into that one chip rather
     * than stacking. The payload is built by
     * `libs/actions/selfUpdate.ts#selfUpdateReceipt`, so the chip, the
     * Activity row and the review toast say the same words about the run.
     */
    | { type: 'self_update'; selfUpdate: SelfUpdateReceipt }
    | { type: 'hitl_gate'; gate: HitlGatePayload }
    /**
     * One tool call failed, reported by the BYOA artifact. Unlike `error` the
     * turn continues: the model is handed the failure as that tool's output
     * and can react to it.
     *
     * It exists because that output text was the only signal, and nothing
     * obliges a model to relay it — so an unreachable tool endpoint reads as a
     * confident, ungrounded answer rather than a broken deployment. The usual
     * cause is a `VOCION_TOOL_ENDPOINT_URL` that AWS cannot reach, where every
     * tool fails identically. The runtime provider logs it, so that case stays
     * diagnosable without depending on the model's cooperation.
     */
    | { type: 'tool_error'; tool: string; message: string; status?: number }
    /**
     * A long tool call saying where it has got to: `render_document` is on
     * sheet 7 of 12, `red_team_document` is reading 7 sheets. One step line,
     * more information on it — "'working…' isn't much info" (Chris, twice,
     * 2026-09-18).
     *
     * It carries no node id because a tool does not know its own: the client
     * attaches the note to the in-flight step with this tool name, exactly
     * the way `tool_error` closes one (`noteToolProgress` in
     * `features/dashboard/chat/traceReducer.ts`). Advisory — a dropped or
     * duplicated note only changes what the line said for a second, and the
     * step's own start/done events remain the record.
     *
     * Only emit it from a loop that REALLY runs: a note is a fact about the
     * work, not an animation.
     */
    | { type: 'step_progress'; tool: string; note: string }
    /**
     * Approved learnings were mounted for this turn. Silent by design: the
     * chat transcript ignores it; the adoption surfaces (Phase 2 growing-
     * memory panel) are its consumers. `paths` lists the mounted memory
     * files (`/learnings/…`, later `/memories/…`).
     */
    | { type: 'memories_mounted'; paths: string[] }
    /** Which model answers this turn, and how hard it thinks — shown on the turn (`libs/llm/modelPrefs.ts`). */
    /** A tool made a record the person will want to open — a data room, a proposal. The client shows a chip and peeks it; the run links it in the answer. */
    /** The model is writing a tool call — its name is known before the call completes; a long argument (a whole document) otherwise reads as 'Working'. */
    | { type: 'composing'; tool: string }
    | { type: 'record_created'; record: import('@/services/chat/pageContext').RecordRef }
    /**
     * A write in this turn made a new version of something a page may be
     * showing — a record (its body artifact) or an artifact (backlog 035).
     * The page or pane showing `ref` refetches in place and marks what
     * changed between `from` and `to`; the answer links version `to` in the
     * history. `fields` names what the write touched, for a record.
     */
    /**
     * A version of a record or artifact was written. `related` (the tool's
     * name) marks a write BENEATH the page's record rather than a version of
     * it — a plan filed for the request, a card on it decided — so the page
     * showing it refetches (conversation 378); `from`/`to` are then 0 and
     * name no version.
     */
    | { type: 'version_written'; ref: import('@/services/chat/pageContext').RecordRef; artifactId: number; from: number | null; to: number; fields?: string[]; related?: string }
    /**
     * Record mentions in the finished answer ("#201", "request 201") and the
     * page each opens — applied to the answer's text, live and stored
     * (`libs/chat/recordMentions.ts`), so a record the answer names is one
     * click away.
     */
    | { type: 'record_links'; links: Array<{ text: string; href: string }> }
    /**
     * The records this turn filed or changed, once the answer is done — one
     * microcard each under the turn, with the record's live status where its
     * type has a report page (`libs/factory/liveStatus.ts`). Typed from the
     * turn's own `record_created` and `version_written` events, never read
     * from the answer's words.
     */
    | { type: 'turn_records'; records: import('@/libs/factory/liveStatus').TurnRecord[] }
    | { type: 'run_meta'; model: string; provider: string; strength: 'fast' | 'balanced' | 'deep'; thinking: 'off' | 'low' | 'medium' | 'high' }
    /**
     * The workspace chose the agent for this turn because nobody named one
     * (`services/agents/router.ts`). First frame of such a turn: the client
     * attributes the reply to the chosen agent ("via Wiki researcher") and
     * the decision — candidates, pick, reason — is on the message row.
     */
    | { type: 'routed'; routing: import('./router').RoutingDecision; agent: { slug: string; name: string } }
    /**
     * Who speaks this turn — the agent the runtime is about to run, whether a
     * person named it, the workspace chose it, or it is the conversation's
     * own. Sent on every turn, before the first token, and stamped on the
     * assistant row as `agent_slug`, so the live transcript and the reloaded
     * one attribute the turn from the same fact (backlog 009).
     */
    | { type: 'turn_agent'; agent: { slug: string; name: string } }
    | { type: 'done'; response: string; traceId?: string }
    /**
     * The turn ended badly. `ending` says HOW, in the same words the row will
     * be stored with (`services/chat/turnStatus.ts`) — so the live transcript
     * and the reloaded one say the same thing. Absent from a runtime that
     * predates the vocabulary, which reads as `incomplete`.
     */
    | { type: 'error'; message: string; ending?: import('@/services/chat/turnStatus').TurnStatus }
    /**
     * Runtime-internal (BYOA artifact → core provider): per-model-turn
     * token usage for budget charging. Consumed by the runtime provider,
     * never forwarded to the browser.
     */
    | { type: 'usage'; model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };

/* ------------------------------------------------------------------ */
/* Runtime context — what tool factories close over                    */
/* ------------------------------------------------------------------ */

export type SearchConfig = {
  recencyDecay?: number;
  sourceWeights?: Record<string, number>;
  maxResults?: number;
  minRelevance?: number;
};

export type RuntimeContext = {
  /** Tenant scope — every DB read/write filters by this. */
  orgId: string;
  /** Who triggered the run (user id, 'mcp', 'scheduled', etc.). */
  userId?: string;
  /** The agent this graph belongs to — stamps proposals/audit (`agent:<slug>`). */
  agentSlug?: string;
  /** Configured source slugs (knowledge_source.slug) this agent may reach. */
  connectorSources: string[];
  /**
   * The connector kind of each slug in `connectorSources`, resolved once at
   * graph build (`libs/connectors/families.ts`), so the synchronous tool
   * builder can tell which sources are a code host, an issue tracker or a
   * chat. Absent on an older context: the slug is then read as the kind.
   */
  sourceKinds?: Record<string, string>;
  /**
   * Per-user ACL for THIS request (SourceAccessService). When set, every
   * retrieval intersects with it. Unset for non-user runs (schedules).
   */
  allowedSourceSlugs?: string[];
  /** The mission this run belongs to (check/brief runs) — for mission-scoped tools. */
  missionSlug?: string;
  /** The mission_run driving this turn — audit trails (`assessed_by`) point back to it. */
  missionRunId?: number;
  /**
   * Set by the automations' recording pass when it has fetched the task's
   * screenshots and put them in front of the model: evidence opened in this
   * turn, which record_verdict's "opened none" rule accepts without reading
   * tool_call rows back.
   */
  evidenceOpened?: boolean;
  /** A verdict in this run has been shown the task's stored run of its named tests (record_verdict). */
  testRunShown?: boolean;
  /**
   * The sources this turn has opened (`wiki:<slug>`, `artifact:<id>`), noted
   * as each read returns — the evidence a gate's `readThisTurn` checks
   * (`services/gates/turnReads.ts`).
   */
  turnReads?: string[];
  /** Persisted conversation this turn belongs to — stamped on tool_call rows. */
  conversationId?: number;
  /**
   * Where the person is in the app for THIS turn (page, record, selection,
   * @-mentions) — read by the `page_context` tool. Set per request in
   * `compileAgentForRequest`; undefined for schedules, MCP and API callers.
   */
  pageContext?: import('@/services/chat/pageContext').PageContext;
  /**
   * The person's message THIS turn, as typed — what a gate on the turn's own
   * ask reads (`anchoredFiling.ts`: "Change this: …" is a change, never a new
   * filing). Set per request in `compileAgentForRequest`; undefined for
   * schedules and out-of-process tool calls, which read the conversation's
   * latest person message instead.
   */
  turnMessage?: string;
  /**
   * What the person wants from this turn, read by a model at its start
   * (`turnJudge.readIntent`). Tools that act on the person's meaning read
   * this, never their words by pattern. Absent off the in-process loop.
   */
  turnIntent?: Promise<import('./turnJudge').TurnIntent>;
  /**
   * The zone THIS turn's dates are judged in: the person's browser zone when
   * a turn carries one, else the workspace's (`defaultTimeZone`). Set per
   * request in `compileAgentForRequest`; the tools read it at call time.
   */
  timeZone?: string;
  /** The workspace's zone (`project.time_zone`), resolved once at graph build. */
  defaultTimeZone?: string;
  /** Which harness runs the loop — stamped on tool_call rows. */
  provider?: 'local' | 'agentcore' | 'runtime';
  /** Langfuse trace id of the current turn — links tool_call rows to cost/latency. */
  traceId?: string;
  /**
   * Per-request map of delegation taskId → specialist agent name, populated
   * as `task` calls start. The tool-call record uses it to attribute a
   * nested call to the specialist that made it rather than the lead.
   */
  delegations?: Map<string, string>;
  /** Object type slugs this agent can read. */
  objectTypeSlugs: string[];
  /**
   * Object types that are filed through their own typed tool (`file_<slug>`,
   * `tools/fileRecord.ts`): the tool's schema derived from the type's, with
   * reference fields resolved to the workspace's record slugs. Resolved once
   * per graph build; absent means no typed filing tools.
   */
  filingTypes?: import('./tools/fileRecord').FilingType[];
  /**
   * The `rest` sources this agent's `connectorSources` name, with their
   * declared endpoints (`tools/restDirect.ts`): one live read tool per
   * `tools[]` entry and an action catalog per source. Resolved once per
   * graph build like `filingTypes`, because the declarations live on the
   * source row and the tool builder is synchronous; absent means no REST
   * tools.
   */
  restSources?: import('@/libs/rest/spec').RestSourceSpec[];
  /**
   * Plugins the workspace has on (`project.enabled_plugins`), resolved once at
   * graph build. Plugin-owned tool sets (wiki, data rooms) are present only
   * when their plugin is; `list_capabilities` reads it to say what is off.
   */
  enabledPlugins?: string[];
  /** Per-agent retrieval tuning. */
  searchConfig: SearchConfig;
  /**
   * Per-agent harness knobs (`agent.harness_config`, authored as the
   * `harness:` block in workspace YAML). `interrupts` lists operation
   * slugs that must pause for human approval (hitl_gate) before
   * executing; `maxTokens` caps the model's output for this agent.
   */
  harnessConfig: {
    provider?: 'local' | 'agentcore' | 'runtime';
    interrupts?: string[];
    maxTokens?: number;
    /** Graph steps one turn may take; unset keeps each provider's own backstop. See `stepLimit.ts`. */
    maxSteps?: number;
    excludeTools?: string[];
    /** Granted-only tools this agent receives (gated tools are absent unless named here). */
    grantTools?: string[];
    model?: string;
    /** Cache this agent's prompt prefix at the vendor; unset means the process default (on). See `libs/llm/promptCache.ts`. */
    promptCache?: boolean;
    /** Run the zero-card backstop pass after turns that emit no recommend_action (see workspace schema doc). */
    recommendActionBackstop?: boolean;
    /** Action kinds this agent earns trust for on its own ledger (`<kind>.<agent-slug>`); see the workspace schema. */
    ownLedger?: string[];
  };
  /**
   * Side-channel for emitting structured events the LLM stream can't
   * naturally produce (documents sidebar, skill_result cards). Tool
   * implementations call this; the runtime forwards to the SSE client.
   */
  emit: (event: AgentEvent) => void;
  /**
   * Per-turn global citation counter. `search_knowledge` allocates a
   * contiguous block for each call so the `[n]` numbers the model sees (and
   * is instructed to cite inline) stay unique + stable across multiple
   * searches in one turn. Starts at zero in each request's own context
   * (`compileAgentForRequest`), so one turn's numbers are only ever its own.
   */
  citationSeq: { current: number };
};
