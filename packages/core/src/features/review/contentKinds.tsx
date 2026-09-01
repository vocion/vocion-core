'use client';

import type { ComponentType } from 'react';
import type { ReviewContent } from '@/libs/actions/types';
import { ExternalLink, FileText, PenLine } from 'lucide-react';
import { useState } from 'react';

/**
 * Content-kind renderers for the review card — kinds register here the way
 * actions register presenters, so a new object type lands by registering a
 * renderer and the card shell never changes. `email` reviews inline and is
 * editable (edit-then-approve); `document` renders as summary + preview +
 * open-side-by-side with a version stamp so nobody decides on a stale render.
 */

export type ContentEdit = { subject?: string; body?: string };

export type ContentRenderProps = {
  item: ReviewContent;
  /** 1-based position in the content list. */
  position: number;
  /** Working copy of the reviewer's edits to this item, when editable. */
  edit?: ContentEdit;
  onEdit?: (patch: ContentEdit) => void;
  defaultExpanded?: boolean;
  disabled?: boolean;
};

const registry = new Map<string, ComponentType<ContentRenderProps>>();

export function registerContentKind(kind: string, component: ComponentType<ContentRenderProps>): void {
  registry.set(kind, component);
}

export function contentKindRenderer(kind: string): ComponentType<ContentRenderProps> {
  return registry.get(kind) ?? UnknownContent;
}

/**
 * A kind nothing registered still shows its payload — a drill, never a blank.
 * @param root0
 * @param root0.item
 */
function UnknownContent({ item }: ContentRenderProps) {
  return (
    <details className="py-2">
      <summary className="cursor-pointer text-[11px] text-muted-foreground">{item.label}</summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] break-words whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}

const fieldClass = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-amber';

function EmailContent({ item, position, edit, onEdit, defaultExpanded, disabled }: ContentRenderProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  if (item.kind !== 'email') {
    return null;
  }
  const subject = edit?.subject ?? item.subject ?? '';
  const body = edit?.body ?? item.body;
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{position}</span>
        <span className="shrink-0 text-[13px] text-muted-foreground">{item.label}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{subject || body.split('\n')[0]}</span>
        <PenLine className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      </button>
      {expanded && (
        <div className="space-y-2 pb-3 pl-9">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">subject</span>
            <input
              className={fieldClass}
              value={subject}
              onChange={ev => onEdit?.({ subject: ev.target.value })}
              disabled={disabled || !onEdit}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">body</span>
            <textarea
              className={`${fieldClass} min-h-28 resize-y leading-relaxed`}
              value={body}
              onChange={ev => onEdit?.({ body: ev.target.value })}
              disabled={disabled || !onEdit}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function DocumentContent({ item }: ContentRenderProps) {
  if (item.kind !== 'document') {
    return null;
  }
  return (
    <div className="py-3">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><FileText className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{item.label}</div>
          <div className="text-[11px] text-muted-foreground">
            {[item.format?.toUpperCase(), item.version ? `version ${item.version}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-muted"
        >
          Open side by side
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
      {item.summary && <p className="mt-2 text-sm break-words text-foreground/85">{item.summary}</p>}
      {item.previewHref && (
        <iframe
          src={item.previewHref}
          title={item.label}
          loading="lazy"
          className="mt-3 h-80 w-full rounded-md border border-border bg-background"
        />
      )}
    </div>
  );
}

registerContentKind('email', EmailContent);
registerContentKind('document', DocumentContent);
