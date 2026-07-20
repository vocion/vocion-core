'use client';

import type {
  AgentOption,
  AgentRun,
  ChatMessage,
  HitlGatePayload,
  IndexedDocument,
  StreamingPhase,
} from './types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { client } from '@/libs/Orpc';
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
  const [allDocuments, setAllDocuments] = useState<IndexedDocument[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>(agentSlug);
  // Live activity line — what the team is doing RIGHT NOW during a long turn
  // (retrieval, subagent delegation, tool runs). Cleared once text streams.
  const [activity, setActivity] = useState<string | null>(null);

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
  const emptyChips = (!isDefaultView && agent.suggestions?.length) ? agent.suggestions : suggestions;
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

  const flushDeltas = useCallback(() => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
    const responseText = pendingResponseRef.current;
    const thinkingText = pendingThinkingRef.current;
    if (!responseText && !thinkingText) {
      return;
    }
    pendingResponseRef.current = '';
    pendingThinkingRef.current = '';
    appendToLatestAgent((m) => {
      let next = m;
      if (thinkingText) {
        next = { ...next, thinkingText: (next.thinkingText ?? '') + thinkingText };
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
      case 'done':
        flushDeltas();
        // Backfill `content` from the streamed text runs. Streaming only
        // accumulates into `runs`; `conversation_history` reads `content`
        // (and drops empty entries), so without this the agent never sees
        // its own prior replies and re-answers earlier turns.
        appendToLatestAgent(m => ({
          ...m,
          content: m.content || (m.runs ?? [])
            .filter((r): r is Extract<AgentRun, { type: 'text' }> => r.type === 'text')
            .map(r => r.text)
            .join('\n\n'),
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

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) {
      return;
    }
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
      } catch {
        /* persistence is best-effort — chat still works ephemerally */
      }
    }
    const conversationId = conversationIdRef.current;

    try {
      const resp = await fetch('/rpc/agent/stream', {
        method: 'POST',
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
      }));
    } catch (err) {
      flushDeltas();
      setPhase('idle');
      appendToLatestAgent(m => ({
        ...m,
        runs: [
          ...(m.runs ?? []),
          { type: 'tool', name: 'error', state: 'error', output: (err as Error).message },
        ],
      }));
    }
  }, [agent.slug, messages, isStreaming, handleEvent, appendToLatestAgent, flushDeltas]);

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

  const handleClear = useCallback(() => {
    setMessages([]);
    setAllDocuments([]);
    setPendingHitl(null);
    setPhase('idle');
    // Next send starts a fresh persisted thread.
    conversationIdRef.current = null;
  }, []);

  // Switching agents starts a fresh conversation — history belongs to the
  // agent it was had with.
  const handleSwitchAgent = useCallback((slug: string) => {
    setCurrentSlug(slug);
    handleClear();
  }, [handleClear]);

  /* --------------------------------------------------------------- */
  /* Render                                                          */
  /* --------------------------------------------------------------- */

  return (
    <div className="relative flex h-full flex-1 flex-col">
      {/* The single small chat menu — portaled into the shell top bar beside
          the account menu, so the conversation canvas stays clean. */}
      <ShellBarActionsPortal>
        <ChatMenu
          onNewChat={handleClear}
          agents={agents}
          currentSlug={agent.slug}
          onSwitch={handleSwitchAgent}
        />
      </ShellBarActionsPortal>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {messages.length === 0
            ? (
                <EmptyState
                  greeting={emptyGreeting}
                  suggestions={emptyChips}
                  onPick={handlePickSuggestion}
                />
              )
            : <MessageList messages={messages} agentName={agent.name} streaming={isStreaming} activity={activity} />}

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
            placeholder={composerPlaceholder}
          />
        </div>

        <SourcesPanel
          documents={allDocuments}
          open={sourcesOpen && allDocuments.length > 0}
          onClose={() => setSourcesOpen(false)}
        />
      </div>
    </div>
  );
}
