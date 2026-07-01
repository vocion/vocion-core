'use client';

import type {
  AgentOption,
  AgentRun,
  ChatMessage,
  HitlGatePayload,
  IndexedDocument,
  StreamingPhase,
} from './types';
import { useCallback, useState } from 'react';
import { AgentHeader } from './AgentHeader';
import { ChatComposer } from './ChatComposer';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { SourcesPanel } from './SourcesPanel';

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
 * Component tree:
 *   <AgentHeader />
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
  agentDescription?: string;
  /** Suggestion prompts surfaced in the empty state (fallback — per-agent suggestions win). */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Rendered on the right side of the agent header (e.g. a New Chat button). */
  headerAction?: React.ReactNode;
};

export function ChatShell({
  agents,
  agentSlug,
  agentDescription,
  suggestions = [],
  headerAction,
}: ChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState('');
  const [phase, setPhase] = useState<StreamingPhase>('idle');
  const [pendingHitl, setPendingHitl] = useState<HitlGatePayload | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [allDocuments, setAllDocuments] = useState<IndexedDocument[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>(agentSlug);

  // Callers (`chat/page.tsx`) guarantee at least one entry — the virtual
  // SEARCH_ONLY_AGENT is always appended. The list arrives lead-first, so
  // with no explicit slug the default conversation is the team's Lead.
  const agent = (currentSlug ? agents.find(a => a.slug === currentSlug) : undefined) ?? agents[0]!;
  const agentEyebrow = agent.eyebrow;
  const agentSuggestions = agent.suggestions?.length ? agent.suggestions : suggestions;
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

  const handleEvent = useCallback((evt: { type: string; [k: string]: unknown }) => {
    switch (evt.type) {
      case 'thinking':
        setPhase('thinking');
        return;
      case 'answering':
        setPhase('answering');
        return;
      case 'response_delta': {
        const delta = String(evt.delta ?? '');
        appendToLatestAgent((m) => {
          const runs = m.runs ?? [];
          const last = runs[runs.length - 1];
          if (last && last.type === 'text') {
            return { ...m, runs: [...runs.slice(0, -1), { type: 'text', text: last.text + delta }] };
          }
          return { ...m, runs: [...runs, { type: 'text', text: delta }] };
        });
        return;
      }
      case 'tool_start': {
        const name = String(evt.tool ?? 'tool');
        const input = (evt.input as Record<string, unknown>) ?? {};
        appendToLatestAgent(m => ({
          ...m,
          runs: [...(m.runs ?? []), { type: 'tool', name, input, state: 'pending' }],
        }));
        return;
      }
      case 'tool_end': {
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
        const docs = (evt.documents as IndexedDocument[]) ?? [];
        setAllDocuments(prev => [...prev, ...docs]);
        appendToLatestAgent(m => ({ ...m, documents: [...(m.documents ?? []), ...docs] }));
        return;
      }
      case 'hitl_gate': {
        setPendingHitl(evt.gate as HitlGatePayload);
        return;
      }
      case 'done':
        setPhase('idle');
        return;
      case 'error': {
        setPhase('idle');
        const msg = String(evt.message ?? 'error');
        appendToLatestAgent(m => ({
          ...m,
          runs: [...(m.runs ?? []), { type: 'tool', name: 'error', state: 'error', output: msg }],
        }));
      }
    }
  }, [appendToLatestAgent]);

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

    try {
      const resp = await fetch('/rpc/agent/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agent_slug: agent.slug,
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
    } catch (err) {
      setPhase('idle');
      appendToLatestAgent(m => ({
        ...m,
        runs: [
          ...(m.runs ?? []),
          { type: 'tool', name: 'error', state: 'error', output: (err as Error).message },
        ],
      }));
    }
  }, [agent.slug, messages, isStreaming, handleEvent, appendToLatestAgent]);

  const handlePickSuggestion = useCallback((prompt: string) => {
    setComposerValue(prompt);
    void sendMessage(prompt);
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
    <div className="flex h-full flex-1 flex-col">
      <AgentHeader
        name={agent.name}
        eyebrow={agentEyebrow}
        description={agentDescription ?? agent.description}
        action={headerAction}
        agents={agents}
        currentSlug={agent.slug}
        onSwitch={handleSwitchAgent}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {messages.length === 0
            ? <EmptyState agentName={agent.name} suggestions={agentSuggestions} onPick={handlePickSuggestion} />
            : <MessageList messages={messages} agentName={agent.name} streaming={isStreaming} />}

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
            onClearConversation={messages.length > 0 ? handleClear : undefined}
            disabled={isStreaming}
            placeholder={agent.placeholder}
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
