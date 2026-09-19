'use client';

/**
 * ONE artifact, full height, beside whatever it belongs to.
 *
 * This is the whole surface (0101): a slim header — title, kind, which
 * version you are looking at, history, save, export, copy link, close — over
 * the artifact itself, which a person can edit in place. Markdown and tables
 * are editable; charts, records, links and files take a title only, because
 * their content comes out of an agent's structured payload and hand-editing
 * it would be a worse version of asking.
 *
 * Every save is a version. Selecting an older version shows it read-only
 * with "Restore this version", which writes a NEW head — history is
 * append-only, so the menu never lies about what happened. Outcomes go to the
 * app's one notification surface (`components/ui/toast`), so a save that
 * FAILED says so instead of leaving someone typing into a dead textarea.
 *
 * If the agent writes while a person has unsaved edits, nothing is
 * clobbered: a banner offers Review (take theirs) or Keep mine (write on
 * top, producing the next version). The reducer decides that; this only
 * renders it.
 *
 * The caller passes `key={artifact.id}`: switching artifacts remounts the
 * pane, so a half-typed edit for one cannot leak onto the next.
 */

import type { ArtifactConflict, ArtifactEntry } from './artifactReducer';
import type { DataTableSpec, MarkdownSpec } from '@/libs/cards/specs';
import type { ArtifactVersionPayload } from '@/services/ArtifactService';
import { Check, Copy, Download, FolderClosed, Pencil, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { ArtifactCard } from './ArtifactCard';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL, authorLabel, relativeTime } from './kinds';
import { MarkdownArtifactEditor } from './MarkdownArtifactEditor';
import { SharePicker } from './SharePicker';
import { TableArtifactEditor } from './TableArtifactEditor';
import { VersionMenu } from './VersionMenu';

const EDITABLE: ReadonlySet<string> = new Set(['markdown', 'table', 'document']);
/**
 * Kinds that are PROSE, and so keep a measure even when the page around them
 * is full-bleed: a markdown artifact would otherwise run a line the width of a
 * monitor, and a document's sheet renders 1:1 at 850px and gains nothing past
 * it. A table or a chart takes whatever width it is given — more columns on
 * screen is the whole point of the extra pixels.
 */
const PROSE: ReadonlySet<string> = new Set(['markdown', 'document']);
/** `DOCUMENT_FRAME_WIDTH` (850px) plus this body's own padding. */
const PROSE_MAX_WIDTH = 'max-w-[882px]';

export type ArtifactPaneProps = {
  artifact: ArtifactEntry;
  /** The signed-in user id, so "you" reads as you in the version list. */
  selfId?: string | null;
  /** Workspace slug, for a link that carries the workspace (`/w/<slug>/…`). */
  workspaceSlug?: string | null;
  conflict?: ArtifactConflict | null;
  onBeginEdit?: () => void;
  onEndEdit?: () => void;
  onDismissConflict?: () => void;
  /** A save or restore landed — the parent folds the new head into its state. */
  onUpdated?: (artifact: ArtifactEntry) => void;
  onClose?: () => void;
  className?: string;
  /**
   * Who scrolls. `pane` (default): the body scrolls inside a bounded pane —
   * the rail, the preview. `page`: the body grows to its content and the page
   * scrolls once — the standalone artifact page, where a pane that scrolled
   * inside a page that also scrolled was two scrollbars for one document
   * (Chris, 2026-09-18).
   */
  scroll?: 'pane' | 'page';
};

export function ArtifactPane(props: ArtifactPaneProps) {
  const { artifact } = props;
  const Icon = ARTIFACT_KIND_ICON[artifact.kind];
  // Drafts are null until the person types, and the rendered value falls back
  // to the artifact. That way an agent edit landing mid-read updates the
  // header on its own — no effect syncing state to props, and nothing to
  // reset when a different artifact takes the pane (the caller keys us by id).
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersionPayload[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewing, setViewing] = useState<ArtifactVersionPayload | null>(null);
  const [exported, setExported] = useState<Awaited<ReturnType<typeof client.artifacts.exportPage>> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Focus the field the person just opened. `autoFocus` is banned (it steals
  // focus on mount for everyone, including screen-reader users); focusing in
  // response to the click that opened the field is the accessible form.
  useEffect(() => {
    if (editingTitle) {
      titleRef.current?.focus();
    }
  }, [editingTitle]);
  useEffect(() => {
    if (editingFolder) {
      folderRef.current?.focus();
    }
  }, [editingFolder]);

  const title = titleDraft ?? artifact.title;
  const folder = folderDraft ?? artifact.folder ?? '';

  const shown = viewing ? { ...artifact, title: viewing.title, spec: viewing.spec, version: viewing.version } : artifact;
  const historical = viewing !== null && viewing.version !== artifact.version;
  const dirty = draft !== null || (titleDraft !== null && titleDraft.trim() !== artifact.title);

  const loadVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      setVersions(await client.artifacts.versions({ id: artifact.id, limit: 50 }));
    } catch (err) {
      console.warn('artifacts: could not load versions', err);
    } finally {
      setLoadingVersions(false);
    }
  }, [artifact.id]);

  const save = useCallback(async (opts: { force?: boolean } = {}) => {
    if (saving) {
      return;
    }
    setSaving(true);
    // One toast per save, rewritten in place when it settles. A failed save is
    // the case that matters: the person keeps typing into a textarea that has
    // quietly stopped persisting unless something says so.
    const id = toast.pending('Saving…');
    try {
      const res = await client.artifacts.update({
        id: artifact.id,
        ...(title.trim() && title.trim() !== artifact.title ? { title: title.trim() } : {}),
        ...(draft ? { spec: draft } : {}),
        changeSummary: draft ? (artifact.kind === 'document' ? 'Edited HTML by hand' : 'Edited by hand') : 'Retitled',
        ...(opts.force ? {} : { ifVersion: artifact.version }),
      });
      setDraft(null);
      setTitleDraft(null);
      setEditingTitle(false);
      props.onEndEdit?.();
      props.onUpdated?.(res.artifact as ArtifactEntry);
      void loadVersions();
      toast.update(
        id,
        'success',
        res.collapsed ? `Saved into v${res.version.version}` : `Saved as v${res.version.version}`,
        res.collapsed ? { description: 'Folded into your last version — a burst of saves is one entry in the history.' } : undefined,
      );
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'could not save';
      // The conflict banner above already offers Review / Keep mine, so the
      // toast says what happened rather than repeating the choice.
      toast.update(
        id,
        'error',
        message.includes('conflict') ? 'Not saved — the agent changed this while you were editing' : 'Could not save',
        { description: message.includes('conflict') ? 'Review theirs, or keep yours, from the banner above the artifact.' : message },
      );
    } finally {
      setSaving(false);
    }
  }, [artifact.id, artifact.title, artifact.version, draft, title, saving, loadVersions, props]);

  const restore = useCallback(async (version: number) => {
    const id = toast.pending(`Restoring v${version}…`);
    try {
      const res = await client.artifacts.restore({ id: artifact.id, version });
      setViewing(null);
      setDraft(null);
      props.onUpdated?.(res.artifact as ArtifactEntry);
      void loadVersions();
      toast.update(id, 'success', `Restored v${version} as v${res.version.version}`, {
        description: 'The older version is still in the history — restoring never rewrites it.',
      });
    } catch (err) {
      toast.update(id, 'error', `Could not restore v${version}`, { description: (err as { message?: string }).message });
    }
  }, [artifact.id, loadVersions, props]);

  const viewVersion = useCallback(async (version: number) => {
    if (version === artifact.version) {
      setViewing(null);
      return;
    }
    try {
      setViewing(await client.artifacts.version({ id: artifact.id, version }));
    } catch (err) {
      console.warn('artifacts: could not load that version', err);
    }
  }, [artifact.id, artifact.version]);

  // The signed-in link the share picker copies for `me` and `workspace`; the
  // public one comes from the server when the audience is `anyone`.
  const shareHref = useMemo(() => {
    const path = `/dashboard/artifacts/${artifact.id}`;
    return props.workspaceSlug ? `/w/${encodeURIComponent(props.workspaceSlug.toLowerCase())}${path}` : path;
  }, [artifact.id, props.workspaceSlug]);

  const saveFolder = useCallback(async () => {
    setEditingFolder(false);
    const next = folder.trim() || null;
    setFolderDraft(null);
    if ((artifact.folder ?? null) === next) {
      return;
    }
    try {
      const row = await client.artifacts.setFolder({ id: artifact.id, folder: next });
      props.onUpdated?.(row as ArtifactEntry);
      toast.success(next ? `Moved to ${next}` : 'Removed from its folder');
    } catch (err) {
      toast.error('Could not move this artifact', { description: (err as { message?: string }).message });
    }
  }, [artifact.folder, artifact.id, folder, props]);

  const beginEdit = useCallback(() => {
    if (!EDITABLE.has(artifact.kind) || historical) {
      return;
    }
    setDraft(structuredClone(artifact.spec));
    props.onBeginEdit?.();
  }, [artifact.kind, artifact.spec, historical, props]);

  const versionLine = useMemo(() => {
    const who = authorLabel(artifact.authorKind, artifact.authorId, props.selfId);
    return `v${artifact.version} · ${who} · ${relativeTime(artifact.updatedAt)}`;
  }, [artifact.authorKind, artifact.authorId, artifact.updatedAt, artifact.version, props.selfId]);

  return (
    <section className={cn('flex flex-col rounded-xl border border-border/70 bg-background', (props.scroll ?? 'pane') === 'pane' && 'h-full min-h-0', props.className)} aria-label={`Artifact: ${artifact.title}`} data-artifact-pane={artifact.id}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {editingTitle
          ? (
              <input
                ref={titleRef}
                value={title}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => void save()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  } else if (e.key === 'Escape') {
                    setTitleDraft(null);
                    setEditingTitle(false);
                  }
                }}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium text-foreground focus:outline-none"
                aria-label="Artifact title"
              />
            )
          : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="group flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium text-foreground"
                aria-label="Rename this artifact"
              >
                <span className="truncate">{shown.title}</span>
                <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </button>
            )}
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
          {ARTIFACT_KIND_LABEL[artifact.kind]}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground" data-artifact-version>
          {historical ? `Viewing v${shown.version} of ${artifact.version}` : versionLine}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <VersionMenu
            versions={versions}
            headVersion={artifact.version}
            viewing={shown.version}
            selfId={props.selfId}
            loading={loadingVersions}
            onOpenChange={open => open && versions.length === 0 && void loadVersions()}
            onView={v => void viewVersion(v)}
            onRestore={v => void restore(v)}
          />
          {dirty && (
            <Button size="sm" variant="default" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void save()} disabled={saving}>
              <Save className="size-3.5" />
              Save
            </Button>
          )}
          <button type="button" onClick={() => void client.artifacts.exportPage({ id: artifact.id }).then(setExported).catch(e => toast.error('Could not export this artifact', { description: (e as { message?: string }).message }))} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Export as a workspace page">
            <Download className="size-3.5" />
          </button>
          <SharePicker artifactId={artifact.id} title={shown.title} dashboardHref={shareHref} className="size-7" />
          {props.onClose && (
            <button type="button" onClick={props.onClose} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close the artifact">
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <FolderClosed className="size-3" aria-hidden />
        {editingFolder
          ? (
              <input
                ref={folderRef}
                value={folder}
                placeholder="revenue/weekly"
                onChange={e => setFolderDraft(e.target.value)}
                onBlur={() => void saveFolder()}
                onKeyDown={e => e.key === 'Enter' && void saveFolder()}
                className="w-40 rounded border border-border bg-background px-1 py-0.5 text-[11px] focus:outline-none"
                aria-label="Folder"
              />
            )
          : (
              <button type="button" onClick={() => setEditingFolder(true)} className="hover:text-foreground">
                {artifact.folder || 'Add to a folder'}
              </button>
            )}
        {artifact.kind === 'markdown' && !historical && draft === null && (
          <button type="button" onClick={beginEdit} className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
            <Pencil className="size-3" />
            Edit
          </button>
        )}
        {artifact.kind === 'document' && !historical && draft === null && (
          <button type="button" onClick={beginEdit} className="ml-auto inline-flex items-center gap-1 hover:text-foreground" data-document-edit-html>
            <Pencil className="size-3" />
            HTML
          </button>
        )}
        {artifact.kind === 'table' && !historical && draft === null && (
          <button type="button" onClick={beginEdit} className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
            <Pencil className="size-3" />
            Edit cells
          </button>
        )}
      </div>

      {props.conflict && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-brand-amber/10 px-3 py-2 text-xs text-foreground" role="status">
          <span>
            Agent updated this to v
            {props.conflict.theirVersion}
            {' '}
            while you were editing.
          </span>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 hover:bg-muted"
            onClick={() => {
              setDraft(null);
              props.onEndEdit?.();
              props.onDismissConflict?.();
            }}
          >
            Review theirs
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 hover:bg-muted"
            onClick={() => {
              props.onDismissConflict?.();
              void save({ force: true });
            }}
          >
            Keep mine
          </button>
        </div>
      )}

      {historical && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Read-only — this is an older version.</span>
          <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-background" onClick={() => void restore(shown.version)}>
            Restore this version
          </button>
          <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setViewing(null)}>
            Back to current
          </button>
        </div>
      )}

      <div ref={bodyRef} className={cn('p-4', (props.scroll ?? 'pane') === 'pane' ? 'min-h-0 flex-1 overflow-auto' : 'flex-1')} data-artifact-body>
        <div className={cn('flex h-full min-h-0 w-full flex-col', PROSE.has(artifact.kind) && `mx-auto ${PROSE_MAX_WIDTH}`)}>
          {artifact.pending
            ? (
                <div className="animate-pulse space-y-2" aria-label="Writing…">
                  <div className="h-3 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-5/6 rounded bg-muted" />
                </div>
              )
            : draft !== null && artifact.kind === 'markdown'
              ? (
                  <MarkdownArtifactEditor
                    value={String((draft as Partial<MarkdownSpec>).md ?? '')}
                    onChange={md => setDraft({ ...draft, md })}
                    onSave={() => void save()}
                    onCancel={() => {
                      setDraft(null);
                      props.onEndEdit?.();
                    }}
                    disabled={saving}
                  />
                )
              : draft !== null && artifact.kind === 'document'
                ? (
                    <MarkdownArtifactEditor
                      value={String((draft as { html?: string }).html ?? '')}
                      onChange={html => setDraft({ ...draft, html })}
                      onSave={() => void save()}
                      onCancel={() => {
                        setDraft(null);
                        props.onEndEdit?.();
                      }}
                      disabled={saving}
                    />
                  )
                : draft !== null && artifact.kind === 'table'
                  ? (
                      <TableArtifactEditor
                        draft={draft as unknown as DataTableSpec}
                        onChange={next => setDraft(next as unknown as Record<string, unknown>)}
                        onSave={() => void save()}
                        onCancel={() => {
                          setDraft(null);
                          props.onEndEdit?.();
                        }}
                        disabled={saving}
                      />
                    )
                  : <ArtifactCard artifact={shown} surface="artifact" />}
        </div>
      </div>

      {/* Select-to-ask: highlighting inside the pane offers "Ask Vocion",
          which opens the agent surface with the passage quoted. It dispatches
          the existing openAgentSurface event — the composer is untouched. */}
      {artifact.kind !== 'document' && (
        <AskAboutThis
          variant="none"
          selectionRoot="[data-artifact-body]"
          record={{ type: 'artifact', id: String(artifact.id), label: artifact.title, href: `/dashboard/artifacts/${artifact.id}` }}
        />
      )}

      <Sheet open={exported !== null} onOpenChange={open => !open && setExported(null)}>
        <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
          {exported && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Workspace page ·
                  {' '}
                  {exported.slug}
                </SheetTitle>
                <SheetDescription>
                  {exported.unsupported
                    ? `This artifact has no page archetype yet — ${exported.unsupported.reason}.`
                    : 'Commit these two files under your workspace’s pages/ directory; the page appears in the dashboard for everyone.'}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-4">
                {exported.files.map(f => <ExportFile key={f.path} path={f.path} content={f.content} />)}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
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
