'use client';

import type { AgentSurfaceRequest } from './agentSurface';
import type { AgentOption, ChatAttachment } from './types';
import type { OpeningHint } from '@/libs/chat/openingHints';
import type { ConnectReturn } from '@/libs/connect/returnTo';
import type { PageContext } from '@/services/chat/pageContext';
import { MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState as PageEmptyState } from '@/components/ui/empty-state';
import { InlineTitle } from '@/components/ui/inline-title';
import { ShellBarActionsPortal, ShellBarTitlePortal } from '@/features/dashboard/ShellBarActions';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { openPreview, useOpenPreviewRef } from '@/features/preview/previewState';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { setLiveSources } from '@/libs/preview/liveSources';
import { parseSourcesRefId, sourcesPreviewRef } from '@/libs/preview/sourcesRef';
import { AboutRecordChip } from './AboutRecordChip';
import { AGENT_SURFACE_EVENT, agentSurfaceRequestOf, focusAgentComposer, takeChatAbout } from './agentSurface';
import { AUTONOMY_SETTING_ID, autonomyFromOption, autonomyMenuSetting } from './autonomyOptions';
import { ChatComposer } from './ChatComposer';
import { ChatHeaderActions } from './ChatHeaderActions';
import { useComposerQueueProps } from './composerQueue';
import { decisionBlock } from './decisions/DecisionDock';
import { composerAsk, teamLine, teamOf } from './emptyChat';
import { EmptyState } from './EmptyState';
import { LeadIntro, NoAgentsYet, wantsLeadIntro } from './LeadIntro';
import { MessageList } from './MessageList';
import { ModelControl } from './ModelControl';
import { ConversationObjective } from './objectives/ObjectiveStrip';
import { OpeningHints } from './OpeningHints';
import { QuotedPassage } from './QuotedPassage';
import { defaultAgentSlug, hasWorkspaceAgents, parseSearchCommand } from './routing';
import { useComposerTags } from './tagSearch';
import { transcriptOf } from './transcript';
import { useAnswerOnConnectReturn } from './useAnswerOnConnectReturn';
import { useChatCommands } from './useChatCommands';
import { useChatSession } from './useChatSession';
import { usePersonFirstName, WaitingNudge } from './WaitingNudge';
import { workBlock } from './work/RunningWork';

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
 *   <PreviewPanel /> (right-side, optional — an artifact, a record, or a
 *     turn's sources; ONE pane for all three, `sourcesRef.ts`)
 *   <DecisionDock /> (first above the composer, when anything waits)
 *   <ChatComposer />
 */

export type ChatShellProps = {
  /** Agents available to pick from. The caller guarantees at least one entry. */
  agents: AgentOption[];
  /** Pre-fills the composer without sending (e.g. the org chart's seeded "how's the quarter?" prompt). */
  initialComposerValue?: string;
  /** `?attach=<ids>` — files already uploaded (Share to Vocion) that start in the composer. */
  initialAttachments?: ChatAttachment[];
  /** Dynamic workspace-scoped empty-state chips (urgency + capability). */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** The workspace's short name: who an empty conversation says hello as. */
  greeting?: { eyebrow?: string; workspace: string };
  /** A thread the URL names (`?conversation=<id>`) — resume it instead of starting fresh (§9). */
  conversationId?: number | null;
  /**
   * How a connect this thread started came back (`?connect=ok&connector=github`): it answers
   * the setup Decision that opened it — typed, never words put in the person's mouth — or
   * says on that card why it failed. Then the connect params leave the URL.
   */
  connectReturn?: ConnectReturn | null;
  /** `?new=1` — forget this browser session's thread and start fresh (⌘⇧O from a page with no surface). */
  startNew?: boolean;
  /** The ranked opening hints for an empty conversation (`services/chat/openingHints.ts`). */
  openingHints?: OpeningHint[];
  /**
   * `?objective=connect-systems` — a link from an app's page, the checklist or
   * the Connectors page, as the person's own words ("Help me connect the
   * systems Software Factory uses"): sent once, in a fresh thread, as a real
   * turn. The lead answers and raises whatever it decides to; a link never
   * docks a card by itself (founder, 2026-10-09).
   */
  openingAsk?: string | null;
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
 * @param props.initialAttachments - Uploaded files that start in the composer.
 * @param props.suggestions - Empty-state chips.
 * @param props.greeting - Empty-state greeting.
 * @param props.conversationId
 * @param props.startNew
 * @param props.connectReturn - How a connect this thread started came back.
 * @param props.openingAsk - A link's ask, sent once as the person's first message.
 * @param props.openingHints - The ranked opening hints.
 */
export function ChatShell({
  agents,
  initialComposerValue,
  initialAttachments,
  suggestions = [],
  greeting,
  conversationId = null,
  startNew = false,
  connectReturn,
  openingAsk = null,
  openingHints,
}: ChatShellProps) {
  if (agents.length === 0) {
    return <NoAgentsToChatWith />;
  }

  return (
    <ChatShellInner
      agents={agents}
      initialComposerValue={initialComposerValue}
      initialAttachments={initialAttachments}
      suggestions={suggestions}
      greeting={greeting}
      conversationId={conversationId}
      startNew={startNew}
      connectReturn={connectReturn}
      openingAsk={openingAsk}
      openingHints={openingHints}
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
  initialAttachments,
  suggestions = [],
  greeting,
  conversationId = null,
  startNew = false,
  connectReturn,
  openingAsk = null,
  openingHints,
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
  const session = useChatSession({ agents, initialComposerValue, initialAttachments, suggestions, greeting, resumeConversationId: conversationId, pageContext });
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
  // "Sources · N" and an inline `[n]` both open the ONE preview pane — the
  // same pane a record's own page renders from (`ChatDock` established this;
  // this surface's bespoke SourcesPanel drew the same three lines twice,
  // Chris, 2026-09-29). The specific citation is not singled out; the pane
  // lists every source the answer(s) drew on, numbered as cited.
  const openSources = useCallback((messageId?: number) => {
    if (session.conversationId !== null) {
      openPreview(sourcesPreviewRef(session.conversationId, messageId), document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
  }, [session.conversationId]);
  // A STREAMING ANSWER'S SOURCES REACH THE PANE (`liveSources.ts`): published
  // while the turn runs; once the answer is stored, a sources pane opened
  // mid-turn is pointed at that answer, which the server now has.
  const openRef = useOpenPreviewRef();
  const latest = session.messages[session.messages.length - 1];
  const latestDocs = latest?.role === 'assistant' ? latest.documents : undefined;
  useEffect(() => {
    if (session.conversationId === null) {
      return;
    }
    if (session.isStreaming) {
      setLiveSources(session.conversationId, latestDocs ?? null);
      return;
    }
    setLiveSources(session.conversationId, null);
    const open = openRef?.type === 'conversation' ? parseSourcesRefId(openRef.id) : null;
    if (open && open.conversationId === session.conversationId && open.messageId === null && latest?.id) {
      openPreview(sourcesPreviewRef(session.conversationId, latest.id), null);
    }
  }, [session.conversationId, session.isStreaming, latestDocs, latest?.id, openRef]);
  const onCommand = useChatCommands(startNewChat);
  // An address that names a conversation AFTER the page booted (an opening
  // hint's "Resume setting up … →", a link followed in place) opens it: the
  // session read `resumeConversationId` once, at boot.
  const namedRef = useRef(conversationId);
  useEffect(() => {
    if (conversationId === null || conversationId === namedRef.current || !session.booted) {
      namedRef.current = conversationId;
      return;
    }
    namedRef.current = conversationId;
    if (conversationId !== session.conversationId) {
      void sessionRef.current.handlePickConversation(conversationId);
    }
  }, [conversationId, session.booted, session.conversationId]);

  // An empty conversation names how many wait elsewhere, once, softly, in the
  // chip that opens Review (#1264, `emptyChat.ts`); once the person is in a
  // conversation they queue in the dock behind its own (`ConversationDecisions`).
  const waitingCount = session.waitingDecisions.length;
  // The opening hint (`libs/chat/openingHints.ts`): one ranked suggestion,
  // two at most, of which "N things need your attention" is one candidate.
  // Without the server's hints, the plain count stands in.
  const nudge = openingHints
    ? (openingHints.length > 0 ? <OpeningHints hints={openingHints} onSend={session.handlePickSuggestion} /> : null)
    : waitingCount > 0 ? <WaitingNudge count={waitingCount} /> : null;
  // A lead-only workspace opens on its own setup chip — unless the person
  // already started a setup and left it: then the ranker's "Resume setting up
  // … →" takes that one place (`objectives/ObjectiveStrip`).
  const resumeHint = openingHints?.find(h => h.resumes !== undefined) ?? null;
  const leadHint = resumeHint ? <OpeningHints hints={[resumeHint]} onSend={session.handlePickSuggestion} /> : null;
  const firstName = usePersonFirstName();
  // YOUR TEAM IS HERE: the empty conversation's centre, and who the composer asks.
  const team = useMemo(() => teamOf(agents, defaultAgentSlug(agents)).members, [agents]);
  const askPlaceholder = composerAsk(team, (key, values) => t(key, values));
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
  // Back from a login: the agent carries on by itself, once, and the URL is cleaned so a reload never repeats it.
  useAnswerOnConnectReturn({ outcome: connectReturn ?? null, ready: session.booted, decisions: session.openDecisions, answer: session.answerDecision, fail: session.failDecision, pathname, replaceUrl: router.replace });
  // A link that asked for something ("Help me connect …") is sent once, as
  // the person's own message in a fresh thread, when the saved thread has
  // settled; its params leave the URL so a reload never sends it twice.
  const askedRef = useRef(false);
  useEffect(() => {
    if (!openingAsk || !session.booted || askedRef.current) {
      return;
    }
    askedRef.current = true;
    sessionRef.current.handleNewChat();
    const params = new URLSearchParams(window.location.search);
    for (const key of ['objective', 'app', 'named', 'ask']) {
      params.delete(key);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
    // After the reset has rendered, so the message lands in the new thread.
    setTimeout(() => void sessionRef.current.handlePickSuggestion(openingAsk), 0);
  }, [openingAsk, session.booted, router, pathname]);
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
      {/* The page's name is its thread's, in the shell bar where the
          workspace crumb was — click it to rename. A new chat has no name
          yet, so the bar keeps the workspace until the first send. */}
      {session.conversationTitle && (
        <ShellBarTitlePortal>
          <InlineTitle
            value={session.conversationTitle}
            onRename={next => void session.renameConversation(next)}
            label={t('rename_conversation')}
            inputLabel={t('conversation_title')}
            className="max-w-[min(28rem,50vw)] text-[13px] font-medium"
            testId="chat-title"
          />
        </ShellBarTitlePortal>
      )}
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
        {/* `min-w-0` is load-bearing. A flex item's floor is its min-content,
            and one unbroken line in the stream (a reasoning preview, a tool
            result) made that 800px on a 390px phone: the transcript AND the
            composer widened with it and this row's `overflow-hidden` cut the
            right side off (2026-09-25, Safari, measured live in WebKit). */}
        <div className="flex min-w-0 flex-1 flex-col">
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
            : session.messages.length === 0
              ? (
                  hasWorkspaceAgents(agents)
                    ? (
                        <>
                          {/* A workspace on its first day opens on its lead
                              and the three ways to set it up (`LeadIntro`). */}
                          {/* What waits on the person is one soft chip here,
                              never cards: an empty conversation starts warm
                              (`emptyChat.ts`, founder 2026-10-08). */}
                          {wantsLeadIntro(agents)
                            ? <LeadIntro firstName={firstName} team={team} onPick={session.handlePickSuggestion} hint={leadHint} />
                            : (
                                <EmptyState
                                  firstName={firstName}
                                  team={team}
                                  secondLine={teamLine({ workspace: agents.find(a => a.workspaceLabel)?.workspaceLabel ?? session.workspaceName, members: team }, (key, values) => t(key, values))}
                                  nudge={nudge}
                                />
                              )}
                        </>
                      )
                    : <NoAgentsYet />
                )
              : (
                  <MessageList
                    // The Decision this thread waits on, as its latest item.
                    blocks={[workBlock(session), decisionBlock(session)]}
                    messages={session.messages}
                    agentName={session.workspaceName}
                    // The workspace speaks through its lead; a specialist's turn is attributed.
                    ownAgentSlug={defaultAgentSlug(agents)}
                    agents={agents}
                    streaming={session.isStreaming}
                    activity={session.activity}
                    onShowSources={openSources}
                    onDigDeeper={session.digDeeper}
                    onCitationClick={(_n, messageId) => openSources(messageId)}
                    onFeedback={session.handleFeedback}
                    onBuildCard={session.buildFromCard}
                    onSuggestion={session.sendSuggestion}
                    autonomy={session.autonomy}
                    conversationId={session.conversationId}
                  />
                )}

          <ChatComposer
            pinned={<ConversationObjective session={session} />}
            above={(
              <>
                {intent?.context?.record && <AboutRecordChip record={intent.context.record} onDrop={() => setIntent(i => (i?.context ? { ...i, context: { ...i.context, record: undefined } } : i))} />}
                {intent?.context?.selection && <QuotedPassage text={intent.context.selection.text} onDrop={() => setIntent(i => (i?.context ? { ...i, context: { ...i.context, selection: undefined } } : i))} />}
              </>
            )}
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
            placeholder={session.messages.length === 0 && session.openDecisions.length === 0 ? askPlaceholder : (session.composerPlaceholder ?? askPlaceholder)}
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

        {/* An artifact chip, or "Sources · N", opens its preview in the one
            right column. On this route nothing else hosts that column — the
            dock is not mounted here — so the click wrote the URL param and
            nothing drew it (Chris, 2026-09-17: *"clicking on 'Right now…'
            doesn't open anything"*). PreviewPanel paints only when no dock
            owns the column and only while a preview is open. */}
        <PreviewPanel />
      </div>
    </div>
  );
}
