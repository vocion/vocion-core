'use client';

import type { TurnOutcome } from './queueReducer';
import type { AgentOption, AgentRun, ChatAttachment, ChatMessage, ChatMessageArtifact, ContextRef, ConversationAutonomy, HitlGatePayload, IndexedDocument, RecommendedAction, SelfUpdateReceipt, StreamingPhase, TraceNode, TurnModel } from './types';
import type { ModelPrefs } from '@/libs/llm/modelPrefs';
import type { RoutingDecision } from '@/services/agents/router';
import type { PageContext, RecordRef } from '@/services/chat/pageContext';
import type { TurnStatus } from '@/services/chat/turnStatus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openPreview } from '@/features/preview/previewState';
import { useLastViewedConversation } from '@/hooks/useLastViewedConversation';
import { mergeSelfUpdate } from '@/libs/actions/selfUpdate';
import { deliverableFromRefs, isArtifactTag } from '@/libs/chat/deliverable';
import { NO_AGENTS_MESSAGE } from '@/libs/chat/redact';
import { DEFAULT_MODEL_PREFS, readModelPrefs } from '@/libs/llm/modelPrefs';
import { client } from '@/libs/Orpc';
import { uploadAttachments } from './attachmentUpload';
import { DEFAULT_AUTONOMY } from './autonomyOptions';
import { isIntentTag } from './composerTags';
import { readRecommendedAction } from './recommendedAction';
import { decideResume, readSessionConversation, writeSessionConversation } from './resumeRule';
import { agentDisplayName, defaultAgentSlug, hasWorkspaceAgents, parseSearchCommand, routeTurn, SEARCH_ONLY_SLUG, workspaceChips } from './routing';
import { failToolNode, finalizeTrace, liveStepLabel, mergeTraceNode, noteToolProgress } from './traceReducer';
import { useSendQueue } from './useSendQueue';
import { describeToolCall } from './WorkTimeline';

/* ----------------------------------------------------------------- */
/* Active-conversation persistence                                     */
/*                                                                     */
/* The conversation itself is persisted server-side (Postgres is the   */
/* system of record). To RESUME it after navigating away and back we   */
/* only need to remember WHICH thread was active. That pointer lives   */
/* in two places on purpose:                                           */
/*                                                                     */
/*   - localStorage, per agent — synchronous, so the boot sequence can  */
/*     decide what to show without waiting on the network.             */
/*   - the `chat_widget_state` row (see useLastViewedConversation) —    */
/*     one pointer per user, so the floating bubble and the full page   */
/*     resume the same thread, and so a different browser or device     */
/*     picks up where the last one left off.                           */
/*                                                                     */
/* Both are RECENT pointers, not the current thread (§9, 2026-09-15): a  */
/* surface opens a NEW conversation unless this browser session was     */
/* already in one (sessionStorage) or the URL names one. See           */
/* resumeRule.ts. The pointers still seed the agent and the history.   */
/* ----------------------------------------------------------------- */

const ACTIVE_CONVERSATION_KEY = 'vocion:chat:active:';

function writeActiveConversation(agentSlug: string, id: number): void {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY + agentSlug, String(id));
  } catch (error) {
    // private mode / storage disabled — resume just won't persist
    console.warn('useChatSession: could not save the active conversation to localStorage', error);
  }
}

function clearActiveConversation(agentSlug: string): void {
  try {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY + agentSlug);
  } catch (error) {
    console.warn('useChatSession: could not clear the active conversation in localStorage', error);
  }
}

/**
 * Active mid-turn stream (resumable): survives refresh so we can replay
 *  missed events + re-attach live via /rpc/agent/stream/resume.
 */
const STREAM_STASH_KEY = 'vocion:chat:activestream';

type StreamStash = { streamId: string; agentSlug: string; count: number };

function readStreamStash(): StreamStash | null {
  try {
    const raw = sessionStorage.getItem(STREAM_STASH_KEY);
    return raw ? JSON.parse(raw) as StreamStash : null;
  } catch (error) {
    console.warn('useChatSession: could not read the resumable stream handle', error);
    return null;
  }
}

function writeStreamStash(stash: StreamStash | null): void {
  try {
    if (stash) {
      sessionStorage.setItem(STREAM_STASH_KEY, JSON.stringify(stash));
    } else {
      sessionStorage.removeItem(STREAM_STASH_KEY);
    }
  } catch (error) {
    console.warn('useChatSession: could not save the resumable stream handle', error);
  }
}

/**
 * The autonomy rung the person last chose — carried into the NEXT new
 * conversation so the choice survives "New chat" (0094).
 */
const AUTONOMY_KEY = 'vocion:chat:autonomy';

function readPreferredAutonomy(): ConversationAutonomy {
  try {
    const stored = localStorage.getItem(AUTONOMY_KEY);
    // Either rung the person chose stands; nothing stored means the default
    // (done for you since 2026-09-18 — the old code read a missing value as
    // 'ask' and every fresh thread vetoed the done-for-you policy).
    return stored === 'ask' || stored === 'act-within-bounds' ? stored : DEFAULT_AUTONOMY;
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

function writePreferredAutonomy(a: ConversationAutonomy): void {
  try {
    localStorage.setItem(AUTONOMY_KEY, a);
  } catch {
    /* storage unavailable */
  }
}

/** One persisted conversation row, as the conversations router returns it. */
type PersistedMessageRow = {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  runsJson: unknown;
  documentsJson: unknown;
  traceJson?: unknown;
  confidence: ChatMessage['confidence'];
  /** How the turn ended (`services/chat/turnStatus.ts`); null on a row written before that vocabulary. */
  status?: string | null;
  /** Why it ended that way, in the runtime's own words; null on an ordinary turn. */
  statusReason?: string | null;
  feedbackRating?: string | null;
  feedbackNote?: string | null;
  /** Files attached to a user turn, as the conversations router resolves them. */
  attachments?: ChatAttachment[];
  /** Artifacts the turn produced, as the conversations router resolves them — the chips. */
  artifacts?: ChatMessageArtifact[];
  /** Which agent spoke an assistant turn, as the runtime stamped it (backlog 009); null before the column existed. */
  agentSlug?: string | null;
};

/**
 * Rebuilds the in-memory transcript from persisted rows, and collects the
 * cited sources so inline `[n]` citations still resolve and the Sources
 * drawer repopulates after a reload.
 * @param rows - Persisted message rows, oldest first.
 * @param nameOf
 */
function hydrateTranscript(rows: PersistedMessageRow[], nameOf: (slug: string) => string): { messages: ChatMessage[]; documents: IndexedDocument[] } {
  const documents: IndexedDocument[] = [];
  const messages: ChatMessage[] = rows.map((row) => {
    const runsRaw = Array.isArray(row.runsJson) ? (row.runsJson as AgentRun[]) : [];
    const runs = runsRaw.length > 0
      // A stored `state` wins: a step that failed must still read as failed
      // after a reload. Only a step that stored none is assumed to have landed.
      ? runsRaw.map(run => (run.type === 'tool' ? { ...run, state: run.state ?? ('done' as const) } : run))
      : (row.role === 'assistant' && row.content ? [{ type: 'text' as const, text: row.content }] : undefined);
    const docs = Array.isArray(row.documentsJson) ? (row.documentsJson as IndexedDocument[]) : undefined;
    if (docs) {
      documents.push(...docs);
    }
    const trace = Array.isArray(row.traceJson) ? (row.traceJson as TraceNode[]) : undefined;
    const rating = row.feedbackRating === 'up' || row.feedbackRating === 'down' ? row.feedbackRating : null;
    // The cards a turn put up come back from the row (backlog 025): a card
    // is not a client-side ornament that a reload forgets.
    const recommendations: RecommendedAction[] = runsRaw
      .filter((r): r is Extract<AgentRun, { type: 'card' }> => r.type === 'card' && typeof r.label === 'string' && r.label.length > 0 && typeof r.actionId === 'string')
      .map(r => ({ ...(r.id ? { id: r.id } : {}), actionId: r.actionId, input: r.input ?? {}, label: r.label, ...(r.runId !== undefined ? { runId: r.runId } : {}), state: (r.state as RecommendedAction['state']) ?? (r.runId !== undefined ? 'filed' : 'proposed') }));
    return {
      ...(typeof row.id === 'number' ? { id: row.id } : {}),
      role: row.role,
      content: row.content ?? '',
      ...(row.role === 'assistant' && (rating || row.feedbackNote) ? { feedback: { rating, note: row.feedbackNote ?? null } } : {}),
      ...(runs ? { runs } : {}),
      ...(recommendations.length > 0 ? { recommendations } : {}),
      ...(docs && docs.length > 0 ? { documents: docs } : {}),
      ...(trace && trace.length > 0 ? { trace } : {}),
      ...(row.confidence ? { confidence: row.confidence } : {}),
      // How the turn ended has to survive the reload — a fragment looks like
      // an answer otherwise, and a refusal looks like a fault (#114).
      ...(row.status ? { status: row.status as TurnStatus } : {}),
      ...(row.statusReason ? { statusReason: row.statusReason } : {}),
      ...(row.attachments && row.attachments.length > 0 ? { attachments: row.attachments } : {}),
      ...(row.artifacts && row.artifacts.length > 0 ? { artifacts: row.artifacts } : {}),
      // Who spoke, from the row — so "via <specialist>" survives a reload and
      // says the same thing it said live (backlog 009).
      ...(row.role === 'assistant' && row.agentSlug ? { agentSlug: row.agentSlug, agentName: nameOf(row.agentSlug) } : {}),
    };
  });
  return { messages, documents };
}

/** The browser's IANA zone, or undefined where Intl cannot say (the server then uses the workspace's). */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export type UseChatSessionOptions = {
  /** Agents available to pick from. The caller guarantees at least one entry. */
  agents: AgentOption[];
  /** Pre-fills the composer without sending. */
  initialComposerValue?: string;
  /** Workspace-scoped empty-state chips, used while no specific agent is picked. */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Empty-state greeting: org eyebrow + "Ask <workspace>". */
  greeting?: { eyebrow?: string; workspace: string };
  /**
   * Scopes the session to one record (CRM mirror ref, e.g. `contacts:9412`) —
   * the dock's mode. Scoped sessions resume the current user's latest
   * conversation FOR THIS RECORD instead of the global last-viewed pointer,
   * create conversations carrying the scope, and never write the global
   * pointers, so the dock and the full-page chat cannot steal each other's
   * threads.
   */
  scopeRef?: string;
  /**
   * Where the person is when they ask (058): the everything-scoped dock off a
   * record page sends the route and its title with each turn, so an
   * unqualified question is answered about the page. A scoped session never
   * sets this; the scope already says what the conversation is about.
   */
  pageContext?: PageContext;
  /**
   * A thread the URL names (`?conversation=<id>`): the one case besides a
   * same-session return where a surface resumes instead of starting fresh
   * (§9). Null/undefined = decide from the session alone.
   */
  resumeConversationId?: number | null;
  /**
   * Extension seam for other surfaces (the canvas's `artifact` event, for
   * one): called with every SSE event BEFORE the built-in reducer. Return
   * true to claim the event and skip the default handling. `api` exposes the
   * same primitives the built-in cases use, so an extension can fold state
   * into the latest assistant message without editing this file.
   */
  onEvent?: (evt: { type: string; [k: string]: unknown }, api: ChatSessionEventApi) => boolean | undefined;
};

/** What an `onEvent` extension may do to the transcript. */
export type ChatSessionEventApi = {
  /** Replace the latest assistant message (no-op when the last message is the user's). */
  appendToLatestAgent: (mutate: (m: ChatMessage) => ChatMessage) => void;
  /** Fold any buffered text/trace deltas into state first, to keep ordering. */
  flushDeltas: () => void;
  /** Set the live activity line ("Rendering table…"); null clears it. */
  setActivity: (text: string | null) => void;
};

/**
 * Chat session state + streaming logic, shared by the full-page `ChatShell`
 * and the dock (`ChatDock`, on every other page) so both surfaces behave
 * identically — same SSE reducer, same resumable streams, same activity trace
 * — and resume the same conversation.
 *
 * Owns: the transcript, the SSE wire to `/rpc/agent/stream` (plus the
 * mid-turn resume endpoint), the boot sequence that restores the last agent
 * and thread, the per-agent suggestion chips, and the two conversation
 * pointers described above. Callers render; they don't reach into any of it.
 * @param root0 - Hook options.
 * @param root0.agents - Agents available to pick from. The caller guarantees at least one entry.
 * @param root0.initialComposerValue - Pre-fills the composer without sending.
 * @param root0.suggestions - Workspace-scoped empty-state chips.
 * @param root0.greeting - Empty-state greeting: org eyebrow + workspace name.
 * @param root0.scopeRef
 * @param root0.pageContext
 * @param root0.resumeConversationId
 * @param root0.onEvent
 */
export function useChatSession({
  agents,
  initialComposerValue,
  suggestions = [],
  greeting,
  scopeRef,
  pageContext,
  resumeConversationId = null,
  onEvent,
}: UseChatSessionOptions) {
  // Read at send time through a ref so a route change between turns is
  // reflected without rebuilding `sendMessage`.
  const pageContextRef = useRef(pageContext);
  pageContextRef.current = pageContext;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const { state: lastViewed, loading: lastViewedLoading, persist, persistRail } = useLastViewedConversation();

  // Scoped mode: resolve the user's latest conversation for the record before
  // boot decides anything. `loading` holds the skeleton exactly like the
  // last-viewed pointer does for the global surfaces.
  const [scopedBoot, setScopedBoot] = useState<{ loading: boolean; conv: { id: number; agentSlug: string } | null }>(
    () => ({ loading: Boolean(scopeRef), conv: null }),
  );
  const scopedResumeIdRef = useRef<number | null>(null);
  // The everything-scoped thread the boot decided to resume (§9), if any.
  const pendingResumeIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!scopeRef) {
      return;
    }
    let cancelled = false;
    client.conversations.latestForScope({ scopeRef })
      .then((conv) => {
        if (!cancelled) {
          setScopedBoot({ loading: false, conv: conv ? { id: conv.id, agentSlug: conv.agentSlug } : null });
        }
      })
      .catch((error) => {
        console.warn('useChatSession: scoped resume lookup failed', error);
        if (!cancelled) {
          setScopedBoot({ loading: false, conv: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scopeRef]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState(initialComposerValue ?? '');
  // Captured pasted material — a chip beside the composer, not a flood in it
  // (032 §2.1 rule 5). Travels with the next message, then clears.
  const [pastedText, setPastedText] = useState<string | null>(null);
  // Files attached to the next message — already uploaded, already artifacts;
  // these are the chips. `uploading` counts the batches still in flight so the
  // composer can show it and hold Send until they land.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamingPhase>('idle');
  const [pendingHitl, setPendingHitl] = useState<HitlGatePayload | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusCitation, setFocusCitation] = useState<number | null>(null);
  const [allDocuments, setAllDocuments] = useState<IndexedDocument[]>([]);
  // Citation numbers the assistant answers actually reference (`[n]`) — drives
  // the drawer's "Cited" tab vs. the full retrieved "All" set.
  const citedIndices = useMemo(() => {
    const set = new Set<number>();
    for (const message of messages) {
      if (message.role !== 'assistant') {
        continue;
      }
      const text = (message.runs ?? [])
        .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
        .map(run => run.text)
        .join('\n') || message.content || '';
      for (const match of text.matchAll(/\[(\d{1,3})\](?!\()/g)) {
        set.add(Number(match[1]));
      }
    }
    return [...set];
  }, [messages]);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>(undefined);
  // Live activity line — what the team is doing RIGHT NOW during a long turn
  // (retrieval, subagent delegation, tool runs). Cleared once text streams.
  const [activity, setActivity] = useState<string | null>(null);
  // Boot gate — a reload used to flash through 4 states (default agent →
  // skeleton chips → chips → transcript). We hold a single stable skeleton
  // until the restore-agent + resume-conversation sequence settles, then
  // reveal the final view (transcript OR empty state) in one transition.
  // `resuming` = a stored conversation will hydrate, so don't show the empty
  // state's chips at all — show a transcript skeleton straight to transcript.
  const [booted, setBooted] = useState(false);
  const [resuming, setResuming] = useState(false);

  // Recent conversations for the current agent — powers the history pickers
  // (the ⋯ menu on the page, the history panel in the bubble). Refreshed on
  // agent switch and when the list could be stale.
  const [recentChats, setRecentChats] = useState<Array<{ id: number; title: string }>>([]);
  // How recommended actions behave in this thread (0094). Starts from the
  // person's last choice; a resumed thread brings its own.
  const [autonomy, setAutonomyState] = useState<ConversationAutonomy>(DEFAULT_AUTONOMY);
  // How strong a model, how much it thinks — per thread, like autonomy.
  const [modelPrefs, setModelPrefsState] = useState<ModelPrefs>(DEFAULT_MODEL_PREFS);
  const modelPrefsRef = useRef(modelPrefs);
  modelPrefsRef.current = modelPrefs;
  // The roster, readable from effects and event handlers without re-running
  // them: it names the agent a persisted or streamed turn was spoken by.
  const rosterRef = useRef(agents);
  rosterRef.current = agents;
  const nameOfAgent = useCallback((slug: string, fallback?: string) => agentDisplayName(slug, rosterRef.current, fallback), []);
  // Records the person pointed this turn at with `@` — sent as `context_refs`
  // beside the message and cleared after the send.
  const [contextRefs, setContextRefs] = useState<ContextRef[]>([]);

  // Callers guarantee at least one entry — the virtual SEARCH_ONLY_AGENT is
  // always appended. `agentSlug` defaults to the workspace lead; if it ever
  // resolves to a missing/deleted agent the `?? agents[0]` fallback keeps the
  // surface pointed at a real agent.
  const agent = (currentSlug ? agents.find(a => a.slug === currentSlug) : undefined) ?? agents[0]!;
  // ONE identity (§9.10): the surface speaks as the WORKSPACE — "Ask Revenue"
  // — implemented as the lead's config plus its delegation roster. There is
  // no picked agent; specialists appear only as attribution. `__search__` is
  // reachable through the `/search` command, never as a persona.
  const isSearchOnly = agent.slug === '__search__';
  const workspaceName = agents.find(a => a.workspaceName)?.workspaceName ?? greeting?.workspace ?? 'your workspace';
  // Chips: the server's workspace set when it sent one, else the lead's own
  // suggestions plus one per team lead, capped — no agent names.
  const emptyChips = suggestions.length > 0 ? suggestions : workspaceChips(agents);
  const emptyChipsLoading = false;
  const emptyGreeting = greeting ?? { workspace: workspaceName };
  // Neutral composer (the ChatComposer default, "Ask anything…").
  const composerPlaceholder = undefined;
  const isStreaming = phase !== 'idle';
  /**
   * The same answer as `isStreaming`, readable SYNCHRONOUSLY.
   *
   * ⌘⏎ stops the turn and sends in one handler; `isStreaming` is still the
   * pre-stop value in that closure, so a guard reading it would refuse the
   * send. The ref is set at the three moments the turn's liveness actually
   * changes, so both readers agree.
   */
  const streamingRef = useRef(false);
  /**
   * How the last turn ENDED — what the send queue flushes on. Only
   * `completed` releases queued messages; `stopped` and `error` hold them and
   * tell the person they were not sent (queueReducer.ts).
   */
  const [turnOutcome, setTurnOutcome] = useState<TurnOutcome>('idle');
  /**
   * The controller `handleStop` already finalized, so the aborted fetch's
   * catch block does not close a DIFFERENT assistant message: ⌘⏎ pushes the
   * next turn's rows the moment it stops this one, and `appendToLatestAgent`
   * would otherwise rewrite that new empty row with the stopped turn's tail.
   * Held as the controller, not a boolean, because the next turn starts before
   * the aborted one's catch runs.
   */
  const stoppedControllerRef = useRef<AbortController | null>(null);

  /* --------------------------------------------------------------- */
  /* SSE event reducer — folds streaming events into the messages    */
  /* array on the latest assistant message.                          */
  /* --------------------------------------------------------------- */

  const appendToLatestAgent = useCallback((mutate: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') {
        return prev;
      }
      return [...prev.slice(0, -1), mutate(last)];
    });
  }, []);

  /* --------------------------------------------------------------- */
  /* Delta batching — token deltas arrive far faster than the screen  */
  /* refreshes. Accumulate them in refs and fold into React state at  */
  /* most once per animation frame, so a 1000-token reply costs ~60   */
  /* renders instead of ~1000. Ordering with non-delta events (tool   */
  /* runs, documents) is preserved by flushing synchronously before   */
  /* any other message mutation.                                      */
  /* --------------------------------------------------------------- */

  const pendingResponseRef = useRef('');
  const pendingThinkingRef = useRef('');
  const flushFrameRef = useRef<number | null>(null);
  // Typed trace nodes accumulate here (merged by id, reason deltas appended)
  // and fold into message.trace on the same animation frame as text deltas —
  // reason tokens arrive as fast as response tokens, so they need batching too.
  const pendingTraceRef = useRef<Map<string, TraceNode>>(new Map());
  const traceDirtyRef = useRef(false);
  // Where in the answer we are, for `TraceNode.anchor`: how many text runs
  // have started this turn, and whether the newest run is one of them (so the
  // next delta extends it rather than opening another). Mirrors the reducer's
  // own extend-or-append rule without reading React state mid-event, and the
  // same count the server's RunCollector stamps — so the live transcript and
  // the reloaded one interleave the same way.
  const textRunsRef = useRef(0);
  const lastRunIsTextRef = useRef(false);

  const flushDeltas = useCallback(() => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
    const responseText = pendingResponseRef.current;
    const thinkingText = pendingThinkingRef.current;
    const traceDirty = traceDirtyRef.current;
    if (!responseText && !thinkingText && !traceDirty) {
      return;
    }
    pendingResponseRef.current = '';
    pendingThinkingRef.current = '';
    traceDirtyRef.current = false;
    if (responseText && !lastRunIsTextRef.current) {
      textRunsRef.current += 1;
      lastRunIsTextRef.current = true;
    }
    const trace = traceDirty ? [...pendingTraceRef.current.values()] : null;
    appendToLatestAgent((m) => {
      let next = m;
      if (thinkingText) {
        next = { ...next, thinkingText: (next.thinkingText ?? '') + thinkingText };
      }
      if (trace) {
        next = { ...next, trace };
      }
      if (responseText) {
        const runs = next.runs ?? [];
        const last = runs[runs.length - 1];
        next = last && last.type === 'text'
          ? { ...next, runs: [...runs.slice(0, -1), { type: 'text', text: last.text + responseText }] }
          : { ...next, runs: [...runs, { type: 'text', text: responseText }] };
      }
      return next;
    });
  }, [appendToLatestAgent]);

  const scheduleFlush = useCallback(() => {
    if (flushFrameRef.current === null) {
      flushFrameRef.current = requestAnimationFrame(flushDeltas);
    }
  }, [flushDeltas]);

  // Unmount mid-stream: drop the pending frame (state is gone anyway).
  useEffect(() => () => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
    }
  }, []);

  const handleEvent = useCallback((evt: { type: string; [k: string]: unknown }) => {
    // Extension seam first (R2/R3): a claimed event skips the built-in cases.
    // Strict `=== true`: an extension that only observes returns undefined.
    if (onEventRef.current?.(evt, { appendToLatestAgent, flushDeltas, setActivity }) === true) {
      return;
    }
    switch (evt.type) {
      case 'routed': {
        // The workspace chose the agent (`route: true`): attribute the turn to
        // it the way an `@mention` does, and keep the reason on the message.
        const routed = evt as unknown as { agent: { slug: string; name: string }; routing: RoutingDecision };
        appendToLatestAgent(m => ({ ...m, agentSlug: routed.agent.slug, agentName: nameOfAgent(routed.agent.slug, routed.agent.name), routing: routed.routing }));
        return;
      }
      case 'turn_agent': {
        // Who speaks this turn, from the runtime — the same slug the row is
        // stamped with, so live and reloaded transcripts agree (backlog 009).
        const spoken = evt as unknown as { agent: { slug: string; name: string } };
        appendToLatestAgent(m => ({ ...m, agentSlug: spoken.agent.slug, agentName: nameOfAgent(spoken.agent.slug, spoken.agent.name) }));
        return;
      }
      case 'run_meta': {
        // Which model answers this turn — the footer's fact, never a guess.
        const meta = evt as unknown as TurnModel & { type: 'run_meta' };
        appendToLatestAgent(m => ({ ...m, model: { model: meta.model, provider: meta.provider, strength: meta.strength ?? 'balanced', thinking: meta.thinking ?? 'off' } }));
        return;
      }
      case 'thinking':
        setPhase('thinking');
        setActivity('Thinking…');
        return;
      case 'thinking_delta': {
        // Chain-of-thought token (Anthropic extended thinking).
        // Accumulate into the message's thinkingText — WorkTimeline
        // renders the live tail while streaming and the full text after.
        setActivity('Reasoning…');
        pendingThinkingRef.current += String(evt.delta ?? '');
        scheduleFlush();
        return;
      }
      case 'trace_node': {
        // Typed hierarchical trace — merge by id (reason deltas append to
        // text), batched onto the animation frame like the other deltas.
        const node = evt as unknown as TraceNode & { delta?: string };
        const map = pendingTraceRef.current;
        // A NEW step is anchored to its place in the answer. Flush first so a
        // passage still in the buffer counts as started — it precedes the step.
        if (!map.has(node.id)) {
          if (pendingResponseRef.current) {
            flushDeltas();
          }
          node.anchor = textRunsRef.current;
        }
        const merged = mergeTraceNode(map.get(node.id), node);
        map.set(node.id, merged);
        traceDirtyRef.current = true;
        setActivity(liveStepLabel(merged));
        scheduleFlush();
        return;
      }
      case 'step_progress': {
        // A long call saying where it has got to — "sheet 7 of 12". It rides
        // the step line that is already there; it never adds a row.
        const name = String(evt.tool ?? 'tool');
        const note = String(evt.note ?? '').trim();
        if (!note) {
          return;
        }
        const map = pendingTraceRef.current;
        const next = noteToolProgress([...map.values()], name, note);
        const touched = next.find(n => n.tool === name && n.progress === note);
        if (!touched) {
          return;
        }
        map.set(touched.id, touched);
        traceDirtyRef.current = true;
        setActivity(liveStepLabel(touched));
        scheduleFlush();
        return;
      }
      case 'answering':
        setPhase('answering');
        return;
      case 'retrieval_progress': {
        const stage = String(evt.stage ?? 'searching');
        const meta = (evt.meta as { candidates?: number }) ?? {};
        setActivity(stage === 'reranking'
          ? `Searching — ranking ${meta.candidates ?? ''} candidates…`
          : 'Searching connected sources…');
        return;
      }
      case 'subagent_start':
        // Subagent names are deepagents plumbing ("general-purpose") — the
        // timeline's Delegated step carries the friendly specialist name.
        setActivity('Specialist working…');
        return;
      case 'subagent_end':
        setActivity('Assembling the answer…');
        return;
      case 'response_delta': {
        setActivity(null);
        pendingResponseRef.current += String(evt.delta ?? '');
        scheduleFlush();
        return;
      }
      case 'tool_start': {
        flushDeltas();
        const name = String(evt.tool ?? 'tool');
        const input = (evt.input as Record<string, unknown>) ?? {};
        // Same human labels the timeline uses, present tense — "Delegating:
        // Pipeline Analyst…" instead of "Running task…".
        const live = describeToolCall(name, input, true);
        setActivity(live.detail ? `${live.label} ${live.detail}` : live.label);
        lastRunIsTextRef.current = false;
        appendToLatestAgent(m => ({
          ...m,
          runs: [...(m.runs ?? []), { type: 'tool', name, input, state: 'pending' }],
        }));
        return;
      }
      case 'tool_end': {
        flushDeltas();
        const name = String(evt.tool ?? 'tool');
        const output = String(evt.output ?? '');
        appendToLatestAgent((m) => {
          const runs = m.runs ?? [];
          for (let i = runs.length - 1; i >= 0; i--) {
            const run = runs[i]!;
            if (run.type === 'tool' && run.name === name && run.state === 'pending') {
              const updated: AgentRun = { ...run, state: 'done', output };
              return { ...m, runs: [...runs.slice(0, i), updated, ...runs.slice(i + 1)] };
            }
          }
          return m;
        });
        return;
      }
      case 'tool_error': {
        // A tool threw. Close its in-flight run AND its trace row as errors so
        // the rail's live row stops spinning and says what happened.
        flushDeltas();
        const name = String(evt.tool ?? 'tool');
        const message = String(evt.message ?? 'tool failed');
        setActivity(null);
        appendToLatestAgent((m) => {
          const runs = m.runs ?? [];
          let patched = false;
          const nextRuns = runs.map((run) => {
            if (!patched && run.type === 'tool' && run.name === name && run.state === 'pending') {
              patched = true;
              return { ...run, state: 'error' as const, output: message };
            }
            return run;
          });
          const trace = m.trace ?? [...pendingTraceRef.current.values()];
          const nextTrace = failToolNode(trace, name, message);
          for (const n of nextTrace) {
            pendingTraceRef.current.set(n.id, n);
          }
          return { ...m, runs: nextRuns, trace: nextTrace };
        });
        return;
      }
      case 'record_created': {
        // A room or proposal the turn just made opens beside the conversation
        // (Chris, 2026-09-18: "maybe preview should open automatically").
        flushDeltas();
        const made = (evt as unknown as { record: { type: RecordRef['type']; id: string } }).record;
        openPreview({ type: made.type, id: made.id }, null);
        return;
      }
      case 'documents': {
        flushDeltas();
        const docs = (evt.documents as IndexedDocument[]) ?? [];
        setAllDocuments(prev => [...prev, ...docs]);
        appendToLatestAgent(m => ({ ...m, documents: [...(m.documents ?? []), ...docs] }));
        return;
      }
      case 'hitl_gate': {
        flushDeltas();
        setPendingHitl(evt.gate as HitlGatePayload);
        return;
      }
      case 'card': {
        // The typed form (backlog 025): on the ledger already, on the wire
        // now, filed later if at all — `card_update` carries the proposal id.
        flushDeltas();
        const c = evt.card as { id: string; title: string; kind: string; state?: RecommendedAction['state']; runId?: number; actions?: Array<{ actionId: string; input?: Record<string, unknown> }>; rationale?: string; confidence?: number; source?: { agentSlug?: string }; suggestedDecision?: RecommendedAction['suggestedDecision']; suggestedDecisionReason?: string };
        const primary = c.actions?.[0];
        let rec: RecommendedAction;
        if (primary) {
          const checked = readRecommendedAction({ actionId: primary.actionId, input: primary.input ?? {}, label: c.title, rationale: c.rationale, confidence: c.confidence, agentSlug: c.source?.agentSlug, runId: c.runId, suggestedDecision: c.suggestedDecision, suggestedDecisionReason: c.suggestedDecisionReason });
          if (!checked.ok) {
            console.warn(`useChatSession: dropped an invalid card — ${checked.reason}`);
            return;
          }
          rec = { ...checked.rec, id: c.id, state: c.state ?? (c.runId !== undefined ? 'filed' : 'proposed') };
        } else if (typeof c.title === 'string' && c.title.trim()) {
          // A recommendation with nothing to press (its action was refused,
          // finding 20): still the agent's recommendation, read not pressed.
          rec = { id: c.id, actionId: '', input: {}, label: c.title, ...(c.rationale ? { rationale: c.rationale } : {}), ...(c.source?.agentSlug ? { agentSlug: c.source.agentSlug } : {}), state: c.state ?? 'proposed' };
        } else {
          return;
        }
        appendToLatestAgent(m => ({ ...m, recommendations: [...(m.recommendations ?? []).filter(r => r.id !== c.id), rec] }));
        return;
      }
      case 'card_update': {
        const u = evt as unknown as { cardId: string; runId?: number; state?: RecommendedAction['state'] };
        appendToLatestAgent(m => ({
          ...m,
          recommendations: (m.recommendations ?? []).map(r => (r.id === u.cardId ? { ...r, ...(u.runId !== undefined ? { runId: u.runId } : {}), ...(u.state ? { state: u.state } : {}) } : r)),
        }));
        return;
      }
      case 'recommended_action': {
        // A2UI: attach a clickable action card to the current answer. No side
        // effect yet — the gated review item is created only if the user taps.
        //
        // Checked HERE, at the boundary, because a card is one tap (or, at
        // act-within-bounds, zero taps) from an RPC: a payload with no
        // actionId used to reach the card and fire `review.propose` with
        // `undefined`, which the server rejected as a 400. An invalid
        // recommendation now becomes a visible failed step in the trace and
        // never becomes a card.
        flushDeltas();
        const checked = readRecommendedAction(evt.recommendation);
        if (!checked.ok) {
          console.warn(`useChatSession: dropped an invalid recommended_action — ${checked.reason}`);
          lastRunIsTextRef.current = false;
          appendToLatestAgent(m => ({
            ...m,
            runs: [...(m.runs ?? []), { type: 'tool', name: 'recommend_action', state: 'error', output: checked.reason }],
          }));
          return;
        }
        appendToLatestAgent(m => ({ ...m, recommendations: [...(m.recommendations ?? []), checked.rec] }));
        return;
      }
      case 'artifact': {
        // The chip under the message saying what this turn produced.
        //
        // `ChatMessageArtifact`, `ArtifactChips` and the render in
        // `AgentMessage` all existed; nothing ever set `message.artifacts`, on
        // this path or the transcript's. So `render_chart` wrote a real
        // artifact, the agent said "chart's up", and the transcript showed
        // nothing — Chris, 2026-09-17: *"why didn't I get an artifact here?"*
        //
        // A pending shell carries no content yet and is skipped; the real event
        // that follows replaces it. Keyed by id so a turn that updates the same
        // artifact twice leaves one chip at the latest version, not two.
        if (evt.pending) {
          return;
        }
        // The reducer takes untyped events off the wire, so narrow here rather
        // than trusting the shape.
        const a = evt.artifact as { id?: unknown; title?: unknown; kind?: unknown; version?: unknown } | undefined;
        if (!a || typeof a.id !== 'number' || typeof a.title !== 'string') {
          return;
        }
        const chip: ChatMessageArtifact = {
          id: a.id,
          title: a.title,
          kind: (a.kind ?? 'markdown') as ChatMessageArtifact['kind'],
          version: typeof a.version === 'number' ? a.version : 1,
        };
        appendToLatestAgent(m => ({
          ...m,
          artifacts: [...(m.artifacts ?? []).filter(x => x.id !== chip.id), chip],
        }));
        // ...and open it beside the conversation, which is what the tool has
        // been TELLING the user it did. `render_markdown` returns "now open
        // beside the conversation at v1"; `openPreview` was only ever called
        // from a chip click, so the artifact appeared as a chip the user then
        // had to find and press. Chris, 2026-09-17: *"it didn't open the
        // sidebar artifact (it should have)"* — he was comparing against the
        // sentence the product had just shown him.
        //
        // The newest artifact of the turn wins, so a turn that renders three
        // leaves the last one open rather than fighting over the panel.
        openPreview({ type: 'artifact', id: String(chip.id) }, null);
        return;
      }

      case 'self_update': {
        // The chip that says the system improved ITSELF during this turn. The
        // same fold as the artifact chip — key by run id, so a proposal that
        // is refreshed mid-turn leaves one entry at its latest state — except
        // that these group into ONE chip rather than a row each.
        const u = evt.selfUpdate as { runId?: unknown; noun?: unknown; target?: unknown; status?: unknown } | undefined;
        if (!u || typeof u.runId !== 'number' || typeof u.noun !== 'string' || typeof u.target !== 'string') {
          return;
        }
        const receipt = evt.selfUpdate as SelfUpdateReceipt;
        appendToLatestAgent(m => ({ ...m, selfUpdates: mergeSelfUpdate(m.selfUpdates ?? [], receipt) }));
        return;
      }

      case 'done':
        flushDeltas();
        // `done` IS the terminal event (#421): the answer is complete even
        // though the socket stays open for the ~3s it takes the route to
        // persist the row. Release the send guard here, not at socket close —
        // otherwise a message typed in that window is dropped in silence
        // while the button still reads "Send message".
        streamingRef.current = false;
        // Backfill `content` from the streamed text runs. Streaming only
        // accumulates into `runs`; `conversation_history` reads `content`
        // (and drops empty entries), so without this the agent never sees
        // its own prior replies and re-answers earlier turns. Also finalize
        // the trace: any node still "in progress" (e.g. a reason node that
        // never got a done boundary) would otherwise show a spinner + present
        // tense ("Thinking") forever after the turn completes.
        appendToLatestAgent(m => ({
          ...m,
          content: m.content || (m.runs ?? [])
            .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
            .map(run => run.text)
            .join('\n\n'),
          trace: finalizeTrace(m.trace),
        }));
        setPhase('idle');
        setActivity(null);
        return;
      case 'error': {
        flushDeltas();
        setPhase('idle');
        setActivity(null);
        const message = String(evt.message ?? 'error');
        lastRunIsTextRef.current = false;
        // The turn stops here with whatever text already arrived. Marking it
        // now means the live transcript says the same thing the reloaded one
        // will — the server writes the row `incomplete` from the same event
        // (#114).
        //
        // This used to add a tool run called "error" instead, which lit the
        // tool-error badge: the person read "error failed" over a turn where
        // no tool had failed, and after the notice landed they read the same
        // failure twice in one bubble. The run is gone; the reason travels on
        // the message.
        // The server says which ending this is, in the same word it will store
        // on the row; an older runtime that does not say reads as the ending
        // this used to assume.
        const ending = (evt.ending as TurnStatus | undefined) ?? 'incomplete';
        appendToLatestAgent(m => ({
          ...m,
          status: ending,
          statusReason: message,
        }));
      }
    }
  }, [appendToLatestAgent, flushDeltas, scheduleFlush]);

  /* --------------------------------------------------------------- */
  /* Send                                                            */
  /* --------------------------------------------------------------- */

  // Persisted thread id for this chat. Conversations are the system of
  // record (and feed the adoption stream); the id is created lazily on
  // the first send and reset by New chat / agent switch. The virtual
  // `__search__` entry stays ephemeral — it isn't a real agent, so its
  // turns must not appear in conversation history or agent metrics.
  //
  // Held in a ref because `sendMessage` reads it synchronously mid-turn, and
  // mirrored into state because the history pickers highlight the active
  // thread and a ref change doesn't re-render.
  const conversationIdRef = useRef<number | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  // A page hand-off may ask for ONE turn to go to a specialist (the brief's
  // team lead); the conversation itself stays with the workspace agent.
  const routeOnceRef = useRef<string | null>(null);

  /**
   * Points this chat at a thread: the synchronous ref, the render-visible
   * state, this browser's localStorage pointer, and the user's server-side
   * pointer, all in one place so no surface can drift from another.
   * @param slug - Agent the thread belongs to.
   * @param id - Conversation id, or null to detach and start fresh.
   */
  const setActiveConversation = useCallback((slug: string, id: number | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
    // This browser session is now in (or out of) the thread — the one signal
    // a later mount resumes on (§9).
    writeSessionConversation(slug, id);
    if (scopeRef) {
      // Scoped threads belong to the record, not to the global pointers —
      // the dock must never steal the full-page chat's resume target.
      scopedResumeIdRef.current = id;
      return;
    }
    if (id === null) {
      clearActiveConversation(slug);
    } else {
      writeActiveConversation(slug, id);
    }
    persist({ agentSlug: slug, conversationId: id });
  }, [persist, scopeRef]);

  /**
   * After a turn lands, learn the persisted id of the assistant row so the
   * feedback control has something to write against. One small read; the
   * server appended the row while streaming.
   */
  const stampLastAssistantId = useCallback(async () => {
    const id = conversationIdRef.current;
    if (id === null) {
      return;
    }
    try {
      const rows = await client.conversations.tail({ id, limit: 2 });
      const last = [...rows].reverse().find(r => r.role === 'assistant');
      if (!last) {
        return;
      }
      appendToLatestAgent(m => (m.id ? m : { ...m, id: last.id }));
    } catch (error) {
      console.warn('useChatSession: could not read the persisted message id', error);
    }
  }, [appendToLatestAgent]);

  // In-flight turn's abort controller (Stop button).
  const abortRef = useRef<AbortController | null>(null);
  const streamStashRef = useRef<StreamStash | null>(null);

  // Once the boot sequence settles (agent restored + conversation resumed or
  // confirmed empty), reveal the final view. Idempotent — safe to call on
  // every resolution path.
  const settleBoot = useCallback(() => {
    setResuming(false);
    setBooted(true);
  }, []);

  // RESUME a mid-turn stream after refresh/drop: replay missed events, then
  // stay attached live until done. Falls back silently (404 = expired; the
  // finished turn arrives via conversation rehydrate as before).
  const resumeStream = useCallback(async (stash: StreamStash) => {
    pendingTraceRef.current = new Map();
    traceDirtyRef.current = false;
    textRunsRef.current = 0;
    lastRunIsTextRef.current = false;
    setMessages(prev => [...prev, { role: 'assistant', content: '', runs: [] }]);
    streamingRef.current = true;
    setPhase('thinking');
    setTurnOutcome('running');
    setActivity('Reconnecting to the running turn…');
    streamStashRef.current = stash;
    try {
      const resp = await fetch(`/rpc/agent/stream/resume?id=${encodeURIComponent(stash.streamId)}&after=${stash.count}`);
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          if (!block.startsWith('data: ')) {
            continue;
          }
          try {
            const evt = JSON.parse(block.slice(6));
            if (evt.type !== 'stream_meta') {
              if (streamStashRef.current) {
                streamStashRef.current.count += 1;
                writeStreamStash(streamStashRef.current);
              }
              handleEvent(evt);
            }
          } catch (error) {
            // malformed event — skip it, the stream keeps going
            console.warn('useChatSession: failed to parse a replayed SSE event', error);
          }
        }
      }
      flushDeltas();
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
          .map(run => run.text)
          .join('\n\n'),
        trace: finalizeTrace(m.trace),
      }));
      void stampLastAssistantId();
      // A turn that finished while we were away still counts as landed, so a
      // queue that survived the reload (sessionStorage) goes out.
      setTurnOutcome('completed');
    } catch (error) {
      // Expired/unreachable — drop the placeholder; rehydrate covers the rest.
      console.warn('useChatSession: could not re-attach to the running turn', error);
      setMessages(prev => (prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.content ? prev.slice(0, -1) : prev));
      setTurnOutcome('error');
    } finally {
      streamingRef.current = false;
      setPhase('idle');
      setActivity(null);
      streamStashRef.current = null;
      writeStreamStash(null);
    }
  }, [handleEvent, flushDeltas, appendToLatestAgent]);

  /* --------------------------------------------------------------- */
  /* Boot — restore the last agent, then resume its saved thread.     */
  /* --------------------------------------------------------------- */

  // The agent we're booting toward (stored or default). Set synchronously in
  // the restore effect; the hydrate effect only settles boot for THIS slug, so
  // a hydrate pass for the pre-restore (default) slug can't prematurely reveal
  // the empty-state chips before the swap-to-restored-agent completes.
  // State, not a ref: the hydrate effect below must re-run once the boot
  // target is known, and a ref change doesn't re-trigger an effect.
  const [bootTarget, setBootTarget] = useState<string | null>(null);
  const restoredAgentRef = useRef(false);
  // Was a page hand-off waiting when this session booted? Recorded here, in
  // the first effect to run, because the hand-off effect below CONSUMES the
  // stash — by the time the resume effect looks, it would already be gone.
  const handoffPendingAtBootRef = useRef(false);
  useEffect(() => {
    // Hold the skeleton until the server-side pointer has resolved, so the
    // decision below is made once against both records instead of showing a
    // default view and then swapping.
    if (lastViewedLoading || (scopeRef && scopedBoot.loading) || restoredAgentRef.current) {
      return;
    }
    restoredAgentRef.current = true;

    try {
      handoffPendingAtBootRef.current = sessionStorage.getItem('vocion_chat_handoff') !== null;
    } catch (error) {
      console.warn('useChatSession: could not check for a pending hand-off', error);
    }

    // Scoped mode: the record's own latest thread decides the boot target;
    // the global stored-agent and last-viewed pointers are someone else's.
    if (scopeRef) {
      const conv = scopedBoot.conv && agents.some(a => a.slug === scopedBoot.conv!.agentSlug)
        ? scopedBoot.conv
        : null;
      const target = conv ? conv.agentSlug : agent.slug;
      setBootTarget(target);
      if (target !== agent.slug) {
        setCurrentSlug(target);
      }
      if (conv) {
        scopedResumeIdRef.current = conv.id;
        setResuming(true);
      } else {
        settleBoot();
      }
      return;
    }

    // The workspace agent answers a fresh conversation (§9.10: one identity)
    // — never a last-used or deep-linked agent. A resumed legacy thread that
    // was opened with a specific agent brings that agent below.
    const target = defaultAgentSlug(agents);
    setBootTarget(target);
    if (target !== agent.slug) {
      setCurrentSlug(target);
    }

    // New chat unless intentionally returning (§9): resume only the thread
    // this browser session was already in, or the one the URL names. The
    // last-viewed pointer above chose the AGENT; it never chooses the thread.
    const decision = target === '__search__'
      ? { resume: false as const, reason: 'fresh' as const }
      : decideResume({ explicitId: resumeConversationId, sessionId: readSessionConversation(target) });
    if (decision.resume) {
      pendingResumeIdRef.current = decision.conversationId;
      // Hold the empty state and let the resume effect reveal the transcript
      // directly (no chip flash).
      setResuming(true);
    } else {
      pendingResumeIdRef.current = null;
      settleBoot();
    }
  }, [agents, agent.slug, settleBoot, lastViewedLoading, scopeRef, scopedBoot, resumeConversationId]);

  // Resume the agent's saved thread on mount / agent-switch, so navigating
  // away and back doesn't start over. __search__ is ephemeral and never
  // resumes; an explicit page handoff also starts fresh (it stashes its own
  // prompt in sessionStorage).
  const hydratedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    const slug = agent.slug;
    // Wait for the restore effect: it decides which agent we're booting
    // toward and may adopt the server-side conversation pointer, both of
    // which this effect reads.
    if (bootTarget === null || isSearchOnly || hydratedSlugRef.current === slug) {
      return;
    }
    hydratedSlugRef.current = slug;
    // A hand-off carries its own context and starts a fresh turn, so don't
    // resume a saved thread underneath it.
    if (handoffPendingAtBootRef.current) {
      settleBoot();
      return;
    }
    const storedId = scopeRef ? scopedResumeIdRef.current : pendingResumeIdRef.current;
    if (storedId === null) {
      // Only reveal the empty state for the agent we're actually booting toward.
      // A hydrate pass for the pre-restore (default) slug must NOT settle — the
      // restore effect is about to swap us to the real agent, which resumes.
      if (slug === bootTarget) {
        settleBoot();
      }
      return;
    }
    let cancelled = false;
    client.conversations.get({ id: storedId })
      .then((conv) => {
        if (cancelled || agent.slug !== slug) {
          return;
        }
        const { messages: hydrated, documents: restoredDocs } = hydrateTranscript(
          (conv.messages ?? []) as PersistedMessageRow[],
          nameOfAgent,
        );
        if (hydrated.length > 0) {
          conversationIdRef.current = storedId;
          setConversationId(storedId);
          writeSessionConversation(slug, storedId);
          setAutonomyState(readAutonomy(conv));
          setModelPrefsState(readModelPrefs(conv));
          setMessages(hydrated);
          if (restoredDocs.length > 0) {
            setAllDocuments(restoredDocs);
          }
          // Mid-turn drop? If a stream stash exists for this agent and the
          // assistant's reply hasn't persisted yet, replay + re-attach live.
          const stash = readStreamStash();
          if (stash && stash.agentSlug === slug) {
            if (hydrated[hydrated.length - 1]?.role === 'user') {
              void resumeStream(stash);
            } else {
              writeStreamStash(null); // turn already landed
            }
          }
        } else if (scopeRef) {
          // Scoped id points at an empty/deleted thread — forget it.
          scopedResumeIdRef.current = null;
        } else {
          // Stored id points at an empty/deleted thread — forget it.
          clearActiveConversation(slug);
          writeSessionConversation(slug, null);
        }
        settleBoot();
      })
      .catch((error) => {
        // Thread gone/inaccessible — forget it so we start clean.
        console.warn('useChatSession: could not resume the saved conversation', storedId, error);
        if (!cancelled) {
          clearActiveConversation(slug);
          writeSessionConversation(slug, null);
          settleBoot();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent.slug, isSearchOnly, settleBoot, resumeStream, bootTarget]);

  const sendMessage = useCallback(async (raw: string) => {
    // Read the ref, not `isStreaming`: ⌘⏎ (stop-and-send) calls handleStop and
    // sendMessage in the same handler, before React has re-rendered.
    if ((!raw.trim() && !pastedText && attachments.length === 0) || streamingRef.current || uploading > 0) {
      return;
    }
    // `/search <query>` is the retrieval-only path (§9.10) — the virtual
    // search entry, reached by command rather than as a persona.
    const command = parseSearchCommand(raw);
    // An empty workspace is a STATE, not an error (2026-09-16). Sending would
    // route the turn to the `__search__` sentinel and come back as
    // `agent __search__ not found in org proj-…`; the person gets the sentence
    // that tells them what to do instead, and the composer stays live.
    if (!hasWorkspaceAgents(agents) && !command.searchOnly) {
      setMessages(prev => [
        ...prev,
        { role: 'user', content: raw.trim() },
        { role: 'assistant', content: NO_AGENTS_MESSAGE },
      ]);
      setComposerValue('');
      return;
    }
    streamingRef.current = true;
    setTurnOutcome('running');
    const searchAgent = command.searchOnly ? agents.find(a => a.slug === SEARCH_ONLY_SLUG) : undefined;
    // Pasted material rides along under the instruction, clearly fenced, so
    // the instruction stays readable in the transcript and the agent still
    // receives the full text.
    // A message that is only files still has to say something the server can
    // store and the transcript can show.
    const typed = command.text.trim() || (attachments.length > 0 ? `(Attached: ${attachments.map(a => a.title).join(', ')})` : command.text);
    const text = pastedText
      ? `${typed}\n\n--- pasted ---\n${pastedText}`.trim()
      : typed;
    const sent = attachments;
    // Fresh turn — reset the per-turn trace accumulator and the anchor clock.
    pendingTraceRef.current = new Map();
    traceDirtyRef.current = false;
    textRunsRef.current = 0;
    lastRunIsTextRef.current = false;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text, ...(sent.length > 0 ? { attachments: sent } : {}) },
      { role: 'assistant', content: '', runs: [] },
    ]);
    setComposerValue('');
    setPastedText(null);
    setAttachments([]);
    setAttachError(null);
    setPhase('thinking');

    const refs = contextRefs;
    setContextRefs([]);
    // What the NEXT message owes (0102), read off the tags the person put on
    // it: `@artifact` arms the contract, nothing else does. The tag is not a
    // record, so it is stripped before `context_refs` travels — the model is
    // never handed "a record called Artifact".
    const deliverable = deliverableFromRefs(refs);
    // `@artifact` says what the turn OWES, `@change` says what it must DO.
    // Neither points at a record, so neither travels as one.
    const recordRefs = refs.filter(r => !isArtifactTag(r) && !isIntentTag(r));
    // `@agent` / `@team` routes THIS turn to a specialist; the conversation
    // stays with its own agent and the reply is rendered under the
    // specialist's name (§9).
    const onceSlug = routeOnceRef.current;
    routeOnceRef.current = null;
    const routed = searchAgent ?? routeTurn(recordRefs, agents) ?? (onceSlug ? agents.find(a => a.slug === onceSlug) ?? null : null);
    const turnAgent = routed ?? agent;
    // The reply is NOT attributed here from the tags: the runtime says who
    // speaks (`turn_agent`, the first frame) and the row records it. A label
    // stamped from a guess read "via QA" on a turn the product manager
    // answered (backlog 009).
    if (conversationIdRef.current === null && agent.slug !== '__search__') {
      try {
        const conv = await client.conversations.create({ agentSlug: agent.slug, ...(scopeRef ? { scopeRef } : {}) });
        setActiveConversation(agent.slug, conv.id);
        if (autonomy !== DEFAULT_AUTONOMY) {
          // The person's standing choice applies to the thread it just created
          // (the row is born at the default; only a different rung needs writing).
          client.conversations.setAutonomy({ id: conv.id, autonomy }).catch((error) => {
            console.warn('useChatSession: could not persist the autonomy setting', error);
          });
        }
      } catch (error) {
        // persistence is best-effort — chat still works ephemerally
        console.warn('useChatSession: failed to create a persisted conversation', error);
      }
    }
    const activeConversationId = conversationIdRef.current;

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch('/rpc/agent/stream', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agent_slug: turnAgent.slug,
          // Nobody named an agent for this turn: let the workspace choose
          // (`services/agents/router.ts`). The reply is attributed to whoever
          // answers, exactly as an `@mention` is; the reason rides with it.
          ...(!routed && !isSearchOnly ? { route: true } : {}),
          // The turn's deliverable contract (0102) — a typed field, decided
          // before the turn runs, not a judgement the model makes during it.
          deliverable,
          // R4: page context travels on every surface; a scoped dock also sends
          // its scope so the server folds it in as a ref (mergeScopeRef).
          ...(pageContextRef.current ? { page_context: pageContextRef.current } : {}),
          // The person's zone: the server judges "today" in it for this turn.
          time_zone: browserTimeZone(),
          ...(scopeRef ? { scope_ref: scopeRef } : {}),
          ...(recordRefs.length > 0 ? { context_refs: recordRefs } : {}),
          // The files, by artifact id — the server resolves them under this
          // org and files them under the message it stores.
          ...(sent.length > 0 ? { attachments: sent.map(a => a.id) } : {}),
          // With a conversation attached the server replays its own
          // (authoritative) history and ignores this list.
          ...(activeConversationId !== null ? { conversation_id: activeConversationId } : {}),
          // How strong a model, how much it thinks (`libs/llm/modelPrefs.ts`).
          model_strength: modelPrefsRef.current.strength,
          thinking_effort: modelPrefsRef.current.effort,
          conversation_history: messages
            .slice(-6)
            .filter(m => m.content.trim().length > 0)
            .map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          if (!block.startsWith('data: ')) {
            continue;
          }
          try {
            const evt = JSON.parse(block.slice(6));
            if (evt.type === 'stream_meta') {
              // Resume handle — stash it; replayed events are counted below
              // so a reconnect asks only for what it missed.
              streamStashRef.current = { streamId: String(evt.streamId), agentSlug: agent.slug, count: 0 };
              writeStreamStash(streamStashRef.current);
            } else {
              if (streamStashRef.current) {
                streamStashRef.current.count += 1;
                writeStreamStash(streamStashRef.current);
              }
              handleEvent(evt);
            }
          } catch (error) {
            // malformed event — skip it, the stream keeps going
            console.warn('useChatSession: failed to parse an SSE event', error);
          }
        }
      }
      // Stream closed — fold in any deltas still buffered and make sure
      // `content` is populated (covers streams that end without a `done`
      // event; see the `done` case for why content must be backfilled).
      flushDeltas();
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
          .map(run => run.text)
          .join('\n\n'),
        trace: finalizeTrace(m.trace),
      }));
      streamingRef.current = false;
      setPhase('idle');
      setActivity(null);
      setTurnOutcome('completed');
      streamStashRef.current = null;
      writeStreamStash(null);
      void stampLastAssistantId();
    } catch (err) {
      // User-initiated Stop (AbortError) is not an error — just finalize the
      // partial turn cleanly, no error breadcrumb and nothing to resume.
      const aborted = (err as Error).name === 'AbortError';
      if (aborted && stoppedControllerRef.current === controller) {
        // `handleStop` already flushed, closed THIS turn's rows and cleared
        // the phase + stash. Touching anything here would land on whatever
        // message is last NOW, which under ⌘⏎ is the NEXT turn's freshly
        // pushed assistant row.
        stoppedControllerRef.current = null;
        setTurnOutcome('stopped');
        return;
      }
      flushDeltas();
      streamingRef.current = false;
      setPhase('idle');
      setActivity(null);
      streamStashRef.current = null;
      if (aborted) {
        writeStreamStash(null);
      } else {
        console.warn('useChatSession: the streaming turn failed', err);
      }
      setTurnOutcome(aborted ? 'stopped' : 'error');
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
          .map(run => run.text)
          .join('\n\n'),
        trace: aborted ? finalizeTrace(m.trace) : (m.trace ?? []),
        // A turn that lost its connection is the same story as one whose run
        // threw: unfinished, not a failed tool (#114). Stopping on purpose is
        // neither, so an abort marks nothing.
        // The connection died before any ending arrived from the server, so
        // the client names one itself: text on screen means the answer stopped
        // part-way, nothing on screen means the turn never got going. A
        // deliberate stop is neither — `handleStop` has already marked it.
        ...(aborted
          ? {}
          : { status: (m.content || (m.runs ?? []).length > 0 ? 'incomplete' : 'failed') as TurnStatus, statusReason: (err as Error).message }),
      }));
    } finally {
      // NOTE: the stream stash is NOT cleared here — on a reload the fetch
      // rejects during unload and this finally raced the navigation, wiping
      // the resume handle. It clears on normal completion / Stop instead.
      //
      // Only clear the handle if it is still OURS: ⌘⏎ starts the next turn
      // before this one's reader has finished rejecting, and clearing then
      // would leave that turn's Stop with nothing to abort.
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [agent, agents, messages, pastedText, attachments, uploading, contextRefs, autonomy, handleEvent, appendToLatestAgent, flushDeltas, setActiveConversation, stampLastAssistantId]);

  /**
   * Attach files to the next message: upload now, chip now. A refused file
   * (wrong type, too big) becomes a sentence above the box; a transport
   * failure too. Nothing here waits for the turn — the person keeps typing.
   */
  const attachFiles = useCallback(async (files: File[]) => {
    const picked = files.filter(f => f.size > 0);
    if (picked.length === 0) {
      return;
    }
    setUploading(n => n + 1);
    setAttachError(null);
    try {
      const { attachments: added, refused } = await uploadAttachments(picked, conversationIdRef.current);
      if (added.length > 0) {
        setAttachments(prev => [...prev, ...added.filter(a => !prev.some(p => p.id === a.id))]);
      }
      if (refused.length > 0) {
        setAttachError(refused.join(' '));
      }
    } catch (err) {
      setAttachError((err as Error).message || 'The upload failed.');
    } finally {
      setUploading(n => Math.max(0, n - 1));
    }
  }, []);

  const removeAttachment = useCallback((id: number) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Abort the in-flight turn (Stop button). The reader loop throws AbortError,
  // which the catch above treats as a clean finalize (no error breadcrumb).
  const handleStop = useCallback(async () => {
    if (!streamingRef.current) {
      return;
    }
    streamingRef.current = false;
    stoppedControllerRef.current = abortRef.current;
    flushDeltas();
    // Close this turn's rows HERE rather than in the abort catch, so a
    // stop-and-send lands the tail on the turn that was stopped.
    appendToLatestAgent(m => ({
      ...m,
      content: m.content || (m.runs ?? [])
        .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
        .map(run => run.text)
        .join('\n\n'),
      trace: finalizeTrace(m.trace),
      // Marked live as well as stored, so the bubble says the same thing now
      // as it will after a reload.
      status: 'stopped' as const,
    }));
    setPhase('idle');
    setActivity(null);
    setTurnOutcome('stopped');
    // Tell the server, and WAIT for it before aborting.
    //
    // Aborting only closes this browser's socket, which is exactly what a
    // locked phone does — and that turn has to keep running so the person can
    // come back to it. Stopping is a decision, so it is sent as one, and the
    // row is stored `stopped` instead of `complete`.
    //
    // The wait is what makes the two agree. The run reaches its own end on its
    // own schedule; if the stop were still in flight when it got there, the
    // row would say `complete` while this bubble said `stopped`, and a reload
    // would quietly rewrite what the person remembers doing. Everything above
    // has already happened, so the screen is not waiting on this.
    const streamId = streamStashRef.current?.streamId;
    // A stopped turn has nothing to resume.
    streamStashRef.current = null;
    writeStreamStash(null);
    if (streamId) {
      try {
        await fetch('/rpc/agent/stream/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stream_id: streamId }),
        });
      } catch (error) {
        // The turn still stops here, but the stored row will say `complete`
        // and nobody will know why it looks cut short. Worth a line.
        console.warn('useChatSession: the server was not told this turn was stopped', error);
      }
    }
    abortRef.current?.abort();
  }, [flushDeltas, appendToLatestAgent]);

  /**
   * ⌘⏎ / the queued-row "send now": end the running turn and put this message
   * in immediately, rather than waiting behind it. Enter alone never does
   * this — killing a turn somebody wanted is not a thing to do by surprise.
   */
  const sendNow = useCallback(async (text: string) => {
    handleStop();
    await sendMessage(text);
  }, [handleStop, sendMessage]);

  const handlePickSuggestion = useCallback((prompt: string) => {
    setComposerValue(prompt);
    void sendMessage(prompt);
  }, [sendMessage]);

  // Handoff from another page (e.g. the Briefings composer): a stashed
  // { question, contextTitle, context } starts this chat — the context rides
  // inside the first message. A stashed `agentSlug` (the brief's team lead)
  // routes that ONE turn (§9.10); the conversation stays with the workspace
  // agent. One-shot: the stash is cleared before sending.
  const handoffSentRef = useRef(false);
  useEffect(() => {
    if (bootTarget === null || handoffSentRef.current) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('vocion_chat_handoff');
      if (raw) {
        sessionStorage.removeItem('vocion_chat_handoff');
      }
    } catch (error) {
      console.warn('useChatSession: could not read the hand-off stash', error);
      return;
    }
    if (!raw) {
      return;
    }
    handoffSentRef.current = true;
    try {
      const { question, contextTitle, context, excerpt, agentSlug: target } = JSON.parse(raw) as {
        question: string;
        contextTitle: string;
        context: string;
        excerpt?: string;
        agentSlug?: string;
      };
      const parts = [question];
      if (excerpt) {
        parts.push(`---\nThe question is specifically about this highlighted passage:\n> ${excerpt.replaceAll('\n', '\n> ')}`);
      }
      parts.push(`---\nCONTEXT — "${contextTitle}" (carried over from the Briefings page):\n\n${context}`);
      const message = parts.join('\n\n');
      if (target && target !== agent.slug && agents.some(a => a.slug === target)) {
        routeOnceRef.current = target;
      }
      void sendMessage(message);
    } catch (error) {
      // malformed stash — ignore, nothing to send
      console.warn('useChatSession: could not parse the hand-off stash', error);
    }
  }, [sendMessage, agent.slug, agents, bootTarget]);

  const handleApproveHitl = useCallback(() => {
    setPendingHitl(null);
    void sendMessage('approve');
  }, [sendMessage]);

  const handleRejectHitl = useCallback(() => {
    setPendingHitl(null);
    void sendMessage('reject');
  }, [sendMessage]);

  // Reset only the in-memory transcript. Does NOT touch the per-agent saved
  // conversation — used by agent-switch, which must leave the other agent's
  // thread resumable.
  const resetTranscript = useCallback(() => {
    setMessages([]);
    setAllDocuments([]);
    setPendingHitl(null);
    setPhase('idle');
    conversationIdRef.current = null;
    setConversationId(null);
  }, []);

  // "New chat" — explicitly forget THIS agent's thread so the next send
  // starts a fresh persisted one and a later remount doesn't resume it.
  const handleNewChat = useCallback(() => {
    resetTranscript();
    setActiveConversation(agent.slug, null);
  }, [resetTranscript, agent.slug, setActiveConversation]);

  /** The workspace lead — the config behind the workspace agent. */
  const leadSlug = defaultAgentSlug(agents);

  // Inline citation tap — open the Sources drawer focused on that `[n]`.
  const handleCitationClick = useCallback((n: number) => {
    setFocusCitation(n);
    setSourcesOpen(true);
  }, []);

  // "Sources" affordance on a message — open the drawer on the full set,
  // with no single citation singled out.
  const handleShowSources = useCallback(() => {
    setFocusCitation(null);
    setSourcesOpen(true);
  }, []);

  const agentSlugForChats = agent.slug;
  useEffect(() => {
    if (agentSlugForChats === '__search__') {
      setRecentChats([]);
      return;
    }
    let cancelled = false;
    void client.conversations.list({ agentSlug: agentSlugForChats, limit: 12 })
      .then((rows) => {
        if (!cancelled) {
          setRecentChats((rows as Array<{ id: number; title: string | null }>).map(row => ({
            id: row.id,
            title: row.title || `Chat #${row.id}`,
          })));
        }
      })
      .catch((error) => {
        console.warn('useChatSession: failed to list recent conversations', error);
      });
    return () => {
      cancelled = true;
    };
  }, [agentSlugForChats, booted, phase]);

  // History picker: load a past conversation into the transcript + make it
  // the active thread (so new turns append to it).
  const handlePickConversation = useCallback(async (id: number) => {
    try {
      const conv = await client.conversations.get({ id });
      const { messages: hydrated, documents: restoredDocs } = hydrateTranscript(
        (conv.messages ?? []) as PersistedMessageRow[],
        nameOfAgent,
      );
      const slug = (conv as { agentSlug?: string }).agentSlug ?? agent.slug;
      if (slug !== agent.slug) {
        // Picked a thread belonging to another agent (the bubble's history
        // panel is per-agent, but a stale list can still offer one) — follow
        // it rather than appending this agent's turns to someone else's thread.
        hydratedSlugRef.current = slug;
        setCurrentSlug(slug);
      }
      setActiveConversation(slug, id);
      setAutonomyState(readAutonomy(conv));
      setModelPrefsState(readModelPrefs(conv));
      setMessages(hydrated);
      setAllDocuments(restoredDocs);
      setPendingHitl(null);
      setPhase('idle');
    } catch (error) {
      // conversation gone — leave the current transcript
      console.warn('useChatSession: could not load conversation', id, error);
    }
  }, [agent.slug, setActiveConversation]);

  // The standing preference seeds a fresh thread once on mount (client-only
  // read, so not during render).
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setAutonomyState(readPreferredAutonomy());
  }, []);

  /**
   * Change how recommended actions behave in this thread — persisted on the
   * conversation when one exists, and remembered as the preference for the
   * next new one (0094).
   */
  const setAutonomy = useCallback((next: ConversationAutonomy) => {
    setAutonomyState(next);
    writePreferredAutonomy(next);
    const id = conversationIdRef.current;
    if (id !== null) {
      client.conversations.setAutonomy({ id, autonomy: next }).catch((error) => {
        console.warn('useChatSession: could not persist the autonomy setting', error);
      });
    }
  }, []);

  /** Change how strong a model answers this thread and how much it thinks — persisted on the conversation when one exists. */
  const setModelPrefs = useCallback((next: ModelPrefs) => {
    setModelPrefsState(next);
    const id = conversationIdRef.current;
    if (id !== null) {
      client.conversations.setModel({ id, strength: next.strength, effort: next.effort }).catch((error) => {
        console.warn('useChatSession: could not persist the model setting', error);
      });
    }
  }, []);

  /**
   * A thumb (and optional note) on one assistant turn. Optimistic: the
   * message shows the rating at once; the server write is best-effort and a
   * failure logs rather than reverting — a thumb is not worth a modal.
   */
  const handleFeedback = useCallback(async (messageId: number, rating: 'up' | 'down' | null, note?: string | null) => {
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, feedback: { rating, note: rating ? (note ?? m.feedback?.note ?? null) : null } } : m)));
    try {
      await client.conversations.feedback({ messageId, rating, note: note ?? null });
    } catch (error) {
      console.warn('useChatSession: could not save feedback', error);
    }
  }, []);

  const addContextRef = useCallback((ref: ContextRef) => {
    setContextRefs(prev => (prev.some(r => r.type === ref.type && r.id === ref.id) ? prev : [...prev, ref]));
  }, []);
  const removeContextRef = useCallback((ref: ContextRef) => {
    setContextRefs(prev => prev.filter(r => !(r.type === ref.type && r.id === ref.id)));
  }, []);

  /** Threads matching a query — the history popover's search (blank = recent). */
  const searchConversations = useCallback(async (q: string) => {
    try {
      return await client.conversations.search({ q, limit: 20 });
    } catch (error) {
      console.warn('useChatSession: conversation search failed', error);
      return [];
    }
  }, []);

  /**
   * The send queue (P0 of the steering work): Enter mid-turn appends here
   * instead of being swallowed by a disabled box, and the queue drains itself
   * the moment the turn lands. See `queueReducer.ts` for the contract.
   */
  const sendQueue = useSendQueue({
    conversationId,
    streaming: isStreaming,
    outcome: turnOutcome,
    send: sendMessage,
  });

  /**
   * Enter while a turn is running. Queues rather than sends — the running turn
   * is not interrupted, and nothing the person typed is lost.
   */
  const queueMessage = useCallback((text: string) => {
    sendQueue.enqueue(text);
    setComposerValue('');
  }, [sendQueue]);

  /** Clicking a queued row: it leaves the queue and goes back in the box. */
  const editQueued = useCallback((id: string) => {
    const text = sendQueue.edit(id);
    if (text !== null) {
      setComposerValue(prev => (prev.trim() ? `${text}\n${prev}` : text));
    }
  }, [sendQueue]);

  return {
    /** The agent this chat is talking to right now. */
    agent,
    /** Chips for the empty state — the picked agent's own, else the workspace set. */
    emptyChips,
    /** True while a picked agent's chips are still being synthesized. */
    emptyChipsLoading,
    /** Greeting for the empty state (workspace name, or the picked agent's). */
    emptyGreeting,
    /** Composer placeholder: neutral on the workspace view, the agent's own once picked. */
    composerPlaceholder,
    messages,
    composerValue,
    setComposerValue,
    /** Captured pasted material for the composer chip; travels with the next send. */
    pastedText,
    setPastedText,
    /** Files attached to the next message — uploaded, chips showing. */
    attachments,
    /** Upload batches in flight. */
    uploading,
    /** Why the last attach did not fully land, for the line above the box. */
    attachError,
    clearAttachError: () => setAttachError(null),
    attachFiles,
    removeAttachment,
    isStreaming,
    activity,
    pendingHitl,
    sourcesOpen,
    setSourcesOpen,
    focusCitation,
    allDocuments,
    citedIndices,
    /** False until the restore-agent + resume-conversation sequence settles. */
    booted,
    /** True while a saved thread is about to hydrate — show a transcript skeleton, not chips. */
    resuming,
    /** Recent threads for this agent, for the history pickers. */
    recentChats,
    /** Id of the thread new turns append to. Null until the first send. */
    conversationId,
    sendMessage,
    handleStop,
    /** How the last turn ended — `stopped`/`error` hold the queue instead of flushing it. */
    turnOutcome,
    /** Queued messages waiting for the running turn to land, oldest first. */
    queuedMessages: sendQueue.items,
    /** True when a stopped or failed turn left the queue unsent. */
    queueHeld: sendQueue.held,
    /** Enter mid-turn — append to the queue. */
    queueMessage,
    /** The ✕ on a queued row. */
    dropQueued: sendQueue.drop,
    /** Click a queued row to pull it back into the composer. */
    editQueued,
    /** Acknowledge the "not sent" notice. */
    releaseQueueNotice: sendQueue.release,
    /** ⌘⏎ — stop the running turn and send this message right now. */
    sendNow,
    handlePickSuggestion,
    handleApproveHitl,
    handleRejectHitl,
    handleNewChat,
    /** The workspace lead's slug — the config behind the one workspace agent (§9.10). */
    leadSlug,
    /** The name the surface speaks as. */
    workspaceName,
    handleCitationClick,
    handleShowSources,
    handlePickConversation,
    /** How recommended actions behave in this thread (0094). */
    autonomy,
    setAutonomy,
    /** How strong a model answers this thread and how much it thinks (`libs/llm/modelPrefs.ts`). */
    modelPrefs,
    setModelPrefs,
    /** Thumb + note on an assistant turn, by persisted message id. */
    handleFeedback,
    /** Records the next message is about (`@` tags). */
    contextRefs,
    addContextRef,
    removeContextRef,
    /** Search threads by title or content — the history popover. */
    searchConversations,
    /** The rail's saved geometry for this user (0094); null until the pointer resolves or when never set. */
    railState: lastViewed ? { railWidth: lastViewed.railWidth ?? null, railOpen: lastViewed.railOpen ?? null } : null,
    railLoading: lastViewedLoading,
    persistRail,
  };
}

/**
 * The autonomy rung a persisted conversation carries; a row that says nothing
 * usable is at the default.
 * @param conv - A conversation row as the router returns it.
 */
function readAutonomy(conv: unknown): ConversationAutonomy {
  const a = (conv as { autonomy?: unknown } | null)?.autonomy;
  return a === 'ask' || a === 'act-within-bounds' ? a : DEFAULT_AUTONOMY;
}
