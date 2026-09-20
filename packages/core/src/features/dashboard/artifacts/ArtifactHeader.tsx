'use client';

/**
 * ONE artifact header, worn by every surface that shows an artifact.
 *
 * It owns three things and nothing else: the **title and kind/version line**,
 * the **tab strip**, and the **action set**. The preview pane, the artifact's
 * own page and the full-screen `/open` wrapper used to assemble their own
 * version of each, which is how the page ended up with no way into a chat and
 * the pane ended up with a one-way HTML button (Chris, 2026-09-18). A surface
 * that cannot support a verb omits it (`actionsFor`); it never draws a
 * different-looking version of it — design principle 6.
 *
 * The meta line is deliberately quiet: the sheet count and the verify verdict,
 * which is what a person needs BEFORE opening the document. The red-team state
 * moved to the Findings tab's badge, and `PDF N pages` moved into the PDF
 * action's tooltip, because neither is more important than getting into the
 * document (Chris: *"this is probably too much context to view at once"*).
 * Nothing here is amber unless it blocks.
 *
 * The strip is icon-led with a label where there is room and icon-only below
 * `@md`, with a real `Tooltip` either way — never a native `title=`.
 */

import type { ReactNode } from 'react';
import type { ArtifactActionId, ArtifactSurface, ArtifactTabDescriptor, ArtifactTabId } from './headerRules';
import type { ArtifactKind } from '@/libs/cards/specs';
import { ArrowLeft, Code2, Download, ExternalLink, FileDown, FileText, MessageSquareText, Pencil, Save, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { stashChatAbout } from '@/features/dashboard/chat/agentSurface';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { openInChatTarget } from './headerRules';
import { ARTIFACT_KIND_LABEL } from './kinds';
import { SharePicker } from './SharePicker';

const TAB_ICON: Record<ArtifactTabId, typeof FileText> = {
  document: FileText,
  html: Code2,
  findings: ShieldAlert,
};

/** The `data-*` hook each tab keeps, because other tests and probes reach for it. */
const TAB_HOOK: Partial<Record<ArtifactTabId, Record<string, string>>> = {
  html: { 'data-document-edit-html': '' },
};

export type ArtifactHeaderProps = {
  surface: ArtifactSurface;
  artifactId: number;
  kind: ArtifactKind;
  title: string;
  /** `v3 · Revenue lead · 2 min ago`, or `Viewing v2 of 5`. */
  versionLine: string;
  /** The quiet meta line — sheet count and the verify verdict. */
  meta?: ReactNode;
  /** The folder control; the pane owns its editing state. */
  folder?: ReactNode;

  tabs: ArtifactTabDescriptor[];
  tab: ArtifactTabId;
  onTab?: (next: ArtifactTabId) => void;

  actions: ArtifactActionId[];
  /** The version menu, which is async and pane-owned. */
  history?: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  onExport?: () => void;
  shareHref?: string;
  /** Rename in place: controlled by the owner, focused and committed here. */
  onTitleChange?: (next: string) => void;
  onTitleCommit?: () => void;
  onTitleCancel?: () => void;
  /** The conversation this artifact came out of, for "Open in chat". */
  conversationId?: number | null;
  pdfHref?: string | null;
  pdfPages?: number | null;
  openHref?: string | null;
  onClose?: () => void;
  /** `/open` only — the way back to the artifact's page. */
  backHref?: string | null;
  className?: string;
};

export function ArtifactHeader(props: ArtifactHeaderProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const renameable = props.onTitleChange !== undefined;

  // Focus the field the person just opened. `autoFocus` is banned — it steals
  // focus on mount for everyone, screen-reader users included.
  useEffect(() => {
    if (editingTitle) {
      titleRef.current?.focus();
    }
  }, [editingTitle]);

  return (
    <div className={cn('@container/artifact flex flex-col', props.className)} data-artifact-header={props.surface}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-3 py-2">
        {props.backHref && (
          <Link href={props.backHref} className="inline-flex shrink-0 items-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to the artifact">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        )}
        {editingTitle && renameable
          ? (
              <input
                ref={titleRef}
                value={props.title}
                onChange={e => props.onTitleChange?.(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  props.onTitleCommit?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setEditingTitle(false);
                    props.onTitleCommit?.();
                  } else if (e.key === 'Escape') {
                    setEditingTitle(false);
                    props.onTitleCancel?.();
                  }
                }}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium text-foreground focus:outline-none"
                aria-label="Artifact title"
              />
            )
          : renameable
            ? (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="group flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium text-foreground"
                  aria-label="Rename this artifact"
                >
                  <span className="truncate">{props.title}</span>
                  <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </button>
              )
            : <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{props.title}</span>}
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
          {ARTIFACT_KIND_LABEL[props.kind]}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground" data-artifact-version>{props.versionLine}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {props.actions.map(id => (
            <HeaderAction key={id} id={id} {...props} />
          ))}
        </span>
      </header>

      {(props.tabs.length > 0 || props.meta || props.folder) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          {props.tabs.length > 0 && (
            <ArtifactTabs tabs={props.tabs} tab={props.tab} onTab={props.onTab} />
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {props.folder}
            {props.meta}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The tab strip: `role="tablist"`, arrows walk it, Home/End jump. The panel
 * each tab controls is rendered by the pane, so the ids are wired by
 * convention (`artifact-tab-<id>` / `artifact-panel-<id>`) rather than threaded
 * through two components.
 * @param props
 * @param props.tabs
 * @param props.tab
 * @param props.onTab
 */
export function ArtifactTabs(props: { tabs: ArtifactTabDescriptor[]; tab: ArtifactTabId; onTab?: (next: ArtifactTabId) => void }) {
  const refs = useRef(new Map<ArtifactTabId, HTMLButtonElement>());

  const move = (from: ArtifactTabId, delta: number | 'first' | 'last') => {
    const i = props.tabs.findIndex(t => t.id === from);
    const next = delta === 'first'
      ? 0
      : delta === 'last'
        ? props.tabs.length - 1
        : (i + delta + props.tabs.length) % props.tabs.length;
    const target = props.tabs[next];
    if (!target) {
      return;
    }
    props.onTab?.(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div role="tablist" aria-label="How to look at this artifact" className="flex items-center gap-0.5" data-artifact-tabs>
      <TooltipProvider>
        {props.tabs.map((t) => {
          const Icon = TAB_ICON[t.id];
          const selected = t.id === props.tab;
          const amber = t.blocking === true && (t.count ?? 0) > 0;
          return (
            <Tooltip key={t.id}>
              <TooltipTrigger asChild>
                <button
                  ref={(el) => {
                    if (el) {
                      refs.current.set(t.id, el);
                    } else {
                      refs.current.delete(t.id);
                    }
                  }}
                  type="button"
                  role="tab"
                  id={`artifact-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`artifact-panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  data-artifact-tab={t.id}
                  {...(TAB_HOOK[t.id] ?? {})}
                  onClick={() => props.onTab?.(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      move(t.id, 1);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      move(t.id, -1);
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      move(t.id, 'first');
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      move(t.id, 'last');
                    }
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-muted hover:text-foreground',
                    selected && 'bg-muted text-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="hidden @md/artifact:inline">{t.label}</span>
                  {t.count !== undefined && t.count > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-px text-[10px] tabular-nums',
                        amber ? 'bg-brand-amber/15 text-brand-amber' : 'bg-muted-foreground/15 text-muted-foreground',
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t.count === undefined || t.count === 0 ? t.label : `${t.label} · ${t.count}`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </div>
  );
}

function IconAction(props: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{props.children}</TooltipTrigger>
        <TooltipContent side="bottom">{props.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const ICON_BUTTON = 'inline-flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground';

function HeaderAction({ id, ...props }: { id: ArtifactActionId } & ArtifactHeaderProps) {
  switch (id) {
    case 'history':
      return props.history ?? null;
    case 'save':
      return (
        <Button size="sm" variant="default" className="h-7 gap-1.5 px-2 text-xs" onClick={props.onSave} disabled={props.saving}>
          <Save className="size-3.5" aria-hidden />
          Save
        </Button>
      );
    case 'export':
      return props.onExport
        ? (
            <IconAction label="Export as a workspace page">
              <button type="button" onClick={props.onExport} className={ICON_BUTTON} aria-label="Export as a workspace page">
                <Download className="size-3.5" aria-hidden />
              </button>
            </IconAction>
          )
        : null;
    case 'share':
      return props.shareHref
        ? <SharePicker artifactId={props.artifactId} title={props.title} dashboardHref={props.shareHref} className="size-7" />
        : null;
    case 'chat':
      return <OpenInChat artifactId={props.artifactId} title={props.title} conversationId={props.conversationId ?? null} />;
    case 'pdf':
      return props.pdfHref
        ? (
            <IconAction label={props.pdfPages == null ? 'PDF' : `PDF · ${props.pdfPages} ${props.pdfPages === 1 ? 'page' : 'pages'}`}>
              <a href={props.pdfHref} target="_blank" rel="noreferrer" className={ICON_BUTTON} aria-label="Open the PDF" data-document-pdf>
                <FileDown className="size-3.5" aria-hidden />
              </a>
            </IconAction>
          )
        : null;
    case 'open':
      return props.openHref
        ? (
            <IconAction label="Open this document full screen">
              <a href={props.openHref} target="_blank" rel="noreferrer" className={ICON_BUTTON} aria-label="Open this document full screen" data-document-open>
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </IconAction>
          )
        : null;
    case 'close':
      return props.onClose
        ? (
            <IconAction label="Close the artifact">
              <button type="button" onClick={props.onClose} className={ICON_BUTTON} aria-label="Close the artifact">
                <X className="size-3.5" aria-hidden />
              </button>
            </IconAction>
          )
        : null;
  }
}

/**
 * One verb, two destinations (`openInChatTarget`): the conversation the
 * artifact came out of with the artifact open beside it, or — when it came out
 * of none — a fresh chat carrying it as the subject.
 * @param props
 * @param props.artifactId
 * @param props.title
 * @param props.conversationId
 */
function OpenInChat(props: { artifactId: number; title: string; conversationId: number | null }) {
  const target = openInChatTarget(props.artifactId, props.conversationId);
  return (
    <IconAction label={props.conversationId ? 'Open in the chat it came from' : 'Open in a new chat'}>
      <Link
        href={target.href}
        className={ICON_BUTTON}
        aria-label="Open in chat"
        data-artifact-open-in-chat
        onClick={() => {
          if (target.stashAbout) {
            stashChatAbout({ type: 'artifact', id: String(props.artifactId), label: props.title, href: `/dashboard/artifacts/${props.artifactId}` });
          }
        }}
      >
        <MessageSquareText className="size-3.5" aria-hidden />
      </Link>
    </IconAction>
  );
}
