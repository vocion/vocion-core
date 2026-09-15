/**
 * Shared types for the chat surface.
 *
 * Phase C decomposition: the original AskChat.tsx (1898 LOC) declared
 * all four of these inline. Extracting them here lets every child
 * component import without dragging in the orchestrator.
 */

export type IndexedDocument = {
  document_id: string;
  semantic_identifier: string;
  link: string;
  source_type: string;
  blurb: string;
  metadata?: Record<string, string>;
  updated_at?: string;
  /** Global 1-based citation number for the turn — matches the inline `[n]` marker in the answer. */
  citationIndex?: number;
  /** Specialist that surfaced this source (set only when a delegate's search found it). */
  foundBy?: string;
};

export type ThinkingStep = {
  type: 'thinking' | 'search' | 'skill';
  content: string;
  documents?: IndexedDocument[];
  queries?: string[];
  skillSlug?: string;
};

export type SkillResult = {
  skillName: string;
  skillSlug: string;
  runId: number;
  content: string;
  status: 'pending' | 'auto';
  prospectName?: string;
  prospectCompany?: string;
};

/** One run inside an assistant message: either a text chunk or an inline tool breadcrumb. */
export type AgentRun
  = | { type: 'text'; text: string }
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string; state?: 'pending' | 'done' | 'error' };

/** A source surfaced by an actor during the turn (bubbles into the trace). */
export type TraceCitation = {
  sourceType: string;
  title: string;
  link?: string;
  snippet?: string;
  actorId: string;
};

/**
 * One node in the hierarchical activity trace (reasoning / tool / skill /
 * search / delegation / draft), attributed to the lead or a specialist and
 * nested via `parentId`. Folded from `trace_node` SSE events in ChatShell.
 */
export type TraceNode = {
  id: string;
  parentId?: string;
  actor: { id: string; kind: 'lead' | 'specialist'; name: string };
  kind: 'reason' | 'tool' | 'skill' | 'search' | 'delegate' | 'draft';
  status: 'start' | 'progress' | 'done' | 'error';
  label: string;
  detail?: string;
  /** Raw tool name + compact args + curated result preview for the call-detail drill. */
  tool?: string;
  args?: string;
  resultDetail?: string;
  /** Accumulated reasoning text (from `delta` progress events). */
  text?: string;
  result?: string;
  confidence?: number;
  citations?: TraceCitation[];
};

/** A2UI: a one-tap recommended action rendered as a card in the answer. */
export type RecommendedAction = {
  actionId: string;
  input: Record<string, unknown>;
  label: string;
  rationale?: string;
  confidence?: number;
  agentSlug?: string;
};

/** How recommended actions behave in a thread (0094). Mirrors `CONVERSATION_AUTONOMY` on the server. */
export type ConversationAutonomy = 'ask' | 'act-within-bounds';

/**
 * A record the person pointed the conversation at — an `@` tag in the
 * composer, or the page they are on (R4's page-context model reads the same
 * shape). `type` is the dashboard entity family; `id` its slug or numeric id.
 */
export type ContextRef = {
  type: 'agent' | 'team' | 'mission' | 'ask' | 'object' | 'briefing' | 'deal' | 'page';
  id: string;
  label: string;
  /** For a team: the agent slug a `@team` tag routes the turn to (its lead). */
  routeTo?: string;
};

export type ChatMessage = {
  /** Persisted row id, once known — the feedback control writes against it. */
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  /** The person's thumb on this turn (assistant rows only), as stored. */
  feedback?: { rating: 'up' | 'down' | null; note: string | null };
  /** When a turn was routed to a specialist (`@agent`), who answered — rendered as the speaker (§9). */
  agentSlug?: string;
  agentName?: string;
  /** A2UI recommended-action cards emitted during this turn (clickable). */
  recommendations?: RecommendedAction[];
  documents?: IndexedDocument[];
  citationCount?: number;
  thinkingSteps?: ThinkingStep[];
  thinkingSeconds?: number;
  skillResults?: SkillResult[];
  /** v0.2+ inline tool breadcrumb runs (rev-ai style). Optional for back-compat with older messages. */
  runs?: AgentRun[];
  /**
   * Typed hierarchical activity trace for this turn — the reasoning, tool
   * calls, skills, searches (with citations), and delegations (with the
   * delegate's own nested work). Folded from `trace_node` events; supersedes
   * the flat `runs`/`thinkingText` for the WorkTimeline when present.
   */
  trace?: TraceNode[];
  /**
   * Accumulated chain-of-thought text streamed via `thinking_delta`
   * events (Anthropic extended thinking — only present when the server
   * runs with VOCION_THINKING_BUDGET set). Rendered as the "Reasoning"
   * step at the top of the WorkTimeline.
   */
  thinkingText?: string;
  /** Agent's self-assessment of this turn's confidence (N.2). Null when the runtime didn't expose a signal. */
  confidence?: 'confident' | 'uncertain' | 'speculative' | null;
};

export type AgentOption = {
  slug: string;
  name: string;
  icon: 'bot' | 'search';
  placeholder: string;
  /** Small context label (e.g. "RevOps · Follow-Up"). Data-in; the stripped-down surface doesn't render it. */
  eyebrow?: string;
  /** One-line scope of the agent. Data-in; the stripped-down surface doesn't render it. */
  description?: string;
  /** Empty-state one-click prompts, authored per agent in the workspace. */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Team role — leads sort first and are the default point of contact. */
  role?: 'lead' | 'specialist';
  /** Slug of the primary this agent reports to. Undefined = a primary/coordinator. */
  parentSlug?: string;
  /** The workspace this agent belongs to — the ONE name the chat surface speaks as (§9.10). */
  workspaceName?: string;
};

/** HITL gate event payload — emitted by request_human_review tool. */
export type HitlGatePayload = {
  name: string;
  question: string;
  payload?: Record<string, unknown>;
  resumeUrl?: string;
};

/** Streaming lifecycle phase for the composer + thinking panel. */
export type StreamingPhase = 'idle' | 'thinking' | 'searching' | 'answering';
