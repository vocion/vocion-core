'use client';

import type { EmptyStateSuggestion } from './EmptyState';
import type {
  AgentOption,
  AgentRun,
  ChatMessage,
  HitlGatePayload,
  IndexedDocument,
  StreamingPhase,
  TraceNode,
} from './types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { client } from '@/libs/Orpc';
import { AgentSwitcher } from './AgentSwitcher';
import { ChatComposer } from './ChatComposer';
import { ChatMenu } from './ChatMenu';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { SourcesPanel } from './SourcesPanel';
import { describeToolCall } from './WorkTimeline';

/**
 * ChatShell — Phase C orchestrator.
 *
 * Owns chat state. Children render. Streaming wire is the new SSE
 * route at `/rpc/agent/stream` (Phase 4); events emitted by the
 * backend are reduced into the `messages` array.
 *
 * Agent identity is data-in: the server component that mounts ChatShell
 * passes the available agents (DB rows + the virtual `__search__`
 * entry) and optionally a starting `agentSlug`. When the tenant has no
 * agents, render a "no agents yet" empty state pointing at the
 * authoring path. The pre-v0.5.2 default to "Sales Assistant" is gone.
 *
 * "Insert quarter, shoot aliens": the surface is messages + composer,
 * period. No permanent header, no picker on the canvas — new chat and
 * agent targeting live behind the single ⋯ menu (top-right overlay).
 *
 * Component tree:
 *   <ChatMenu /> (⋯ overlay, top-right)
 *   <MessageList /> or <EmptyState />
 *   <SourcesPanel /> (right-side, optional)
 *   <HitlGate /> (above composer when pending)
 *   <ChatComposer />
 */

/* ----------------------------------------------------------------- */
/* Active-conversation persistence                                     */
/*                                                                     */
/* The conversation itself is persisted server-side (Postgres is the   */
/* system of record). To RESUME it after navigating away and back we   */
/* only need to remember WHICH thread was active — stashed per agent   */
/* in localStorage and rehydrated via conversations.get on mount.      */
/* ----------------------------------------------------------------- */

const ACTIVE_CONVERSATION_KEY = 'vocion:chat:active:';

function readActiveConversation(agentSlug: string): number | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CONVERSATION_KEY + agentSlug);
    const id = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function writeActiveConversation(agentSlug: string, id: number): void {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY + agentSlug, String(id));
  } catch {
    /* private mode / storage disabled — resume just won't persist */
  }
}

function clearActiveConversation(agentSlug: string): void {
  try {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY + agentSlug);
  } catch {
    /* ignore */
  }
}

/** The last agent the user was talking to — restored on refresh so a reload
 *  doesn't kick you back to the workspace default. */
const ACTIVE_AGENT_KEY = 'vocion:chat:agent';

function readActiveAgent(): string | null {
  try {
    return localStorage.getItem(ACTIVE_AGENT_KEY);
  } catch {
    return null;
  }
}

function writeActiveAgent(slug: string): void {
  try {
    localStorage.setItem(ACTIVE_AGENT_KEY, slug);
  } catch {
    /* ignore */
  }
}

export type ChatShellProps = {
  /** Agents available to pick from. Empty array renders the no-agents empty state. */
  agents: AgentOption[];
  /** Initial selection. If absent, picks the first entry in `agents`. */
  agentSlug?: string;
  /** Pre-fills the composer without sending (e.g. the org chart's seeded "how's the quarter?" prompt). */
  initialComposerValue?: string;
  /** Dynamic workspace-scoped empty-state chips (urgency + capability). */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Empty-state greeting: org eyebrow + "Ask <workspace>". */
  greeting?: { eyebrow?: string; workspace: string };
};

export function ChatShell({
  agents,
  agentSlug,
  initialComposerValue,
  suggestions = [],
  greeting,
}: ChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState(initialComposerValue ?? '');
  const [phase, setPhase] = useState<StreamingPhase>('idle');
  const [pendingHitl, setPendingHitl] = useState<HitlGatePayload | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusCitation, setFocusCitation] = useState<number | null>(null);
  const [allDocuments, setAllDocuments] = useState<IndexedDocument[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>(agentSlug);
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

  // Callers (`chat/page.tsx`) guarantee at least one entry — the virtual
  // SEARCH_ONLY_AGENT is always appended. `agentSlug` defaults to the
  // workspace lead; if it ever resolves to a missing/deleted agent the
  // `?? agents[0]` fallback keeps the surface pointed at a real agent.
  const agent = (currentSlug ? agents.find(a => a.slug === currentSlug) : undefined) ?? agents[0]!;
  // Default = the workspace view (agents[0] is the workspace lead). Nothing
  // was specifically picked, so the surface speaks for the WORKSPACE: the
  // "Ask <workspace>" greeting, the dynamic workspace chips, and a neutral
  // composer. Once a specific agent/team is picked via the ⋯ switcher, the
  // greeting + placeholder name THAT agent and its own suggestions lead.
  // The virtual __search__ entry isn't an agent, so it keeps the workspace
  // greeting (its placeholder already explains itself).
  const isDefaultView = agent.slug === agents[0]?.slug;
  const isSearchOnly = agent.slug === '__search__';

  // Per-agent chips are SYNTHESIZED server-side from that agent's declared
  // context (mission × skills × tracker state — services/chat/synthesis.ts)
  // and fetched lazily when the agent is picked. A picked agent NEVER falls
  // back to the workspace chip set — wrong grounding ("How's the quarter?"
  // on the GTM lead). While the fetch is in flight the empty state shows a
  // skeleton shimmer; on failure the server already degraded to that agent's
  // deterministic mission-derived chips, so an empty result here means the
  // agent genuinely has nothing declared to suggest.
  const [synthesizedChips, setSynthesizedChips] = useState<Record<string, EmptyStateSuggestion[]>>({});
  const needsAgentChips = !isDefaultView && !isSearchOnly;
  useEffect(() => {
    if (!needsAgentChips) {
      return;
    }
    const slug = agent.slug;
    if (synthesizedChips[slug] !== undefined) {
      return;
    }
    let cancelled = false;
    client.chat.suggestions({ agentSlug: slug })
      .then((chips) => {
        if (!cancelled) {
          setSynthesizedChips(prev => ({ ...prev, [slug]: chips.map(c => ({ label: c.label, prompt: c.prompt })) }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSynthesizedChips(prev => ({ ...prev, [slug]: [] }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsAgentChips, agent.slug, synthesizedChips]);

  const emptyChips = needsAgentChips ? (synthesizedChips[agent.slug] ?? []) : suggestions;
  const emptyChipsLoading = needsAgentChips && synthesizedChips[agent.slug] === undefined;
  const emptyGreeting = (isDefaultView || isSearchOnly)
    ? greeting
    : { eyebrow: greeting?.eyebrow, workspace: agent.name };
  // Neutral composer on the workspace view (the ChatComposer default,
  // "Ask anything…"); the agent's own placeholder once one is picked.
  const composerPlaceholder = isDefaultView ? undefined : agent.placeholder;
  const isStreaming = phase !== 'idle';

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
    switch (evt.type) {
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
        const n = evt as unknown as TraceNode & { delta?: string };
        const map = pendingTraceRef.current;
        const prev = map.get(n.id);
        const merged: TraceNode = {
          ...prev,
          ...n,
          text: (prev?.text ?? '') + (n.delta ?? ''),
          citations: n.citations ?? prev?.citations,
          result: n.result ?? prev?.result,
          resultDetail: n.resultDetail ?? prev?.resultDetail,
          tool: n.tool ?? prev?.tool,
          args: n.args ?? prev?.args,
          detail: n.detail ?? prev?.detail,
        };
        delete (merged as { delta?: string }).delta;
        map.set(n.id, merged);
        traceDirtyRef.current = true;
        setActivity(n.label);
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
            const r = runs[i]!;
            if (r.type === 'tool' && r.name === name && r.state === 'pending') {
              const updated: AgentRun = { ...r, state: 'done', output };
              return { ...m, runs: [...runs.slice(0, i), updated, ...runs.slice(i + 1)] };
            }
          }
          return m;
        });
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
      case 'recommended_action': {
        // A2UI: attach a clickable action card to the current answer. No side
        // effect yet — the gated review item is created only if the user taps.
        flushDeltas();
        const rec = evt.recommendation as NonNullable<ChatMessage['recommendations']>[number];
        appendToLatestAgent(m => ({ ...m, recommendations: [...(m.recommendations ?? []), rec] }));
        return;
      }
      case 'done':
        flushDeltas();
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
            .filter((r): r is Extract<AgentRun, { type: 'text' }> => r.type === 'text')
            .map(r => r.text)
            .join('\n\n'),
          trace: (m.trace ?? []).map(n => (n.status === 'error' ? n : { ...n, status: 'done' as const })),
        }));
        setPhase('idle');
        setActivity(null);
        return;
      case 'error': {
        flushDeltas();
        setPhase('idle');
        setActivity(null);
        const msg = String(evt.message ?? 'error');
        appendToLatestAgent(m => ({
          ...m,
          runs: [...(m.runs ?? []), { type: 'tool', name: 'error', state: 'error', output: msg }],
        }));
      }
    }
  }, [appendToLatestAgent, flushDeltas, scheduleFlush]);

  /* --------------------------------------------------------------- */
  /* Send                                                            */
  /* --------------------------------------------------------------- */

  // Persisted thread id for this chat. Conversations are the system of
  // record (and feed the adoption stream); the id is created lazily on
  // the first send and reset by Clear / agent switch. The virtual
  // `__search__` entry stays ephemeral — it isn't a real agent, so its
  // turns must not appear in conversation history or agent metrics.
  const conversationIdRef = useRef<number | null>(null);
  // In-flight turn's abort controller (Stop button).
  const abortRef = useRef<AbortController | null>(null);

  // Resume the agent's saved thread on mount / agent-switch, so navigating
  // away and back doesn't start over. We stash the active id per agent
  // (localStorage) and rehydrate the transcript from conversations.get.
  // __search__ is ephemeral and never resumes; an explicit page handoff
  // also starts fresh (it stashes its own prompt in sessionStorage).
  // Explicit agent switch = start FRESH (don't resume that agent's old
  // thread). Set just before setCurrentSlug so the resume effect skips.
  const freshSwitchRef = useRef(false);

  // On mount (refresh/navigate-back), restore the last agent the user was on
  // — otherwise a reload snaps back to the workspace default (Director). This
  // changes agent.slug, which drives the resume effect below for that agent.
  // Once the boot sequence settles (agent restored + conversation resumed or
  // confirmed empty), reveal the final view. Idempotent — safe to call on
  // every resolution path.
  const settleBoot = useCallback(() => {
    setResuming(false);
    setBooted(true);
  }, []);

  // The agent we're booting toward (stored or default). Set synchronously in
  // the restore effect; the hydrate effect only settles boot for THIS slug, so
  // a hydrate pass for the pre-restore (default) slug can't prematurely reveal
  // the empty-state chips before the swap-to-restored-agent completes.
  const bootTargetRef = useRef<string | null>(null);
  const restoredAgentRef = useRef(false);
  useEffect(() => {
    if (restoredAgentRef.current) {
      return;
    }
    restoredAgentRef.current = true;
    const stored = readActiveAgent();
    const target = (stored && agents.some(a => a.slug === stored)) ? stored : agent.slug;
    bootTargetRef.current = target;
    if (target !== agent.slug) {
      setCurrentSlug(target);
    }
    // If a saved thread exists for the target agent, hold the empty state and
    // let the resume effect reveal the transcript directly (no chip flash).
    if (target !== '__search__' && readActiveConversation(target) !== null) {
      setResuming(true);
    } else {
      settleBoot();
    }
  }, [agents, agent.slug, settleBoot]);

  const hydratedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    const slug = agent.slug;
    if (isSearchOnly || hydratedSlugRef.current === slug) {
      return;
    }
    hydratedSlugRef.current = slug;
    if (freshSwitchRef.current) {
      // Explicit switch to this agent — fresh chat, no resume.
      freshSwitchRef.current = false;
      settleBoot();
      return;
    }
    let handoffPending = false;
    try {
      handoffPending = sessionStorage.getItem('vocion_chat_handoff') !== null;
    } catch {
      /* ignore */
    }
    if (handoffPending) {
      settleBoot();
      return;
    }
    const storedId = readActiveConversation(slug);
    if (storedId === null) {
      // Only reveal the empty state for the agent we're actually booting toward.
      // A hydrate pass for the pre-restore (default) slug must NOT settle — the
      // restore effect is about to swap us to the real agent, which resumes.
      if (bootTargetRef.current === null || slug === bootTargetRef.current) {
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
        const rows = (conv.messages ?? []) as Array<{
          role: 'user' | 'assistant';
          content: string;
          runsJson: unknown;
          documentsJson: unknown;
          confidence: ChatMessage['confidence'];
        }>;
        const restoredDocs: IndexedDocument[] = [];
        const hydrated: ChatMessage[] = rows.map((row) => {
          const runsRaw = Array.isArray(row.runsJson) ? (row.runsJson as AgentRun[]) : [];
          const runs = runsRaw.length > 0
            ? runsRaw.map(r => (r.type === 'tool' ? { ...r, state: 'done' as const } : r))
            : (row.role === 'assistant' && row.content ? [{ type: 'text' as const, text: row.content }] : undefined);
          // Rehydrate cited sources so inline [n] citations still resolve and
          // the Sources drawer repopulates after a reload.
          const docs = Array.isArray(row.documentsJson) ? (row.documentsJson as IndexedDocument[]) : undefined;
          if (docs) {
            restoredDocs.push(...docs);
          }
          return {
            role: row.role,
            content: row.content ?? '',
            ...(runs ? { runs } : {}),
            ...(docs && docs.length > 0 ? { documents: docs } : {}),
            ...(row.confidence ? { confidence: row.confidence } : {}),
          };
        });
        if (hydrated.length > 0) {
          conversationIdRef.current = storedId;
          setMessages(hydrated);
          if (restoredDocs.length > 0) {
            setAllDocuments(restoredDocs);
          }
        } else {
          // Stored id points at an empty/deleted thread — forget it.
          clearActiveConversation(slug);
        }
        settleBoot();
      })
      .catch(() => {
        // Thread gone/inaccessible — forget it so we start clean.
        if (!cancelled) {
          clearActiveConversation(slug);
          settleBoot();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent.slug, isSearchOnly, settleBoot]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) {
      return;
    }
    // Fresh turn — reset the per-turn trace accumulator.
    pendingTraceRef.current = new Map();
    traceDirtyRef.current = false;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', runs: [] },
    ]);
    setComposerValue('');
    setPhase('thinking');

    if (conversationIdRef.current === null && agent.slug !== '__search__') {
      try {
        const conv = await client.conversations.create({ agentSlug: agent.slug });
        conversationIdRef.current = conv.id;
        writeActiveConversation(agent.slug, conv.id);
        writeActiveAgent(agent.slug);
      } catch {
        /* persistence is best-effort — chat still works ephemerally */
      }
    }
    const conversationId = conversationIdRef.current;

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch('/rpc/agent/stream', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agent_slug: agent.slug,
          // With a conversation attached the server replays its own
          // (authoritative) history and ignores this list.
          ...(conversationId !== null ? { conversation_id: conversationId } : {}),
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
            handleEvent(JSON.parse(block.slice(6)));
          } catch {
            /* malformed event, skip */
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
          .filter((r): r is Extract<AgentRun, { type: 'text' }> => r.type === 'text')
          .map(r => r.text)
          .join('\n\n'),
        trace: (m.trace ?? []).map(n => (n.status === 'error' ? n : { ...n, status: 'done' as const })),
      }));
      setPhase('idle');
      setActivity(null);
    } catch (err) {
      flushDeltas();
      setPhase('idle');
      setActivity(null);
      // User-initiated Stop (AbortError) is not an error — just finalize the
      // partial turn cleanly, no error breadcrumb.
      const aborted = (err as Error).name === 'AbortError';
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((r): r is Extract<AgentRun, { type: 'text' }> => r.type === 'text')
          .map(r => r.text)
          .join('\n\n'),
        trace: (m.trace ?? []).map(n => (n.status === 'error' ? n : { ...n, status: aborted ? 'done' as const : n.status })),
        ...(aborted
          ? {}
          : { runs: [...(m.runs ?? []), { type: 'tool' as const, name: 'error', state: 'error' as const, output: (err as Error).message }] }),
      }));
    } finally {
      abortRef.current = null;
    }
  }, [agent.slug, messages, isStreaming, handleEvent, appendToLatestAgent, flushDeltas]);

  // Abort the in-flight turn (Stop button). The reader loop throws AbortError,
  // which the catch above treats as a clean finalize (no error breadcrumb).
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    flushDeltas();
    setPhase('idle');
    setActivity(null);
  }, [flushDeltas]);

  const handlePickSuggestion = useCallback((prompt: string) => {
    setComposerValue(prompt);
    void sendMessage(prompt);
  }, [sendMessage]);

  // Handoff from another page (e.g. the Briefings composer): a stashed
  // { question, contextTitle, context } starts this chat — the context rides
  // inside the first message so the agent (the team lead, agents[0]) can
  // answer against it. One-shot: the stash is cleared before sending.
  const handoffSentRef = useRef(false);
  useEffect(() => {
    if (handoffSentRef.current) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('vocion_chat_handoff');
      if (raw) {
        sessionStorage.removeItem('vocion_chat_handoff');
      }
    } catch {
      return;
    }
    if (!raw) {
      return;
    }
    handoffSentRef.current = true;
    try {
      const { question, contextTitle, context, excerpt } = JSON.parse(raw) as { question: string; contextTitle: string; context: string; excerpt?: string };
      const parts = [question];
      if (excerpt) {
        parts.push(`---\nThe question is specifically about this highlighted passage:\n> ${excerpt.replaceAll('\n', '\n> ')}`);
      }
      parts.push(`---\nCONTEXT — "${contextTitle}" (carried over from the Briefings page):\n\n${context}`);
      void sendMessage(parts.join('\n\n'));
    } catch {
      /* malformed stash — ignore */
    }
  }, [sendMessage]);

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
  }, []);

  // "New chat" — explicitly forget THIS agent's thread so the next send
  // starts a fresh persisted one and a later remount doesn't resume it.
  const handleClear = useCallback(() => {
    resetTranscript();
    clearActiveConversation(agent.slug);
  }, [resetTranscript, agent.slug]);

  // Switching agents shows that agent's own thread: drop the current
  // transcript and let the resume effect hydrate the target agent's saved
  // conversation (the slug change re-fires it). The previous agent's saved
  // thread is left intact, so switching back resumes it.
  const handleSwitchAgent = useCallback((slug: string) => {
    // Explicit switch = a FRESH chat with that agent (the reported bug was
    // switching landing you in an old thread). Persist the choice so a refresh
    // keeps you here; abandon any prior saved thread for that agent.
    freshSwitchRef.current = true;
    hydratedSlugRef.current = null;
    clearActiveConversation(slug);
    writeActiveAgent(slug);
    resetTranscript();
    setCurrentSlug(slug);
  }, [resetTranscript]);

  // Inline citation tap — open the Sources drawer focused on that `[n]`.
  const handleCitationClick = useCallback((n: number) => {
    setFocusCitation(n);
    setSourcesOpen(true);
  }, []);

  /* --------------------------------------------------------------- */
  /* Render                                                          */
  /* --------------------------------------------------------------- */

  return (
    <div className="relative flex h-full flex-1 flex-col">
      {/* The single small chat menu — portaled into the shell top bar beside
          the account menu, so the conversation canvas stays clean. */}
      <ShellBarActionsPortal>
        <div className="flex items-center gap-1">
          {/* Agent title = the switcher (caret dropdown). The ⋯ menu is a
              single New-chat action for now — switching lives on the title,
              not duplicated in the menu. */}
          <AgentSwitcher
            agents={agents}
            currentSlug={agent.slug}
            onSwitch={handleSwitchAgent}
            label={agent.name}
            variant="bar"
          />
          <ChatMenu onNewChat={handleClear} />
        </div>
      </ShellBarActionsPortal>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {!booted || (resuming && messages.length === 0)
            ? (
                // One stable skeleton until the restore + resume settles, so a
                // reload reveals the final view in a single transition instead
                // of flashing default-agent → chips → transcript.
                <div className="flex flex-1 flex-col justify-end gap-4 px-4 py-6" aria-hidden>
                  {[80, 55, 68].map((w, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                      <div className="h-16 animate-pulse rounded-2xl bg-muted/50" style={{ width: `${w}%` }} />
                    </div>
                  ))}
                </div>
              )
            : messages.length === 0
              ? (
                  <EmptyState
                    greeting={emptyGreeting}
                    suggestions={emptyChips}
                    suggestionsLoading={emptyChipsLoading}
                    onPick={handlePickSuggestion}
                    titleSlot={(
                      <AgentSwitcher
                        agents={agents}
                        currentSlug={agent.slug}
                        onSwitch={handleSwitchAgent}
                        label={emptyGreeting?.workspace ?? agent.name}
                        variant="title"
                      />
                    )}
                  />
                )
              : (
                  <MessageList
                    messages={messages}
                    agentName={agent.name}
                    streaming={isStreaming}
                    activity={activity}
                    onShowSources={() => { setFocusCitation(null); setSourcesOpen(true); }}
                    onCitationClick={handleCitationClick}
                  />
                )}

          {pendingHitl && (
            <HitlGate
              gate={pendingHitl}
              onApprove={handleApproveHitl}
              onReject={handleRejectHitl}
              disabled={isStreaming}
            />
          )}

          <ChatComposer
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={() => void sendMessage(composerValue)}
            disabled={isStreaming}
            streaming={isStreaming}
            onStop={handleStop}
            placeholder={composerPlaceholder}
          />
        </div>

        <SourcesPanel
          documents={allDocuments}
          open={sourcesOpen && allDocuments.length > 0}
          onClose={() => setSourcesOpen(false)}
          focusCitation={focusCitation}
        />
      </div>
    </div>
  );
}
