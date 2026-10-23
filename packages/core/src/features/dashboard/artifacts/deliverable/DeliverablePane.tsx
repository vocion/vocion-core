'use client';

/**
 * The deliverable pane: the one place a person reviews, edits, presents,
 * downloads and re-uploads a **deck** or a **document** (`docs/decks.md`,
 * "The pane"). One pane for both kinds — a slide and a sheet are both a page.
 *
 *   - **Pages** down the side: the last verify's screenshot of each, or a
 *     live render when there is none (or the page changed since). Click or
 *     arrow keys to select; drag (or Alt+↑/↓) to reorder.
 *   - **The page**, large and live, in a sandboxed frame. Click a line of
 *     text to edit it in place; Enter or leaving commits, Escape undoes.
 *   - **Notes** beneath a slide, edited in place.
 *   - **What the last receipt found on this page**, inline, as advice.
 *
 * Every commit is ONE `edit_deck` / `edit_document` operation batch through
 * `artifacts.update` (`ops`) — the engine the agent uses — and so one version
 * with a one-line summary. The pane shows the result at once (the same ops
 * applied locally) and the engine's answer replaces it; undo is a restore of
 * the version before, the same verb the version menu offers.
 */

import type { ArtifactEntry } from '../artifactReducer';
import type { PageEdit } from './ops';
import type { DeliverableKind, DeliverablePage, PageFinding } from './pages';
import type { RecordRef } from '@/services/chat/pageContext';
import { CopyPlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { applyLocally, planEdit } from './ops';
import { PageFrame } from './PageFrame';
import { deliverablePages, pageDocument, pageFindings, pageSize } from './pages';
import { PresentMode } from './PresentMode';
import { replaceElementText } from './textEdit';
import { useDeckAssets } from './useDeckAssets';

export type DeliverablePaneProps = {
  artifactId: number;
  kind: DeliverableKind;
  title: string;
  spec: Record<string, unknown>;
  /** The head version — what an edit is written on top of. */
  version: number;
  /** An older version, or nothing a person may change. */
  readOnly?: boolean;
  record?: RecordRef;
  /** A write landed: the parent folds the new head into its state. */
  onUpdated?: (artifact: ArtifactEntry) => void;
  /** The history changed (an edit or an undo), so the version menu reloads. */
  onVersionsChanged?: () => void;
  /** Select this page (after an upload); `nonce` makes the same page selectable twice. */
  select?: { key: string; nonce: number } | null;
  presenting?: boolean;
  onPresentingChange?: (presenting: boolean) => void;
  className?: string;
};

const ROOT: Record<DeliverableKind, string> = { deck: '.vocion-slide > section', document: '.sheet' };

export function DeliverablePane(props: DeliverablePaneProps) {
  const t = useTranslations('Deliverable');
  const { kind, artifactId } = props;
  const [pending, setPending] = useState<{ spec: Record<string, unknown>; touched: Set<string> } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ key: string; over: number | null } | null>(null);
  const head = useRef(props.version);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inflight = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    head.current = Math.max(head.current, props.version);
  }, [props.version]);

  const spec = pending?.spec ?? props.spec;
  const pages = useMemo(() => deliverablePages(kind, spec), [kind, spec]);
  const unit = kind === 'deck' ? 'slide' : 'sheet';

  // A selection from outside (an upload's first changed page) wins once.
  const [lastSelect, setLastSelect] = useState<number | null>(null);
  if (props.select && props.select.nonce !== lastSelect) {
    setLastSelect(props.select.nonce);
    setPicked(props.select.key);
  }
  const current = pages.find(p => p.key === picked) ?? pages[0];
  const index = current ? pages.indexOf(current) : -1;

  const assetUrl = useDeckAssets(kind === 'deck' ? (spec as { assets?: Record<string, { url: string; contentType: string }> }).assets : undefined);
  const frameHtml = useCallback((key: string) => pageDocument(kind, spec, key, assetUrl), [kind, spec, assetUrl]);
  const size = pageSize(kind);

  const focusThumb = useCallback((key: string) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-page-thumb="${CSS.escape(key)}"]`)?.focus());
  }, []);

  const undo = useCallback(async (version: number) => {
    const id = toast.pending(t('undoing'));
    try {
      const res = await client.artifacts.restore({ id: artifactId, version });
      head.current = res.version.version;
      props.onUpdated?.(res.artifact as ArtifactEntry);
      props.onVersionsChanged?.();
      toast.update(id, 'success', t('undone', { version: res.version.version }));
    } catch (err) {
      toast.update(id, 'error', t('undoFailed'), { description: (err as { message?: string }).message });
    }
  }, [artifactId, props, t]);

  const commit = useCallback((edit: PageEdit) => {
    if (props.readOnly) {
      return;
    }
    const plan = planEdit(kind, pages, edit);
    if (!plan) {
      return;
    }
    const local = applyLocally(kind, spec, plan.ops);
    if (local) {
      setPending(prev => ({ spec: local, touched: new Set([...(prev?.touched ?? []), ...plan.touched]) }));
    }
    setPicked(plan.select);
    inflight.current++;
    chain.current = chain.current.then(async () => {
      try {
        const res = await client.artifacts.update({ id: artifactId, ops: plan.ops as Array<Record<string, unknown>>, changeSummary: plan.summary, ifVersion: head.current });
        const before = head.current;
        head.current = res.version.version;
        props.onUpdated?.(res.artifact as ArtifactEntry);
        props.onVersionsChanged?.();
        toast.success(t('saved', { summary: plan.summary, version: res.version.version }), {
          action: { label: t('undo'), onClick: () => void undo(before) },
        });
      } catch (err) {
        const message = (err as { message?: string }).message ?? '';
        toast.error(message.includes('conflict') ? t('notSavedConflict') : t('notSaved'), { description: message.includes('conflict') ? t('notSavedConflictHint') : message });
        // What is on screen is not what was written: show the artifact as it stands.
        setPending(null);
      } finally {
        inflight.current--;
        if (inflight.current === 0) {
          setPending(null);
        }
      }
    });
  }, [artifactId, kind, pages, props, spec, t, undo]);

  const onTextEdit = useCallback((e: { path: number; before: string; after: string }) => {
    if (!current) {
      return;
    }
    const html = replaceElementText(current.html, e.path, e.before, e.after);
    if (html === null) {
      toast.error(t('textEditLost'), { description: t('textEditLostHint') });
      return;
    }
    commit({ type: 'text', key: current.key, html });
  }, [commit, current, t]);

  const selectRequest = useCallback((req: { index?: number; to?: 'next' | 'prev' | 'top' | number }) => {
    const to = req.to;
    const target = req.index !== undefined
      ? req.index
      : to === 'next' ? index + 1 : to === 'prev' ? index - 1 : to === 'top' ? 0 : typeof to === 'number' ? to : index;
    const page = pages[Math.max(0, Math.min(pages.length - 1, target))];
    if (page) {
      setPicked(page.key);
    }
  }, [index, pages]);

  const onThumbKey = useCallback((e: React.KeyboardEvent, page: DeliverablePage) => {
    const i = pages.indexOf(page);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      if (e.altKey && !props.readOnly) {
        commit({ type: 'move', key: page.key, to: page.n + step });
        focusThumb(kind === 'deck' ? page.key : String(page.n + step));
        return;
      }
      const next = pages[i + step];
      if (next) {
        setPicked(next.key);
        focusThumb(next.key);
      }
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? pages[0] : pages[pages.length - 1];
      if (next) {
        setPicked(next.key);
        focusThumb(next.key);
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !props.readOnly && pages.length > 1) {
      e.preventDefault();
      commit({ type: 'remove', key: page.key });
    }
  }, [commit, focusThumb, kind, pages, props.readOnly]);

  if (!current) {
    return <p className="p-4 text-sm text-muted-foreground">{t('empty', { unit })}</p>;
  }

  const findings = pageFindings(kind, spec, current);
  const editable = !props.readOnly;

  return (
    <div className={cn('@container/deliverable flex min-h-0 w-full flex-1 flex-col', props.className)} data-deliverable-pane={kind}>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 @2xl/deliverable:flex-row">
        <nav aria-label={t('pages', { unit })} className="shrink-0 @2xl/deliverable:w-44 @2xl/deliverable:overflow-y-auto">
          <ol ref={listRef} className="flex gap-2 overflow-x-auto pb-1 @2xl/deliverable:flex-col @2xl/deliverable:overflow-x-visible">
            {pages.map((page, i) => {
              const selected = page.key === current.key;
              const stale = pending?.touched.has(page.key) ?? false;
              return (
                <li
                  key={page.key}
                  className={cn('relative w-24 shrink-0 @md/deliverable:w-36 @2xl/deliverable:w-full', drag?.over === i && 'before:absolute before:-top-1.5 before:right-0 before:left-0 before:h-0.5 before:bg-primary')}
                  draggable={editable}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', page.key);
                    setDrag({ key: page.key, over: null });
                  }}
                  onDragOver={(e) => {
                    if (drag) {
                      e.preventDefault();
                      if (drag.over !== i) {
                        setDrag({ ...drag, over: i });
                      }
                    }
                  }}
                  onDragEnd={() => setDrag(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag && drag.key !== page.key) {
                      commit({ type: 'move', key: drag.key, to: page.n });
                    }
                    setDrag(null);
                  }}
                  data-page-key={page.key}
                >
                  <button
                    type="button"
                    data-page-thumb={page.key}
                    aria-current={selected ? 'page' : undefined}
                    aria-label={t('pageLabel', { unit, n: page.n, label: page.label || t('untitled') })}
                    aria-keyshortcuts={editable ? 'Alt+ArrowUp Alt+ArrowDown Delete' : undefined}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setPicked(page.key)}
                    onKeyDown={e => onThumbKey(e, page)}
                    className={cn(
                      'group flex w-full flex-col gap-1 rounded-md p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                      selected ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    <span className={cn('relative block w-full overflow-hidden rounded border bg-white', selected ? 'border-primary' : 'border-border')} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
                      {page.image && !stale
                        ? <img src={page.image} alt="" className="absolute inset-0 size-full object-contain" loading="lazy" />
                        : <PageFrame inert html={frameHtml(page.key)} width={size.width} height={size.height} root={ROOT[kind]} title="" className="absolute inset-0" />}
                    </span>
                    <span className="flex min-w-0 items-baseline gap-1 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{page.n}</span>
                      <span className="truncate">{page.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" aria-live="polite" data-deliverable-position>
              {t('position', { unit, n: current.n, total: pages.length })}
              {current.label ? ` · ${current.label}` : ''}
            </span>
            {editable && (
              <>
                <button type="button" onClick={() => commit({ type: 'duplicate', key: current.key })} className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" data-deliverable-add>
                  <CopyPlus className="size-3.5" aria-hidden />
                  {t('add', { unit })}
                </button>
                <button
                  type="button"
                  disabled={pages.length <= 1}
                  onClick={() => commit({ type: 'remove', key: current.key })}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                  data-deliverable-remove
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t('remove', { unit })}
                </button>
              </>
            )}
          </div>

          <PageFrame
            key={current.key}
            html={frameHtml(current.key)}
            width={size.width}
            height={size.height}
            measure={kind === 'document'}
            root={ROOT[kind]}
            title={t('pageLabel', { unit, n: current.n, label: current.label || t('untitled') })}
            editable={editable}
            selectable
            record={props.record}
            onEdit={onTextEdit}
            onSelectRequest={selectRequest}
            className="w-full shrink-0 rounded-md border border-border/70 bg-[#e9e9e4]"
            fitWidth
            frameProps={kind === 'document' ? { 'data-document-iframe': '' } : { 'data-deck-iframe': '' }}
          />
          {editable && <p className="-mt-1 text-[11px] text-muted-foreground">{t('editHint')}</p>}

          {kind === 'deck' && (
            <NotesField
              key={`${current.key}:${current.notes}`}
              notes={current.notes}
              readOnly={!editable}
              label={t('notes')}
              placeholder={t('notesPlaceholder')}
              onCommit={notes => commit({ type: 'notes', key: current.key, notes })}
            />
          )}

          {findings.length > 0 && (
            <section aria-label={t('findingsLabel', { unit })} className="flex flex-col gap-1 border-t border-border/70 pt-2" data-page-findings>
              <h3 className="text-[11px] font-medium text-muted-foreground">{t('findingsHeading', { unit })}</h3>
              <ul className="flex flex-col gap-1 text-xs text-foreground">
                {findings.map((f, i) => (
                // eslint-disable-next-line react/no-array-index-key -- findings have no id; the list is rebuilt per version
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', f.kind === 'buyer' && f.severity === 'block' ? 'bg-brand-amber' : 'bg-muted-foreground/50')} />
                    <span>{findingText(t, f)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {props.presenting && kind === 'deck' && (
          <PresentMode
            artifactId={artifactId}
            title={props.title}
            pages={pages}
            frameHtml={frameHtml}
            start={index}
            onIndex={i => setPicked(pages[i]?.key ?? null)}
            onClose={() => props.onPresentingChange?.(false)}
          />
        )}
      </div>
    </div>
  );
}

function findingText(t: ReturnType<typeof useTranslations<'Deliverable'>>, f: PageFinding): string {
  switch (f.kind) {
    case 'overflow':
      return t('finding.overflow', { px: f.px });
    case 'clipped':
      return t('finding.clipped', { what: f.what });
    case 'small-text':
      return t('finding.smallText', { what: f.what });
    case 'below-footer':
      return t('finding.belowFooter', { what: f.what });
    case 'unknown':
      return t('finding.unknown', { what: f.what });
    case 'asset':
      return t('finding.asset', { what: f.what });
    case 'placeholder':
      return t('finding.placeholder', { what: f.what });
    case 'no-notes':
      return t('finding.noNotes');
    case 'buyer':
      return t('finding.buyer', { finding: f.finding, fix: f.fix });
  }
}

function NotesField(props: { notes: string; readOnly: boolean; label: string; placeholder: string; onCommit: (notes: string) => void }) {
  const [draft, setDraft] = useState(props.notes);
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">{props.label}</label>
      <textarea
        id={id}
        value={draft}
        readOnly={props.readOnly}
        placeholder={props.readOnly ? undefined : props.placeholder}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          if (!props.readOnly && draft.trim() !== props.notes.trim()) {
            props.onCommit(draft);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(props.notes);
          }
        }}
        rows={3}
        maxLength={4000}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        data-deliverable-notes
      />
    </div>
  );
}
