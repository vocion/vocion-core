'use client';

import type { AgentSurfaceRequest } from './agentSurface';
import type { AgentOption } from './types';
import type { PageContext } from '@/services/chat/pageContext';
import { MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState as PageEmptyState } from '@/components/ui/empty-state';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { AboutRecordChip } from './AboutRecordChip';
import { AGENT_SURFACE_EVENT, agentSurfaceRequestOf, focusAgentComposer, takeChatAbout } from './agentSurface';
import { AUTONOMY_SETTING_ID, autonomyFromOption, autonomyMenuSetting } from './autonomyOptions';
import { CardDecisionProvider } from './cards/CardDecisions';
import { ChatComposer } from './ChatComposer';
import { ChatHeaderActions } from './ChatHeaderActions';
import { useComposerQueueProps } from './composerQueue';
import { EmptyState, NoAgentsState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { ModelControl } from './ModelControl';
import { QuotedPassage } from './QuotedPassage';
import { defaultAgentSlug, hasWorkspaceAgents, parseSearchCommand } from './routing';
import { SourcesPanel } from './SourcesPanel';
import { useComposerTags } from './tagSearch';
import { transcriptOf } from './transcript';
import { useChatCommands } from './useChatCommands';
import { useChatSession } from './useChatSession';

/**
 * ChatShell — the full-page chat surface.
 *
 * A render wrapper over `useChatSession`, which owns the transcript, the SSE
 * wire, the boot/resume sequence and the conversation pointers. The floating
 * `ChatDock` renders the same hook with its own chrome, so both surfaces
 * behave identically and resume the same conversation.
 *
 * Agent identity is data-in: the server component that mounts ChatShell
 * passes the workspace's agents (DB rows + the virtual `__search__` entry);
 * the surface speaks as the WORKSPACE (§9.10) and nothing is picked. The
 * pre-v0.5.2 default to "Sales Assistant" is gone.
 *
 * "Insert quarter, shoot aliens": the surface is messages + composer,
 * period. No permanent header, no agent picker anywhere (§9.10) — new chat
 * lives behind the single ⋯ menu, portaled into the shell top bar so the
 * conversation canvas stays clean.
 *
 * Component tree:
 *   <HistoryPopover /> + <ChatMenu /> (portaled into the shell top bar)
 *   <MessageList /> or <EmptyState />
 *   <SourcesPanel /> (right-side, optional)
 *   <HitlGate /> (above composer when pending)
 *   <ChatComposer />
 */

export type ChatShellProps = {
  /** Agents available to pick from. The caller guarantees at least one entry. */
  agents: AgentOption[];
  /** Pre-fills the composer without sending (e.g. the org chart's seeded "how's the quarter?" prompt). */
  initialComposerValue?: string;
  /** Dynamic workspace-scoped empty-state chips (urgency + capability). */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Empty-state greeting: org eyebrow + "Ask <workspace>". */
  greeting?: { eyebrow?: string; workspace: string };
  /** A thread the URL names (`?conversation=<id>`) — resume it instead of starting fresh (§9). */
  conversationId?: number | null;
  /** `?new=1` — forget this browser session's thread and start fresh (⌘⇧O from a page with no surface). */
  startNew?: boolean;
};

/**
 * Bails out before `useChatSession` when there is nobody to chat with.
 *
 * `useChatSession` picks a default agent with `agents[0]!` and reads its slug
 * straight away, so an empty list crashed the page rather than showing
 * anything. It reaches here empty in one case: the shell could not resolve a
 * workspace, which is what a stale session cookie from another workspace looks
 * like. `loadChatAgentContext` always appends the virtual search entry, so a
 * workspace that resolved is never empty even before its first agent is
 * authored.
 *
 * The guard sits one level above the hook rather than inside it, matching
 * `PageDock` and `ChatDock`: React lets a component's hooks be skipped
 * entirely by never rendering it, and `useChatSession` does real work on mount
 * — a `client.chatWidget.getState()` call and a hand-off effect that can write
 * a conversation — none of which should run with no agent to run it for.
 * @param props - Component props.
 * @param props.agents - Agents available to pick from. Empty renders the empty state.
 * @param props.initialComposerValue - Text to pre-fill the composer with.
 * @param props.suggestions - Empty-state chips.
 * @param props.greeting - Empty-state greeting.
 * @param props.conversationId
 * @param props.startNew
 */
export function ChatShell({
  agents,
  initialComposerValue,
  suggestions = [],
  greeting,
  conversationId = null,
  startNew = false,
}: ChatShellProps) {
  if (agents.length === 0) {
    return <NoAgentsToChatWith />;
  }

  return (
    <ChatShellInner
      agents={agents}
      initialComposerValue={initialComposerValue}
      suggestions={suggestions}
      greeting={greeting}
      conversationId={conversationId}
      startNew={startNew}
    />
  );
}

/**
 * What the chat page shows when no workspace resolved, in place of a crash.
 *
 * Signing in again is the fix when a session points at a workspace this
 * deployment does not have — the usual cause on a developer's machine, where
 * two checkouts on different ports share one cookie.
 */
function NoAgentsToChatWith() {
  return (
    <div className="flex h-full items-center justify-center">
      <PageEmptyState
        icon={MessagesSquare}
        title="No agents to chat with"
        description="This workspace has no agents available. If you were signed in elsewhere, sign in again — a session from another workspace cannot load this one's agents."
      />
    </div>
  );
}

function ChatShellInner({
  agents,
  initialComposerValue,
  suggestions = [],
  greeting,
  conversationId = null,
  startNew = false,
}: ChatShellProps) {
  const t = useTranslations('Chat');
  const router = useRouter();
  const pathname = usePathname();
  // Intent handed to this surface — a passage highlighted in the transcript
  // ("Reply"), or in a document — rides out with the next turn as
  // `page_context.selection`, exactly as the rail does it.
  const [intent, setIntent] = useState<AgentSurfaceRequest | null>(null);
  const pageContext = useMemo<PageContext | undefined>(() => {
    const c = intent?.context;
    if (!c) {
      return undefined;
    }
    return {
      path: c.path || pathname,
      title: c.title,
      ...(c.record ? { record: c.record } : {}),
      ...(c.selection ? { selection: c.selection } : {}),
      ...(c.refs ? { refs: c.refs } : {}),
      openedFrom: true as const,
    };
  }, [intent, pathname]);
  const session = useChatSession({ agents, initialComposerValue, suggestions, greeting, resumeConversationId: conversationId, pageContext });
  // A card's decision becomes a typed user turn in THIS conversation (backlog 025).
  const recordCardDecision = useCallback((d: { cardId: string; label: string; action: 'approve' | 'reject' | 'defer' | 'undo'; runId?: number }) => {
    if (session.conversationId === null) {
      return;
    }
    void client.conversations.recordCardDecision({ id: session.conversationId, ...d }).catch((err: unknown) => {
      console.warn('card decision was not written to the conversation', err);
    });
  }, [session.conversationId]);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  // Starting over always lands the caret in the box — ⌘⇧O, `/new`, the ⋯ menu,
  // the history popover — so the next words go straight in (Chris, 2026-09-18).
  const startNewChat = useCallback(() => {
    sessionRef.current.handleNewChat();
    focusAgentComposer(null);
  }, []);
  const onCommand = useChatCommands(startNewChat);

  // The approval gate, as a transcript block pinned to the end. `afterIndex`
  // past the last message is how `MessageList` says "after whatever is last"
  // without the caller tracking the index itself.
  const gateBlocks = useMemo(
    () => (session.pendingHitl
      ? [{
          key: 'hitl-gate',
          afterIndex: session.messages.length,
          node: (
            <HitlGate
              gate={session.pendingHitl}
              onApprove={session.handleApproveHitl}
              onReject={session.handleRejectHitl}
              disabled={session.isStreaming}
            />
          ),
        }]
      : []),
    [session.pendingHitl, session.messages.length, session.handleApproveHitl, session.handleRejectHitl, session.isStreaming],
  );
  // Arriving on the page (⌘⇧L, the sidebar, a link) focuses the composer once
  // the saved thread has settled; keyboard-only never has to click the box.
  useEffect(() => {
    if (session.booted) {
      focusAgentComposer(null);
    }
  }, [session.booted]);
  // A turn went out: the quoted passage has been consumed.
  const turnCount = session.messages.length;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setIntent(null);
  }, [turnCount]);
  // `?new=1`: once the saved thread has settled, forget it and clear the URL.
  const startedNew = useRef(false);
  useEffect(() => {
    if (!startNew || !session.booted || startedNew.current) {
      return;
    }
    startedNew.current = true;
    sessionRef.current.handleNewChat();
    // A record carried in without a question ("Chat about this" from a page
    // with no rail) becomes the About chip; the person writes the first line.
    const about = takeChatAbout();
    if (about) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- the URL said "new": one deliberate reset, not a cascade
      setIntent({ context: { path: window.location.pathname, title: document.title, record: about, openedFrom: true } });
    }
    // Drop only `new`: a `preview=` opened beside the fresh thread stays.
    const params = new URLSearchParams(window.location.search);
    params.delete('new');
    const qs = params.toString();
    focusAgentComposer(null);
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  }, [startNew, session.booted, router, pathname]);
  const queueProps = useComposerQueueProps(session);
  // `@` and `(+)` offer the same list: the artifact contract, then the records
  // this surface knows. The full page is not on a record, so there is no page
  // tag here — the rail and the artifact view add theirs.
  const tagProps = useComposerTags(agents);
  const autonomyCopy = {
    ask: t('autonomy_ask'),
    act: t('autonomy_act'),
    askHint: t('autonomy_ask_hint'),
    actHint: t('autonomy_act_hint'),
  };

  // The full-page chat IS this page's agent surface: an entry-point request
  // (the hotkey, a rail control) focuses the composer instead of opening a
  // second surface (032 §6).
  useEffect(() => {
    function onRequest(e: Event) {
      e.preventDefault();
      const req = agentSurfaceRequestOf(e);
      if (req.newChat) {
        sessionRef.current.handleNewChat();
      }
      if (req.prompt !== undefined || req.context) {
        setIntent(req);
        if (req.prompt !== undefined) {
          sessionRef.current.setComposerValue(req.prompt);
        }
      }
      for (const tag of req.tags ?? []) {
        sessionRef.current.addContextRef(tag);
      }
      focusAgentComposer(null);
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
  }, []);

  return (
    <div className="relative flex h-full flex-1 flex-col">
      {/* The single small chat menu — portaled into the shell top bar beside
          the account menu, so the conversation canvas stays clean. */}
      <ShellBarActionsPortal>
        {/* New chat + the conversations dropdown as icons; the ⋯ menu only on a
            phone. No workspace name here — the sidebar says it (2026-09-18). */}
        <ChatHeaderActions
          onNewChat={startNewChat}
          onCopy={session.messages.length > 0 ? () => transcriptOf(session.messages, session.workspaceName) : null}
          history={{
            recent: session.recentChats,
            currentId: session.conversationId,
            onPick: id => void session.handlePickConversation(id),
            search: session.searchConversations,
          }}
        />
      </ShellBarActionsPortal>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {/* The approval gate is a BLOCK IN THE TRANSCRIPT (058's mechanism,
              the same one the dock's review cards use), after the turn that
              raised it — not a strip pinned above the composer. `afterIndex`
              past the last message pins it to the end, and `MessageList`
              re-pins the view when a block moves, as it does for a new
              message. */}
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
            : session.messages.length === 0 && !session.pendingHitl
              ? (
                  hasWorkspaceAgents(agents)
                    ? (
                        <EmptyState
                          greeting={session.emptyGreeting}
                          suggestions={session.emptyChips}
                          suggestionsLoading={session.emptyChipsLoading}
                          onPick={session.handlePickSuggestion}
                        />
                      )
                    : <NoAgentsState />
                )
              : (
                  <CardDecisionProvider value={recordCardDecision}>
                    <MessageList
                      messages={session.messages}
                      agentName={session.workspaceName}
                      // The workspace speaks through its lead; a specialist's turn is attributed.
                      ownAgentSlug={defaultAgentSlug(agents)}
                      streaming={session.isStreaming}
                      activity={session.activity}
                      onShowSources={session.handleShowSources}
                      onCitationClick={session.handleCitationClick}
                      onFeedback={session.handleFeedback}
                      autonomy={session.autonomy}
                      conversationId={session.conversationId}
                      blocks={gateBlocks}
                    />
                  </CardDecisionProvider>
                )}

          <ChatComposer
            above={intent?.context?.selection || intent?.context?.record
              ? (
                  <>
                    {intent.context.record && <AboutRecordChip record={intent.context.record} onDrop={() => setIntent(i => (i?.context ? { ...i, context: { ...i.context, record: undefined } } : i))} />}
                    {intent.context.selection && <QuotedPassage text={intent.context.selection.text} onDrop={() => setIntent(i => (i?.context ? { ...i, context: { ...i.context, selection: undefined } } : i))} />}
                  </>
                )
              : undefined}
            onCommand={onCommand}
            // The thread's settings, in the bar: its rung (done for you / ask
            // first) and its model — one cluster, every surface (2026-09-18).
            controls={<ModelControl value={session.modelPrefs} onChange={session.setModelPrefs} />}
            settings={[autonomyMenuSetting(session.autonomy, autonomyCopy, t('autonomy_thread'))]}
            onSetting={(id, opt) => {
              const rung = id === AUTONOMY_SETTING_ID ? autonomyFromOption(opt) : null;
              if (rung) {
                session.setAutonomy(rung);
              }
            }}
            value={session.composerValue}
            onChange={session.setComposerValue}
            onSubmit={() => void session.sendMessage(session.composerValue)}
            // Streaming never disables the box (Enter queues instead); boot
            // still does, because a message sent while the saved thread is
            // still loading would be discarded when the transcript lands.
            disabled={!session.booted}
            streaming={session.isStreaming}
            {...queueProps}
            {...tagProps}
            onStop={session.handleStop}
            placeholder={session.composerPlaceholder}
            commandHint={parseSearchCommand(session.composerValue).searchOnly ? t('search_mode') : undefined}
            pastedText={session.pastedText}
            onPasteText={session.setPastedText}
            onClearPasted={() => session.setPastedText(null)}
            tags={session.contextRefs}
            onAddTag={session.addContextRef}
            onRemoveTag={session.removeContextRef}
            attachments={session.attachments}
            uploading={session.uploading > 0}
            attachError={session.attachError}
            onDismissAttachError={session.clearAttachError}
            onAttachFiles={files => void session.attachFiles(files)}
            onRemoveAttachment={session.removeAttachment}
          />
        </div>

        {/* An artifact chip opens its preview in the one right column. On
            this route nothing else hosts that column — the dock is not
            mounted here — so the click wrote the URL param and nothing drew
            it (Chris, 2026-09-17: *"clicking on 'Right now…' doesn't open
            anything"*). PreviewPanel paints only when no dock owns the
            column and only while a preview is open. */}
        <PreviewPanel />
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
