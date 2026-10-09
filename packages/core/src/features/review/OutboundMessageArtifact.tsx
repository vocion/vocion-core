'use client';

import type { ReactNode } from 'react';
import type { ContentEdit } from './contentKinds';
import type { OutboundMessage, ReviewContent } from '@/libs/actions/types';
import { ChevronDown, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { addressIn, nameOf, splitRecipients } from '@/libs/mail/recipients';
import { cn } from '@/utils/Helpers';

/**
 * THE OUTBOUND MESSAGE, as one artifact — the same shape for every action
 * that puts words in front of someone: a Gmail reply draft, a sent email, a
 * Slack post, a CRM note.
 *
 * Read top to bottom the way the message will be: what it answers (the last
 * messages of the thread, folded to the newest), who it goes to (To and Cc as
 * chips a reviewer can change), the copy itself (the registered renderer for
 * the item's kind, so editing and the rich body are what every card uses),
 * and the signature it will carry. The Why sits above it, said once
 * (`ReviewSurface`), and the decision is on the bar.
 *
 * A presenter fills `card.outbound` with what its channel has; this file
 * never asks which system it is drawing, only which parts were given.
 */

/**
 * "Dana Reyes <dana@kestrel.example>" → "Dana Reyes"; a bare address stays itself.
 * @param header
 */
const shortName = (header: string) => nameOf(header) ?? header.trim();
const split = splitRecipients;

/** One date on the thread, fixed to `en-US` so stories and screenshots read the same everywhere. */
const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : WHEN.format(d);
}

/**
 * Recipients as chips: each one removable, and a field after them that takes
 * another on Enter, comma or leaving it. Read-only when no editor is given.
 * @param props
 * @param props.label - "To", "Cc".
 * @param props.values - The recipients.
 * @param props.onChange - The next list, when editable.
 * @param props.disabled
 */
function RecipientRow(props: { label: string; values: string[]; onChange?: (next: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const added = split(draft);
    if (added.length > 0 && props.onChange) {
      props.onChange([...props.values, ...added.filter(a => !props.values.includes(a))]);
    }
    setDraft('');
  };
  const id = `recipients-${props.label.toLowerCase()}`;
  return (
    <div className="flex min-h-10 items-start gap-3 border-b border-rule py-1.5" data-testid={id}>
      <label htmlFor={props.onChange ? `${id}-input` : undefined} className="w-10 shrink-0 pt-1.5 text-[13px] text-muted-foreground">{props.label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {props.values.map(v => (
          <span
            key={v}
            title={addressIn(v)}
            data-testid={`${id}-chip`}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-soft py-1 pr-1 pl-2.5 text-[13px] text-foreground"
          >
            <span className="truncate">{shortName(v)}</span>
            {shortName(v) !== addressIn(v) && <span className="hidden truncate text-muted-foreground sm:inline">{addressIn(v)}</span>}
            {props.onChange && (
              <button
                type="button"
                aria-label={`Remove ${shortName(v)} from ${props.label}`}
                disabled={props.disabled}
                onClick={() => props.onChange?.(props.values.filter(x => x !== v))}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {props.onChange && (
          <input
            id={`${id}-input`}
            value={draft}
            disabled={props.disabled}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Backspace' && !draft && props.values.length > 0) {
                props.onChange?.(props.values.slice(0, -1));
              }
            }}
            onBlur={commit}
            placeholder={props.values.length === 0 ? 'Add a recipient' : ''}
            aria-label={`Add to ${props.label}`}
            className="h-7 min-w-[8rem] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
        )}
      </div>
    </div>
  );
}

/**
 * What the message answers: the newest message open, the ones before it one
 * tap away, each with who wrote it, when, and its opening words.
 * @param props
 * @param props.thread
 */
function ThreadContext(props: { thread: NonNullable<OutboundMessage['thread']> }) {
  const { messages } = props.thread;
  const [open, setOpen] = useState(false);
  const shown = open ? messages : messages.slice(-1);
  const earlier = messages.length - 1;
  return (
    <section data-testid="outbound-thread" aria-label="The thread this replies to" className="border-b border-rule pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-[12px] text-muted-foreground">
          In reply to
          {props.thread.subject && <span className="text-foreground/80">{` · ${props.thread.subject}`}</span>}
        </h3>
        {props.thread.href && (
          <a href={props.thread.href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            Open thread
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
      <ol className="mt-2 flex flex-col gap-2.5">
        {shown.map(m => (
          <li key={`${m.from}-${m.at}`} className="min-w-0 border-l-2 border-rule pl-3" data-testid="outbound-thread-message">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="truncate font-medium text-foreground">{shortName(m.from)}</span>
              <span className="text-[12px] text-muted-foreground tabular-nums">{when(m.at)}</span>
            </p>
            <p className={cn('mt-0.5 text-[13px] leading-relaxed break-words text-muted-foreground', !open && 'line-clamp-2')}>{m.snippet}</p>
          </li>
        ))}
      </ol>
      {(earlier > 0 || shown.some(m => m.snippet.length > 160)) && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          data-testid="outbound-thread-toggle"
          className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          {open ? 'Show less' : earlier > 0 ? `Show ${earlier} earlier message${earlier === 1 ? '' : 's'}` : 'Show all'}
        </button>
      )}
    </section>
  );
}

export function OutboundMessageArtifact(props: {
  outbound: OutboundMessage;
  item: ReviewContent;
  edit?: ContentEdit;
  /** Present when the reviewer may edit; absent, the artifact reads. */
  onEdit?: (patch: ContentEdit) => void;
  disabled?: boolean;
  /** The short Why, drawn above the thread. */
  why?: ReactNode;
  /** The copy: the registered renderer for the item's kind, built by the shell. */
  children: ReactNode;
}) {
  const { outbound, item, edit } = props;
  const editRecipients = outbound.recipientsEditable && props.onEdit ? props.onEdit : undefined;
  const to = edit?.to !== undefined ? split(edit.to) : outbound.to;
  const cc = edit?.cc !== undefined ? split(edit.cc) : outbound.cc ?? [];
  const email = outbound.channel === 'email';

  return (
    <div data-testid="outbound-artifact" data-channel={outbound.channel} data-mode={outbound.mode} className="flex flex-col gap-4">
      {props.why}
      {outbound.thread && outbound.thread.messages.length > 0 && <ThreadContext thread={outbound.thread} />}
      <div data-testid="outbound-composer" data-comment-field={item.label} className="min-w-0">
        <RecipientRow
          label="To"
          values={to}
          onChange={editRecipients ? next => editRecipients({ to: next.join(', ') }) : undefined}
          disabled={props.disabled}
        />
        {email && (cc.length > 0 || editRecipients) && (
          <RecipientRow
            label="Cc"
            values={cc}
            onChange={editRecipients ? next => editRecipients({ cc: next.join(', ') }) : undefined}
            disabled={props.disabled}
          />
        )}
        {outbound.from && (
          <div className="flex items-center gap-3 border-b border-rule py-2 text-[13px]" data-testid="outbound-from">
            <span className="w-10 shrink-0 text-muted-foreground">From</span>
            <span className="min-w-0 truncate text-foreground/85">{outbound.from}</span>
          </div>
        )}
        <div className="pt-2" data-testid="outbound-body">
          {props.children}
        </div>
        {email && outbound.signature && (
          <div className="mt-3 px-2" data-testid="outbound-signature">
            <p className="text-[13px] leading-relaxed whitespace-pre-line text-foreground/70">{outbound.signature}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{`Signature · added when the ${outbound.mode === 'draft' ? 'draft is created' : 'email is sent'}`}</p>
          </div>
        )}
      </div>
    </div>
  );
}
