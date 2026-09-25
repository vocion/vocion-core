'use client';

/**
 * One conversation, expanded: the transcript on the left, ONE artifact on the
 * right (`?artifact=<id>`).
 *
 * The pane is not a dashboard. Whatever the agent last created or changed is
 * what is open, unless the person opened something else from a chip or the
 * log — so "make the third column currency" changes the thing they are
 * looking at rather than adding a seventh tile to a grid nobody arranged.
 *
 * The open artifact travels back to the agent as the turn's page context
 * (`record: {type: 'artifact'}`), which is what makes "this", "it" and "the
 * table" resolvable without the person naming an id.
 *
 * Deliberately NOT touched here: the composer. It is its own component with
 * its own queue/steer behaviour (#352) — this view only lays the two columns
 * out and hands it the same `useComposerQueueProps` spread the full page and
 * the rail use. It never receives a disabled state for a turn in flight.
 */

import type { ArtifactEntry } from './artifactReducer';
import type { AgentSurfaceRequest } from '@/features/dashboard/chat/agentSurface';
import type { AgentOption, ChatMessageArtifact } from '@/features/dashboard/chat/types';
import type { ArtifactPayload } from '@/services/agents/types';
import type { PageContext } from '@/services/chat/pageContext';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useViewportBelow } from '@/components/ui/useMobile';
import { AGENT_SURFACE_EVENT, agentSurfaceRequestOf, focusAgentComposer } from '@/features/dashboard/chat/agentSurface';
import { AUTONOMY_SETTING_ID, autonomyFromOption, autonomyMenuSetting } from '@/features/dashboard/chat/autonomyOptions';
import { ChatComposer } from '@/features/dashboard/chat/ChatComposer';
import { useComposerQueueProps } from '@/features/dashboard/chat/composerQueue';
import { HitlGate } from '@/features/dashboard/chat/HitlGate';
import { MessageList } from '@/features/dashboard/chat/MessageList';
import { ModelControl } from '@/features/dashboard/chat/ModelControl';
import { QuotedPassage } from '@/features/dashboard/chat/QuotedPassage';
import { useComposerTags } from '@/features/dashboard/chat/tagSearch';
import { mergeArtifactEvent } from '@/features/dashboard/chat/traceReducer';
import { useChatCommands } from '@/features/dashboard/chat/useChatCommands';
import { useChatSession } from '@/features/dashboard/chat/useChatSession';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { ArtifactPane } from './ArtifactPane';
import { artifactReducer, initialArtifactPaneState, openArtifact } from './artifactReducer';
import { ConversationPageActions } from './ConversationPageActions';
import { ConversationSplit } from './ConversationSplit';
import { SPLIT_STACK_BREAKPOINT } from './splitState';
import { useArtifactEvents } from './useArtifactEvents';

export type ConversationArtifactViewProps = {
  agents: AgentOption[];
  conversationId: number;
  conversationTitle: string;
  agentSlug: string;
  initialArtifacts: ArtifactPayload[];
  /** `?artifact=<id>`; null opens the newest. */
  initialArtifactId: number | null;
  selfId?: string | null;
  workspaceSlug?: string | null;
};

function chipOf(a: ArtifactPayload): ChatMessageArtifact {
  return { id: a.id, title: a.title, kind: a.kind, version: a.version };
}

export function ConversationArtifactView(props: ConversationArtifactViewProps) {
  const router = useRouter();
  const [pane, dispatch] = useReducer(artifactReducer, {
    ...initialArtifactPaneState,
    artifacts: props.initialArtifacts as ArtifactEntry[],
    openId: props.initialArtifactId ?? props.initialArtifacts.at(-1)?.id ?? null,
  });

  const open = openArtifact(pane);
  const openId = open?.id ?? null;
  const openTitle = open?.title ?? '';

  // What the agent is told "this" means. Rebuilt whenever the open artifact
  // changes so a turn sent right after switching panes is about the new one.
  const baseContext = useMemo(() => ({
    path: `/dashboard/chat/${props.conversationId}`,
    title: props.conversationTitle,
    ...(openId === null
      ? {}
      : { record: { type: 'artifact' as const, id: String(openId), label: openTitle, href: `/dashboard/artifacts/${openId}` } }),
  }), [openId, openTitle, props.conversationId, props.conversationTitle]);

  // This view IS the page's agent surface (there is no dock beside a
  // full-page conversation), so it claims every entry-point request — the
  // document frame's "Ask" / "Change" on a highlighted passage, above all —
  // the way the rail does: the passage rides out with the next turn as
  // `page_context.selection`, the prompt lands in the composer, focus follows.
  const [intent, setIntent] = useState<AgentSurfaceRequest | null>(null);
  const pageContext = useMemo<PageContext>(() => {
    const c = intent?.context;
    if (!c) {
      return baseContext;
    }
    return {
      ...baseContext,
      ...(c.record ? { record: c.record } : {}),
      ...(c.selection ? { selection: c.selection } : {}),
      ...(c.refs ? { refs: c.refs } : {}),
      openedFrom: true as const,
    };
  }, [baseContext, intent]);

  const session = useChatSession({
    agents: props.agents,
    pageContext,
    onEvent: (evt, api) => {
      if (evt.type !== 'artifact' || !evt.artifact) {
        return undefined;
      }
      const merged = mergeArtifactEvent(undefined, evt as unknown as { artifact: ArtifactPayload; pending?: boolean; delta?: string });
      if (merged.conversationId !== null && merged.conversationId !== props.conversationId) {
        return undefined;
      }
      dispatch({ type: 'upsert', artifact: merged, focus: !merged.pending });
      api.setActivity(merged.pending ? `Writing ${merged.title}…` : `Updated ${merged.title}`);
      if (!merged.pending) {
        // The transcript chip is set by the shared reducer in `useChatSession`
        // now, so every surface gets it rather than only this one. This view
        // keeps what is genuinely its own: the PANE.
        api.flushDeltas();
      }
      // Not claimed: any other handling of `artifact` still runs.
      return undefined;
    },
  });

  // The composer never locks mid-turn (#352): Enter queues, ⌘⏎ interrupts and
  // sends, Esc stops. This surface renders the same composer as the full page
  // and the rail, so it takes the same queue props — a queue that worked on
  // two surfaces out of three would read as a bug.
  const queueProps = useComposerQueueProps(session);
  const tc = useTranslations('Chat');
  const autonomyCopy = { ask: tc('autonomy_ask'), act: tc('autonomy_act'), askHint: tc('autonomy_ask_hint'), actHint: tc('autonomy_act_hint') };
  // The open artifact is this surface's record, so `(+)` offers it alongside
  // `@artifact` and `@page` — and the `@` popover resolves the same list. All
  // three surfaces get the tags, because one that only worked on two of them
  // would read as a bug.
  const tagProps = useComposerTags(props.agents, pageContext);
  // `/new` from the artifact view is a different page: the fresh thread opens there.
  const onCommand = useChatCommands(() => router.push('/dashboard/chat?new=1'));

  // Open THIS conversation (the hook boots on the last-viewed pointer).
  useEffect(() => {
    if (session.booted && session.conversationId !== props.conversationId) {
      void session.handlePickConversation(props.conversationId);
    }
  }, [session.booted, props.conversationId]);

  useArtifactEvents({ conversationId: props.conversationId, isStreaming: session.isStreaming, dispatch });

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onRequest(e: Event) {
      const req = agentSurfaceRequestOf(e);
      if (req.newChat) {
        // A fresh thread is a different page from this one: let the caller navigate.
        return;
      }
      e.preventDefault();
      if (req.prompt !== undefined || req.context) {
        setIntent(req);
        if (req.prompt !== undefined) {
          sessionRef.current.setComposerValue(req.prompt);
        }
        if (req.send && req.prompt?.trim()) {
          void sessionRef.current.sendMessage(req.prompt);
        }
      }
      for (const tag of req.tags ?? []) {
        sessionRef.current.addContextRef(tag);
      }
      focusAgentComposer(rootRef.current);
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
  }, []);
  // A turn went out: the intent has been consumed.
  const turnCount = session.messages.length;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setIntent(null);
  }, [turnCount]);
  const quoted = intent?.context?.selection?.text;

  // The URL names the open artifact, so a link is a link to what you saw.
  useEffect(() => {
    const qs = pane.openId ? `?artifact=${pane.openId}` : '';
    router.replace(`/dashboard/chat/${props.conversationId}${qs}`, { scroll: false });
  }, [pane.openId, props.conversationId, router]);

  const openById = useCallback((id: number) => dispatch({ type: 'open', id }), []);

  // Below `lg` the two panes do not stand side by side: `ConversationSplit`
  // shows ONE, and while an artifact is open that one is the artifact. The
  // layout itself is CSS (so the first paint is right); this boolean is only
  // for what CSS cannot say — that the pane's close control is the way back.
  const stacked = useViewportBelow(SPLIT_STACK_BREAKPOINT);

  // Chips on a RELOADED transcript. A live turn attaches its own through the
  // event seam above; a reloaded one has only the artifacts and their
  // `messageId`, stamped when the assistant turn was persisted. Merged here
  // rather than in the session hook, so the chat surface stays unaware of
  // artifacts and the two PRs touching this area do not collide.
  const messages = useMemo(() => {
    const byMessage = new Map<number, ChatMessageArtifact[]>();
    for (const a of pane.artifacts) {
      if (a.pending || a.messageId === null) {
        continue;
      }
      const list = byMessage.get(a.messageId) ?? [];
      list.push(chipOf(a));
      byMessage.set(a.messageId, list);
    }
    if (byMessage.size === 0) {
      return session.messages;
    }
    return session.messages.map((m) => {
      const hydrated = typeof m.id === 'number' ? byMessage.get(m.id) : undefined;
      if (!hydrated) {
        return m;
      }
      const live = m.artifacts ?? [];
      const ids = new Set(live.map(x => x.id));
      return { ...m, artifacts: [...live, ...hydrated.filter(x => !ids.has(x.id))] };
    });
  }, [pane.artifacts, session.messages]);

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-1 flex-col">
      <ShellBarActionsPortal>
        <ConversationPageActions
          artifactCount={pane.artifacts.length}
          artifactsOpen={pane.openId !== null}
          onOpenArtifacts={() => dispatch({ type: 'open', id: pane.artifacts.at(-1)!.id })}
          onBack={() => router.push('/dashboard/chat')}
        />
      </ShellBarActionsPortal>

      {/* The two panes and the line between them. The widths are the rule and
          the ratio is derived from them, so the transcript keeps its measure
          and the document gets the rest of the window (ConversationSplit). */}
      <ConversationSplit
        conversation={(
          <>
            {/* The title is the flexible half of this row: `truncate` without
                `min-w-0` cannot shrink inside a flex row, so a long
                conversation title pushed the agent's name off the right edge. */}
            <div className="mb-2 flex items-baseline gap-2 px-1">
              <h1 className="min-w-0 truncate text-sm font-medium text-foreground">{props.conversationTitle}</h1>
              <span className="shrink-0 text-xs text-muted-foreground">{session.agent.name}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {session.messages.length === 0 && !session.resuming
                ? <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Nothing here yet — ask for something and it opens beside you.</p>
                : (
                    <MessageList
                      messages={messages}
                      agentName={session.agent.name}
                      streaming={session.isStreaming}
                      activity={session.activity}
                      onShowSources={session.handleShowSources}
                      onCitationClick={session.handleCitationClick}
                      onOpenArtifact={openById}
                    />
                  )}
              {session.pendingHitl && (
                <HitlGate gate={session.pendingHitl} onApprove={session.handleApproveHitl} onReject={session.handleRejectHitl} disabled={session.isStreaming} />
              )}
              {quoted && <QuotedPassage text={quoted} onDrop={() => setIntent(null)} />}
              <ChatComposer
                onCommand={onCommand}
                controls={<ModelControl value={session.modelPrefs} onChange={session.setModelPrefs} />}
                settings={[autonomyMenuSetting(session.autonomy, autonomyCopy, tc('autonomy_thread'))]}
                onSetting={(id, opt) => {
                  const rung = id === AUTONOMY_SETTING_ID ? autonomyFromOption(opt) : null;
                  if (rung) {
                    session.setAutonomy(rung);
                  }
                }}
                value={session.composerValue}
                onChange={session.setComposerValue}
                onSubmit={() => void session.sendMessage(session.composerValue)}
                // Not until the session is on THIS conversation: the hook boots on
                // the last-viewed pointer and switches a beat later, and a line
                // sent in that beat would open a new thread beside the one on
                // screen — then vanish from view when the switch landed.
                disabled={!session.booted || session.conversationId !== props.conversationId}
                streaming={session.isStreaming}
                {...queueProps}
                {...tagProps}
                onStop={session.handleStop}
                placeholder={session.composerPlaceholder}
                pastedText={session.pastedText}
                onPasteText={session.setPastedText}
                onClearPasted={() => session.setPastedText(null)}
                tags={session.contextRefs}
                onAddTag={session.addContextRef}
                onRemoveTag={session.removeContextRef}
              />
            </div>
          </>
        )}
        pane={open
          ? (
              <ArtifactPane
                key={open.id}
                artifact={open}
                selfId={props.selfId}
                workspaceSlug={props.workspaceSlug}
                conflict={pane.conflict}
                onBeginEdit={() => dispatch({ type: 'beginEdit' })}
                onEndEdit={() => dispatch({ type: 'endEdit' })}
                onDismissConflict={() => dispatch({ type: 'dismissConflict' })}
                onUpdated={a => dispatch({ type: 'upsert', artifact: a, focus: true })}
                // Below `lg` the transcript is not on screen beside this
                // (`ConversationSplit`), so closing the pane IS the way back
                // to it and the control says so.
                back={stacked}
                onClose={() => dispatch({ type: 'close' })}
              />
            )
          : null}
      />
    </div>
  );
}
