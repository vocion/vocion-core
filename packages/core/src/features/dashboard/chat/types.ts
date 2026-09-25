/**
 * Shared types for the chat surface.
 *
 * Phase C decomposition: the original AskChat.tsx (1898 LOC) declared
 * all four of these inline. Extracting them here lets every child
 * component import without dragging in the orchestrator.
 */

import type { SelfUpdateReceipt } from '@/libs/actions/selfUpdate';
import type { TurnStatus } from '@/services/chat/turnStatus';

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
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string; state?: 'pending' | 'done' | 'error' }
    /** A card the turn put up (backlog 025) — rendered from the row after a reload. */
    | { type: 'card'; id?: string; kind?: string; label: string; actionId: string; input?: Record<string, unknown>; runId?: number; state?: string }
    /** A person's decision on a card, written as a user turn. */
    | { type: 'card_decision'; cardId: string; action: string; runId?: number; label?: string };

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
  /**
   * Where the call has got to while it runs — `sheet 7 of 12`. Rendered after
   * the label on the live step line (`stepProgressLabel`) and dropped the
   * moment the step lands, so a finished trace never keeps a stale count.
   */
  progress?: string;
  result?: string;
  /** Both tenses of the step's name, once known; `label` is re-derived from it as the status changes. */
  labels?: { running: string; done: string };
  confidence?: number;
  citations?: TraceCitation[];
  /**
   * Where this step sits in the answer: how many text runs of the reply had
   * started when the step began. `0` is "before the first words"; `n` is
   * "after the n-th passage". The transcript renders each group of steps at
   * that point, between the passages, in the order things actually happened
   * (`interleave.ts`) instead of hoisting every tool call to the top. Absent
   * on turns persisted before this existed, which render hoisted as before.
   */
  anchor?: number;
};

/** A2UI: a one-tap recommended action rendered as a card in the answer. */
export type RecommendedAction = {
  /** The card's id (backlog 025) — how a `card_update` and a decision find it. Absent on a pre-card row. */
  id?: string;
  /** The card's state as the server last said it. */
  state?: 'proposed' | 'filed' | 'decided' | 'deferred' | 'expired';
  actionId: string;
  input: Record<string, unknown>;
  label: string;
  rationale?: string;
  confidence?: number;
  agentSlug?: string;
  /** Set when the server already filed it into the review queue (act-within-bounds). */
  runId?: number;
  /** The agent's own recommendation for the queue card, and why. Both or neither. */
  suggestedDecision?: 'approve' | 'reject' | 'snooze';
  suggestedDecisionReason?: string;
};

/** How recommended actions behave in a thread (0094). Mirrors `CONVERSATION_AUTONOMY` on the server. */
export type ConversationAutonomy = 'ask' | 'act-within-bounds';

/** Which model answered a turn and how hard it thought — the turn's footer (`run_meta` event). */
export type TurnModel = { model: string; provider: string; strength: 'fast' | 'balanced' | 'deep'; thinking: 'off' | 'low' | 'medium' | 'high' };

/**
 * A record the person pointed the conversation at — an `@` tag in the
 * composer, or the page they are on (R4's page-context model reads the same
 * shape). `type` is the dashboard entity family; `id` its slug or numeric id.
 */
export type ContextRef = {
  /**
   * `deliverable` and `intent` are the odd ones out, deliberately: every
   * other value names a RECORD the turn is about. `deliverable` (`@artifact`)
   * names what the turn OWES; `intent` (`@change`) names what the turn must
   * DO — route the ask through the sequence-draft rewrite rather than answer
   * it. Both ride the same mention mechanism, because arming one is the same
   * gesture as tagging a team, and both are stripped out of `context_refs`
   * before the wire — see `libs/chat/deliverable.ts` and
   * `features/dashboard/chat/composerTags.ts`.
   */
  type: 'agent' | 'team' | 'mission' | 'ask' | 'object' | 'briefing' | 'deal' | 'page' | 'deliverable' | 'intent';
  id: string;
  label: string;
  /** For a team: the agent slug a `@team` tag routes the turn to (its lead). */
  routeTo?: string;
};

/**
 * An artifact this turn created or changed — rendered as a chip under the
 * message so the transcript still says where a thing came from once the pane
 * has moved on to the next one.
 */
export type ChatMessageArtifact = {
  id: number;
  title: string;
  kind: 'table' | 'markdown' | 'chart' | 'record' | 'link' | 'file' | 'sequence' | 'document' | 'mission' | 'playbook';
  version: number;
};

/**
 * One thing the system changed about ITSELF during a turn — a wiki page, a
 * mission's notes, a playbook, an agent's own instructions, a remembered
 * rule, a capability. The shape is the server's, imported rather than
 * mirrored: `libs/actions/selfUpdate.ts` is pure, and one noun beats two that
 * drift (principle 7).
 */
export type { SelfUpdateReceipt } from '@/libs/actions/selfUpdate';

/**
 * A file a person put into the turn — an image, a PDF, a text file. It is an
 * ARTIFACT (kind `file`, uploaded by a human) so it has a row, a version, an
 * authenticated URL and a place in the artifacts list; the chip in the
 * composer and under the message is a view of that row, not a second store.
 */
export type ChatAttachment = {
  /** The artifact row id. */
  id: number;
  /** The file's own name, as the person had it. */
  title: string;
  contentType: string;
  bytes: number;
  /** Authenticated, same-origin — `/api/artifacts/<id>`. */
  url: string;
  /** How the model receives it: an image block, or its text inlined under the message. */
  kind: 'image' | 'document';
};

export type ChatMessage = {
  /** Persisted row id, once known — the feedback control writes against it. */
  id?: number;
  /** Which model answered this turn (assistant rows, live only — not persisted). */
  model?: TurnModel;
  role: 'user' | 'assistant';
  content: string;
  /** The person's thumb on this turn (assistant rows only), as stored. */
  feedback?: { rating: 'up' | 'down' | null; note: string | null };
  /** When a turn was routed to a specialist (`@agent`), who answered — rendered as the speaker (§9). */
  agentSlug?: string;
  agentName?: string;
  /** When the workspace chose the agent (`services/agents/router.ts`): candidates, pick, reason — the "via" eyebrow's tooltip. */
  routing?: import('@/services/agents/router').RoutingDecision;
  /** A2UI recommended-action cards emitted during this turn (clickable). */
  recommendations?: RecommendedAction[];
  /** Artifacts this turn created or changed (0101) — chips under the message. */
  artifacts?: ChatMessageArtifact[];
  /**
   * What the system taught itself during this turn — one chip under the
   * message, each entry undoable. Several in a turn group into that chip
   * rather than stacking beside it.
   */
  selfUpdates?: SelfUpdateReceipt[];
  /** Files the person attached to this (user) message — chips above its text. */
  attachments?: ChatAttachment[];
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
  /**
   * How the turn ended (#114) — the vocabulary lives in
   * `services/chat/turnStatus.ts`. Absent or `complete` on a healthy turn;
   * `incomplete`, `failed` and `refused` each get their own notice and are
   * left out of the model's history; `stopped`, `truncated` and `continued`
   * are ordinary endings, each with a quiet one-line marker instead.
   */
  status?: TurnStatus | null;
  /**
   * Why the turn ended that way, in the runtime's own words ("the model
   * connection dropped mid-answer", "Budget exceeded for …"). Shown under the
   * notice so a person can say what happened when they report it, and
   * persisted since #114 so a reloaded turn still carries it.
   */
  statusReason?: string;
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
