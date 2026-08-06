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
import { useLastViewedConversation } from '@/hooks/useLastViewedConversation';
import { client } from '@/libs/Orpc';
import { describeToolCall } from './WorkTimeline';

export type UseChatSessionOptions = {
  /** Agents available to pick from. Caller guarantees at least one entry. */
  agents: AgentOption[];
  /** Fallback suggestions when the active agent has none of its own. */
  suggestions?: Array<{ label: string; prompt: string }>;
};

function toChatMessages(rows: Array<{ role: string; content: string; runsJson?: unknown }>): ChatMessage[] {
  return rows.map(row => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
    runs: (row.runsJson ?? undefined) as AgentRun[] | undefined,
  }));
}

/**
 * Chat session state + streaming logic, shared by the full-page ChatShell
 * and the floating ChatBubble so both surfaces behave identically and stay
 * in sync on "last viewed conversation" (see useLastViewedConversation).
 *
 * On mount, resumes whichever conversation was last VIEWED — on either
 * surface — rather than always starting fresh. Every view change (initial
 * hydration, agent switch, a conversation created on first send, or an
 * explicit loadConversation) persists the new pointer so the other surface
 * resumes from the same place next time it mounts.
 * @param root0 - Hook options.
 * @param root0.agents - Agents available to pick from. Caller guarantees at least one entry.
 * @param root0.suggestions - Fallback suggestions when the active agent has none of its own.
 */
export function useChatSession({ agents, suggestions = [] }: UseChatSessionOptions) {
  const { state: lastViewed, loading: lastViewedLoading, persist } = useLastViewedConversation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState('');
  const [phase, setPhase] = useState<StreamingPhase>('idle');
  const [pendingHitl, setPendingHitl] = useState<HitlGatePayload | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [allDocuments, setAllDocuments] = useState<IndexedDocument[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>(undefined);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  // True only while the hydration effect's client.conversations.get(...) is
  // in flight. Kept separate from lastViewedLoading so `hydrated` doesn't
  // flip true until the persisted conversation's messages have actually
  // landed — closes a race where an early sendMessage (e.g. the Briefings
  // handoff) could start from an empty `messages` array and then get
  // stomped when the hydration fetch resolves afterward with old history.
  const [conversationLoading, setConversationLoading] = useState(false);

  const agent = (currentSlug ? agents.find(a => a.slug === currentSlug) : undefined) ?? agents[0]!;
  const agentEyebrow = agent.eyebrow;
  const agentSuggestions = agent.suggestions?.length ? agent.suggestions : suggestions;
  const isStreaming = phase !== 'idle';

  /* --------------------------------------------------------------- */
  /* Hydration — resume the last-viewed conversation on first mount. */
  /* --------------------------------------------------------------- */

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (lastViewedLoading || hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;

    const fallbackSlug = agents[0]!.slug;
    const targetSlug = lastViewed && agents.some(a => a.slug === lastViewed.agentSlug)
      ? lastViewed.agentSlug
      : fallbackSlug;
    // One-time hydration guarded by hydratedRef above, not a derived-state
    // sync loop — the lint rule can't see that guard.
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setCurrentSlug(targetSlug);

    if (!lastViewed?.conversationId || targetSlug !== lastViewed.agentSlug) {
      return;
    }
    const targetConversationId = lastViewed.conversationId;
    // Same synchronous effect body as setCurrentSlug above, so both land in
    // the same render — `hydrated` must go false before anything (e.g. the
    // handoff effect below) can act on the "resolved" agent slug. One-time
    // hydration guarded by hydratedRef above, not a derived-state sync loop.
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setConversationLoading(true);
    client.conversations.get({ id: targetConversationId })
      .then((conv) => {
        setConversationId(conv.id);
        setMessages(toChatMessages(conv.messages));
      })
      .catch((error) => {
        // conversation gone (deleted) — stay on a fresh conversation
        console.warn('useChatSession: failed to hydrate last-viewed conversation', error);
      })
      .finally(() => {
        setConversationLoading(false);
      });
  }, [lastViewedLoading, lastViewed, agents]);

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

    let activeConversationId = conversationId;
    if (activeConversationId === null && agent.slug !== '__search__') {
      try {
        const conv = await client.conversations.create({ agentSlug: agent.slug });
        activeConversationId = conv.id;
        setConversationId(conv.id);
        persist({ agentSlug: agent.slug, conversationId: conv.id });
      } catch (error) {
        // persistence is best-effort — chat still works ephemerally
        console.warn('useChatSession: failed to create a persisted conversation', error);
      }
    }

    try {
      const resp = await fetch('/rpc/agent/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agent_slug: agent.slug,
          ...(activeConversationId !== null ? { conversation_id: activeConversationId } : {}),
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
          } catch (error) {
            // malformed event — skip it, the stream keeps going
            console.warn('useChatSession: failed to parse SSE event', error);
          }
        }
      }
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
  }, [agent.slug, conversationId, messages, isStreaming, handleEvent, appendToLatestAgent, flushDeltas, persist]);

  const handlePickSuggestion = useCallback((prompt: string) => {
    setComposerValue(prompt);
    void sendMessage(prompt);
  }, [sendMessage]);

  const handoffSentRef = useRef(false);
  useEffect(() => {
    if (handoffSentRef.current || !currentSlug || conversationLoading) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('vocion_chat_handoff');
      if (raw) {
        sessionStorage.removeItem('vocion_chat_handoff');
      }
    } catch (error) {
      console.warn('useChatSession: failed to read handoff stash from sessionStorage', error);
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
    } catch (error) {
      // malformed stash — ignore, nothing to send
      console.warn('useChatSession: failed to parse handoff stash', error);
    }
  }, [sendMessage, currentSlug, conversationLoading]);

  const handleApproveHitl = useCallback(() => {
    setPendingHitl(null);
    void sendMessage('approve');
  }, [sendMessage]);

  const handleRejectHitl = useCallback(() => {
    setPendingHitl(null);
    void sendMessage('reject');
  }, [sendMessage]);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setAllDocuments([]);
    setPendingHitl(null);
    setPhase('idle');
    setConversationId(null);
    persist({ agentSlug: agent.slug, conversationId: null });
  }, [agent.slug, persist]);

  const handleSwitchAgent = useCallback((slug: string) => {
    setCurrentSlug(slug);
    setMessages([]);
    setAllDocuments([]);
    setPendingHitl(null);
    setPhase('idle');
    setConversationId(null);
    persist({ agentSlug: slug, conversationId: null });
  }, [persist]);

  const loadConversation = useCallback(async (id: number) => {
    try {
      const conv = await client.conversations.get({ id });
      setCurrentSlug(conv.agentSlug);
      setConversationId(conv.id);
      setMessages(toChatMessages(conv.messages));
      setAllDocuments([]);
      setPendingHitl(null);
      setPhase('idle');
      persist({ agentSlug: conv.agentSlug, conversationId: conv.id });
    } catch (error) {
      // conversation gone or unreachable — leave current view as-is
      console.warn('useChatSession: failed to load conversation', id, error);
    }
  }, [persist]);

  return {
    agent,
    agentEyebrow,
    agentSuggestions,
    messages,
    composerValue,
    setComposerValue,
    phase,
    isStreaming,
    activity,
    pendingHitl,
    sourcesOpen,
    setSourcesOpen,
    allDocuments,
    conversationId,
    sendMessage,
    handlePickSuggestion,
    handleApproveHitl,
    handleRejectHitl,
    startNewConversation,
    handleSwitchAgent,
    loadConversation,
    hydrated: !lastViewedLoading && !conversationLoading,
  };
}
