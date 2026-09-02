'use client';

import type { AgentOption } from './types';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { AgentSwitcher } from './AgentSwitcher';
import { ChatComposer } from './ChatComposer';
import { ChatMenu } from './ChatMenu';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { SourcesPanel } from './SourcesPanel';
import { useChatSession } from './useChatSession';

/**
 * ChatShell — the full-page chat surface.
 *
 * A render wrapper over `useChatSession`, which owns the transcript, the SSE
 * wire, the boot/resume sequence and the conversation pointers. The floating
 * `ChatBubble` renders the same hook with its own chrome, so both surfaces
 * behave identically and resume the same conversation.
 *
 * Agent identity is data-in: the server component that mounts ChatShell
 * passes the available agents (DB rows + the virtual `__search__` entry) and
 * optionally a starting `agentSlug`. The pre-v0.5.2 default to "Sales
 * Assistant" is gone.
 *
 * "Insert quarter, shoot aliens": the surface is messages + composer,
 * period. No permanent header, no picker on the canvas — new chat and
 * agent targeting live behind the single ⋯ menu, portaled into the shell
 * top bar so the conversation canvas stays clean.
 *
 * Component tree:
 *   <AgentSwitcher /> + <ChatMenu /> (portaled into the shell top bar)
 *   <MessageList /> or <EmptyState />
 *   <SourcesPanel /> (right-side, optional)
 *   <HitlGate /> (above composer when pending)
 *   <ChatComposer />
 */

export type ChatShellProps = {
  /** Agents available to pick from. The caller guarantees at least one entry. */
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
  const session = useChatSession({ agents, agentSlug, initialComposerValue, suggestions, greeting });

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
            currentSlug={session.agent.slug}
            onSwitch={session.handleSwitchAgent}
            label={session.agent.name}
            variant="bar"
          />
          <ChatMenu
            onNewChat={session.handleNewChat}
            conversations={session.recentChats}
            onPickConversation={id => void session.handlePickConversation(id)}
          />
        </div>
      </ShellBarActionsPortal>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {!session.booted || (session.resuming && session.messages.length === 0)
            ? (
                // One stable skeleton until the restore + resume settles, so a
                // reload reveals the final view in a single transition instead
                // of flashing default-agent → chips → transcript.
                <div className="flex flex-1 flex-col justify-end gap-4 px-4 py-6" aria-hidden>
                  {[80, 55, 68].map((width, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                      <div className="h-16 animate-pulse rounded-2xl bg-muted/50" style={{ width: `${width}%` }} />
                    </div>
                  ))}
                </div>
              )
            : session.messages.length === 0
              ? (
                  <EmptyState
                    greeting={session.emptyGreeting}
                    suggestions={session.emptyChips}
                    suggestionsLoading={session.emptyChipsLoading}
                    onPick={session.handlePickSuggestion}
                    titleSlot={(
                      <AgentSwitcher
                        agents={agents}
                        currentSlug={session.agent.slug}
                        onSwitch={session.handleSwitchAgent}
                        label={session.emptyGreeting?.workspace ?? session.agent.name}
                        variant="title"
                      />
                    )}
                  />
                )
              : (
                  <MessageList
                    messages={session.messages}
                    agentName={session.agent.name}
                    streaming={session.isStreaming}
                    activity={session.activity}
                    onShowSources={session.handleShowSources}
                    onCitationClick={session.handleCitationClick}
                  />
                )}

          {session.pendingHitl && (
            <HitlGate
              gate={session.pendingHitl}
              onApprove={session.handleApproveHitl}
              onReject={session.handleRejectHitl}
              disabled={session.isStreaming}
            />
          )}

          <ChatComposer
            value={session.composerValue}
            onChange={session.setComposerValue}
            onSubmit={() => void session.sendMessage(session.composerValue)}
            // Also disabled until boot settles: a message sent while the saved
            // thread is still loading would be discarded when the restored
            // transcript lands.
            disabled={session.isStreaming || !session.booted}
            streaming={session.isStreaming}
            onStop={session.handleStop}
            placeholder={session.composerPlaceholder}
          />
        </div>

        <SourcesPanel
          documents={session.allDocuments}
          open={session.sourcesOpen && session.allDocuments.length > 0}
          onClose={() => session.setSourcesOpen(false)}
          focusCitation={session.focusCitation}
          citedIndices={session.citedIndices}
        />
      </div>
    </div>
  );
}
