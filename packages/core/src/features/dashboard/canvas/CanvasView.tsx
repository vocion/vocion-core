'use client';

/**
 * The expanded conversation: chat on the left, the canvas of rendered
 * artifacts on the right (`?grid=open`). Same `useChatSession` as the dock
 * and the full-page chat — this view only picks the conversation by id and
 * lays the two columns out. Collapsing returns to `/dashboard/chat`; the
 * rail (R2) links here with `/dashboard/chat/<id>?grid=open`.
 */

import type { AgentOption } from '@/features/dashboard/chat/types';
import type { ArtifactPayload } from '@/services/agents/types';
import { Check, Copy, Download, LayoutGrid, Minimize2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChatComposer } from '@/features/dashboard/chat/ChatComposer';
import { HitlGate } from '@/features/dashboard/chat/HitlGate';
import { MessageList } from '@/features/dashboard/chat/MessageList';
import { useChatSession } from '@/features/dashboard/chat/useChatSession';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { CanvasGrid } from './CanvasGrid';
import { canvasReducer, initialCanvasState } from './canvasReducer';
import { useArtifactEvents } from './useArtifactEvents';

export type CanvasViewProps = {
  agents: AgentOption[];
  conversationId: number;
  conversationTitle: string;
  agentSlug: string;
  initialArtifacts: ArtifactPayload[];
  gridOpen: boolean;
  /** When opened from a saved canvas: its id + name (the header says so). */
  savedCanvas?: { id: number; name: string } | null;
};

export function CanvasView(props: CanvasViewProps) {
  const router = useRouter();
  const [canvas, dispatch] = useReducer(canvasReducer, { ...initialCanvasState, artifacts: props.initialArtifacts });
  const session = useChatSession({
    agents: props.agents,
    agentSlug: props.agentSlug,
    // Live feed (R2 seam): an `artifact` event lands on the canvas the moment
    // the render_* tool runs; the transcript still sees it (not claimed).
    onEvent: (evt) => {
      const artifact = evt.artifact as ArtifactPayload | undefined;
      if (evt.type === 'artifact' && artifact && artifact.conversationId === props.conversationId) {
        dispatch({ type: 'upsert', artifact });
      }
      return false;
    },
  });
  const [gridOpen, setGridOpen] = useState(props.gridOpen);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState(props.savedCanvas?.name ?? props.conversationTitle);
  const [savedAs, setSavedAs] = useState<{ id: number; name: string } | null>(props.savedCanvas ?? null);
  const [exported, setExported] = useState<{ slug: string; files: Array<{ path: string; content: string }>; unsupported: Array<{ id: number; title: string; kind: string; reason: string }> } | null>(null);

  // Open THIS conversation (the hook boots on the last-viewed pointer).
  useEffect(() => {
    if (session.booted && session.conversationId !== props.conversationId) {
      void session.handlePickConversation(props.conversationId);
    }
  }, [session.booted, props.conversationId]);

  useArtifactEvents({ conversationId: props.conversationId, isStreaming: session.isStreaming, dispatch });

  // Esc collapses the grid (not while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      // A dialog (the expand sheet) that just dismissed on this Escape has
      // already claimed it; an open one keeps it. Only a bare Escape collapses.
      if (e.defaultPrevented || document.querySelector('[role="dialog"]')) {
        return;
      }
      if (e.key === 'Escape' && gridOpen && !(t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT'))) {
        setGridOpen(false);
        router.replace(`/dashboard/chat/${props.conversationId}`);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gridOpen, props.conversationId, router]);

  const toggleGrid = useCallback(() => {
    const next = !gridOpen;
    setGridOpen(next);
    router.replace(`/dashboard/chat/${props.conversationId}${next ? '?grid=open' : ''}`);
  }, [gridOpen, props.conversationId, router]);

  const save = useCallback(async () => {
    const name = saveName.trim();
    if (!name) {
      return;
    }
    setSaving(true);
    try {
      const res = await client.artifacts.canvases.save({ conversationId: props.conversationId, name });
      setSavedAs({ id: res.canvas.id, name: res.canvas.name });
    } catch (err) {
      console.warn('canvas: save failed', err);
    } finally {
      setSaving(false);
    }
  }, [saveName, props.conversationId]);

  const exportPage = useCallback(async () => {
    let id = savedAs?.id;
    if (!id) {
      const res = await client.artifacts.canvases.save({ conversationId: props.conversationId, name: saveName.trim() || props.conversationTitle });
      id = res.canvas.id;
      setSavedAs({ id, name: res.canvas.name });
    }
    const out = await client.artifacts.canvases.exportPage({ id });
    setExported(out);
  }, [savedAs, saveName, props.conversationId, props.conversationTitle]);

  const pinnedCount = canvas.artifacts.filter(a => a.pinned).length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ShellBarActionsPortal>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={toggleGrid} aria-pressed={gridOpen} className="gap-1.5">
            <LayoutGrid className="size-4" />
            <span className="hidden sm:inline">{gridOpen ? 'Hide canvas' : `Canvas · ${pinnedCount}`}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/chat')} aria-label="Back to the conversation" className="gap-1.5">
            <Minimize2 className="size-4" />
            <span className="hidden sm:inline">Collapse</span>
          </Button>
        </div>
      </ShellBarActionsPortal>

      <div className={cn('grid min-h-0 flex-1 gap-4', gridOpen ? 'lg:grid-cols-[minmax(24rem,5fr)_minmax(0,7fr)]' : 'grid-cols-1')}>
        {/* Conversation */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h1 className="truncate text-sm font-medium text-foreground">{props.conversationTitle}</h1>
            <span className="text-xs text-muted-foreground">{session.agent.name}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {session.messages.length === 0 && !session.resuming
              ? <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Nothing here yet — ask for something and it appears on the canvas.</p>
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
              <HitlGate gate={session.pendingHitl} onApprove={session.handleApproveHitl} onReject={session.handleRejectHitl} disabled={session.isStreaming} />
            )}
            <ChatComposer
              value={session.composerValue}
              onChange={session.setComposerValue}
              onSubmit={() => void session.sendMessage(session.composerValue)}
              disabled={session.isStreaming || !session.booted}
              streaming={session.isStreaming}
              onStop={session.handleStop}
              placeholder={session.composerPlaceholder}
              pastedText={session.pastedText}
              onPasteText={session.setPastedText}
              onClearPasted={() => session.setPastedText(null)}
            />
          </div>
        </div>

        {/* Canvas */}
        {gridOpen && (
          <aside className="flex min-h-0 flex-col gap-3 overflow-auto rounded-xl border border-border/70 bg-muted/20 p-3" aria-label="Canvas">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="Name this canvas"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                aria-label="Canvas name"
              />
              <Button size="sm" variant="outline" onClick={() => void save()} disabled={saving || !saveName.trim()} className="gap-1.5">
                {savedAs ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                {savedAs ? 'Saved' : 'Save canvas'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void exportPage()} className="gap-1.5" title="Export as a workspace page">
                <Download className="size-3.5" />
                <span className="hidden sm:inline">Export as page</span>
              </Button>
            </div>
            {savedAs && (
              <p className="text-[11px] text-muted-foreground">
                Saved as “
                {savedAs.name}
                ” · listed under Canvases.
              </p>
            )}
            <CanvasGrid state={canvas} dispatch={dispatch} onSend={text => void session.sendMessage(text)} disabled={session.isStreaming || !session.booted} />
          </aside>
        )}
      </div>

      <Sheet open={exported !== null} onOpenChange={open => !open && setExported(null)}>
        <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
          {exported && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Workspace page ·
                  {exported.slug}
                </SheetTitle>
                <SheetDescription>
                  Commit these two files under your workspace’s
                  <code>pages/</code>
                  {' '}
                  directory; the page appears at
                  <code>
                    /dashboard/p/
                    {exported.slug}
                  </code>
                  .
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-4">
                {exported.files.map(f => <ExportFile key={f.path} path={f.path} content={f.content} />)}
                {exported.unsupported.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Not exported</p>
                    <ul className="mt-1 list-disc pl-4">
                      {exported.unsupported.map(u => (
                        <li key={u.id}>
                          {u.title}
                          {' '}
                          (
                          {u.kind}
                          ) —
                          {' '}
                          {u.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ExportFile({ path, content }: { path: string; content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5 text-xs">
        <code className="text-foreground">{path}</code>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard?.writeText(content).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-5 text-foreground">{content}</pre>
    </div>
  );
}
