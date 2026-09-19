'use client';

import type { ComponentType } from 'react';
import type { ReviewContent } from '@/libs/actions/types';
import { ExternalLink, FileText } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * Content-kind renderers for the review surface — kinds register here the way
 * actions register presenters, so a new object type lands by registering a
 * renderer and the shell never changes. `email` reads as an email and is
 * editable (edit-then-approve); `document` renders as summary + preview +
 * open-side-by-side with a version stamp so nobody decides on a stale render.
 *
 * Each item now owns a TAB of its own, so a renderer draws the pane and
 * nothing else: no expand row, no position pill, no accordion chrome. The
 * chrome came out with the boxed card it belonged to.
 */

export type ContentEdit = { subject?: string; body?: string };

export type ContentRenderProps = {
  /** True for a moment after a conversation rewrite landed on this item. */
  changed?: boolean;
  item: ReviewContent;
  /** Working copy of the reviewer's edits to this item, when editable. */
  edit?: ContentEdit;
  onEdit?: (patch: ContentEdit) => void;
  disabled?: boolean;
};

type Registration = { component: ComponentType<ContentRenderProps>; editable: boolean };

const registry = new Map<string, Registration>();

/**
 * Register a renderer for a content kind.
 * @param kind - The `ReviewContent.kind` this draws.
 * @param component - The renderer.
 * @param opts - `editable` when the kind takes the reviewer's edits (edit-then-approve).
 * @param opts.editable - Whether the kind accepts `onEdit`.
 */
export function registerContentKind(kind: string, component: ComponentType<ContentRenderProps>, opts: { editable?: boolean } = {}): void {
  registry.set(kind, { component, editable: opts.editable ?? false });
}

export function contentKindRenderer(kind: string): ComponentType<ContentRenderProps> {
  return registry.get(kind)?.component ?? UnknownContent;
}

/**
 * Whether this kind takes the reviewer's edits. The shell asks the REGISTRY
 * rather than testing `kind === 'email'` itself, so a new editable kind lands
 * by registering one and the shell never learns its name.
 * @param kind - The `ReviewContent.kind`.
 */
export function contentKindEditable(kind: string): boolean {
  return registry.get(kind)?.editable ?? false;
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

// Inline editing: the text reads like text until you touch it (B-034b §2 —
// soft fills, no chrome borders). The pane's own Edit is the affordance.
const inlineFieldClass = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm outline-none transition hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]';

/**
 * A textarea that is exactly as tall as what it holds.
 *
 * A fixed height with `resize-y` gives a short email an inner scrollbar and a
 * drag grip — two pieces of chrome that say "form field" on a surface meant to
 * read as a message. `field-sizing: content` does this natively in current
 * Chrome; the effect is set from the DOM as well so the height is right in
 * every engine and on first paint, not just after a keystroke.
 * @param props - Value, change handler and the shared field styling.
 * @param props.value - The body text.
 * @param props.onChange - Called with the next body.
 * @param props.className - The field styling to share with the subject.
 * @param props.disabled - Read-only when the caller passes no editor.
 * @param props.label - The accessible name; there is no visible label.
 */
function AutoGrow({ value, onChange, className, disabled, label }: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      className={`${className} [field-sizing:content] resize-none overflow-hidden`}
      value={value}
      onChange={ev => onChange(ev.target.value)}
      disabled={disabled}
    />
  );
}

function EmailContent({ item, edit, onEdit, disabled, changed }: ContentRenderProps) {
  if (item.kind !== 'email') {
    return null;
  }
  const subject = edit?.subject ?? item.subject ?? '';
  const body = edit?.body ?? item.body;
  return (
    <div
      data-changed={changed ? 'true' : undefined}
      data-testid={`email-pane-${item.id}`}
      className={cn(
        // A rewrite that landed while you were reading says where it landed,
        // then gets out of the way. Long transition, no animation on the way
        // in: the tint IS the arrival, the fade is the part you watch.
        'rounded-sm transition-colors duration-[2000ms]',
        changed && 'bg-brand-amber-tint duration-0',
      )}
    >
      {/* An email, not a form. The subject is a subject line with a hairline
          under it, the body grows to its content, and the labels are there for
          a screen reader only — a boxed field inside a boxed row inside a
          boxed card is the nesting `patterns.md` bans outright, and it is what
          made this read as a form. */}
      <label className="block">
        <span className="sr-only">Subject</span>
        <input
          className={`${inlineFieldClass} border-b border-rule text-[17px] font-medium`}
          value={subject}
          placeholder="Subject"
          onChange={ev => onEdit?.({ subject: ev.target.value })}
          disabled={disabled || !onEdit}
          aria-label={`${item.label} subject`}
        />
      </label>
      {/* No <label> wrapper: the control lives inside `AutoGrow`, so the
          association has to travel as an accessible name instead. */}
      <AutoGrow
        label={`${item.label} body`}
        className={`${inlineFieldClass} mt-1 leading-relaxed`}
        value={body}
        onChange={next => onEdit?.({ body: next })}
        disabled={disabled || !onEdit}
      />
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

function ImageContent({ item }: ContentRenderProps) {
  if (item.kind !== 'image') {
    return null;
  }
  return (
    <div className="py-3">
      <a href={item.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border bg-muted/30">
        <img src={item.url} alt={item.label} loading="lazy" className="max-h-[420px] w-full object-contain" />
      </a>
      {item.caption && <p className="mt-2 text-sm break-words text-foreground/85">{item.caption}</p>}
      {item.findings && item.findings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.findings.map(f => (
            <li key={f} className="flex gap-2 text-[13px]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <span className="break-words">{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

registerContentKind('email', EmailContent, { editable: true });
registerContentKind('document', DocumentContent);
registerContentKind('image', ImageContent);
