/**
 * Shared types for the deepagents-based agent runtime (Phase 4+).
 *
 * Keep the wire shape (`AgentEvent`) compatible with the existing
 * `AskChat.tsx` consumer so the frontend doesn't have to change in
 * lock-step. New runtime, same events.
 */

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
  /** Short button label, e.g. "Draft the note to Carlo Marcelino". */
  label: string;
  /** One-line why. */
  rationale?: string;
  /** Agent confidence 0–1 from grounding quality. */
  confidence?: number;
  /** Recommending agent — reconstructs the propose principal on click. */
  agentSlug?: string;
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
 * `tool` = a generic tool call; `skill` = a `run_operation` skill
 * invocation (first-class, carries confidence); `search` = retrieval
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
  /** Incremental text for `reason`/`progress` nodes; the renderer appends. */
  delta?: string;
  /** Output summary — a count or short synopsis. Never a raw dump. */
  result?: string;
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
    | { type: 'response_delta'; delta: string }
    | { type: 'documents'; documents: SearchDocument[] }
    | { type: 'retrieval_progress'; stage: 'started' | 'candidates' | 'fused' | 'reranking' | 'complete'; meta?: Record<string, number | string> }
    | { type: 'skill_result'; skillResult: SkillResultEventPayload }
    | { type: 'recommended_action'; recommendation: RecommendedActionPayload }
    | TraceNodeEvent
    | { type: 'hitl_gate'; gate: HitlGatePayload }
    | { type: 'done'; response: string; traceId?: string }
    | { type: 'error'; message: string }
    /**
     * Runtime-internal (BYOA artifact → core provider): per-model-turn
     * token usage for budget charging. Consumed by the runtime provider,
     * never forwarded to the browser.
     */
    | { type: 'usage'; model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };

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
   * Per-user ACL for THIS request (SourceAccessService). When set, every
   * retrieval intersects with it. Unset for non-user runs (schedules).
   */
  allowedSourceSlugs?: string[];
  /** The mission this run belongs to (check/brief runs) — for mission-scoped tools. */
  missionSlug?: string;
  /** Object type slugs this agent can read. */
  objectTypeSlugs: string[];
  /** Per-agent retrieval tuning. */
  searchConfig: SearchConfig;
  /** Operation slugs this agent can invoke via the `run_operation` tool. */
  operationSlugs: string[];
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
    excludeTools?: string[];
    model?: string;
  };
  /**
   * Side-channel for emitting structured events the LLM stream can't
   * naturally produce (documents sidebar, skill_result cards). Tool
   * implementations call this; the runtime forwards to the SSE client.
   */
  emit: (event: AgentEvent) => void;
};
