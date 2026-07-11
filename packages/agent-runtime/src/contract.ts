/**
 * Wire contract for the Vocion BYOA agent runtime.
 *
 * The runtime is a GENERIC artifact: it holds no agent definitions, no
 * database access, and no tenant state. Everything an invocation needs
 * arrives in the request payload — the agent definition (compiled from
 * workspace YAML by vocion-core), the mounted files, the tool catalog,
 * and an opaque signed tenant claim the runtime forwards on every tool
 * call but never inspects.
 *
 * `AgentEvent` mirrors vocion-core's `services/agents/types.ts` — the
 * SSE contract the chat UI consumes is frozen (the core provider relays
 * these verbatim, minus runtime-internal events like `usage`). Keep the
 * two in sync when either changes.
 */

/* ------------------------------------------------------------------ */
/* Events                                                              */
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

export type HitlGatePayload = {
  name: string;
  question: string;
  payload?: Record<string, unknown>;
  resumeUrl?: string;
};

export type AgentEvent
  = | { type: 'thinking' }
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
    | { type: 'hitl_gate'; gate: HitlGatePayload }
    | { type: 'done'; response: string; traceId?: string }
    | { type: 'error'; message: string }
    /**
     * Runtime-internal: per-model-turn token usage, emitted so the
     * caller (vocion-core's runtime provider) can charge agent budgets.
     * Never forwarded to the browser.
     */
    | { type: 'usage'; model: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };

/* ------------------------------------------------------------------ */
/* Invocation payload                                                  */
/* ------------------------------------------------------------------ */

export type AgentDefinition = {
  slug: string;
  name: string;
  /** The agent's authored system prompt (workspace YAML → agent row). */
  systemPrompt: string;
  /** Model id override (provider-interpreted); runtime default applies when unset. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  subagents?: Array<{ name: string; description: string; systemPrompt: string }>;
  /** deepagents built-in tool names to withhold from the catalog. */
  excludeTools?: string[];
};

export type ToolCatalogEntry = {
  name: string;
  description: string;
  /** JSON Schema for the tool's input (z.toJSONSchema output on the core side). */
  inputSchema: Record<string, unknown>;
};

export type MountedFile = {
  content: string;
  mimeType: string;
  created_at: string;
  modified_at: string;
};

export type InvocationRequest = {
  version: 1;
  agent: AgentDefinition;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Playbooks + learnings, pre-rendered by core (deepagents FileData shape). */
  files?: Record<string, MountedFile>;
  tools: {
    /** Where the runtime executes domain tools (core's claim-verified tool API, or a Gateway). */
    endpoint: string;
    catalog: ToolCatalogEntry[];
    /** Signed tenant claim — opaque here; verified by the tool endpoint. */
    claim: string;
  };
  /** Non-authoritative tags for tracing (authority lives in the claim). */
  trace?: { orgId: string; userId: string; sessionId?: string };
  sessionId?: string;
};

/** Tool endpoint response: the tool's output plus any side-channel events it emitted. */
export type ToolCallResult = {
  output: string;
  events?: AgentEvent[];
};
