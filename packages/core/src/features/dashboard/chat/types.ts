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

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  documents?: IndexedDocument[];
  citationCount?: number;
  thinkingSteps?: ThinkingStep[];
  thinkingSeconds?: number;
  skillResults?: SkillResult[];
  /** v0.2+ inline tool breadcrumb runs (rev-ai style). Optional for back-compat with older messages. */
  runs?: AgentRun[];
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
  /** Small label above the agent name in the chat header (e.g. "RevOps · Follow-Up"). */
  eyebrow?: string;
  /** One-line scope shown under the agent name in the chat header. */
  description?: string;
  /** Empty-state one-click prompts, authored per agent in the workspace. */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Team role — leads sort first and are the default point of contact. */
  role?: 'lead' | 'specialist';
  /** Slug of the primary this agent reports to. Undefined = a primary/coordinator. */
  parentSlug?: string;
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
