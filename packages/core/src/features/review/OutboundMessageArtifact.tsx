'use client';

import type { ReactNode } from 'react';
import type { ContentEdit } from './contentKinds';
import type { OutboundAttachment, OutboundMessage, ReviewContent } from '@/libs/actions/types';
import { Paperclip, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { usePreviewOpener } from '@/features/preview/previewState';
import { addressIn, nameOf, splitRecipients } from '@/libs/mail/recipients';
import { cn } from '@/utils/Helpers';
import { ThreadEvidence } from './ThreadEvidence';

/**
 * THE OUTBOUND MESSAGE, as one artifact — the same shape for every action
 * that puts words in front of someone: a Gmail reply draft, a sent email, a
 * Slack post, a CRM note.
 *
 * Read top to bottom the way the message will be: what it answers (the other
 * side's latest message whole, the rest of the thread folded, `ThreadEvidence`), who it goes to (To and Cc as
 * chips a reviewer can change), the copy itself (the registered renderer for
 * the item's kind, so editing and the rich body are what every card uses),
 * the signature it will carry, and the files that go with it (each opens in
 * the preview panel, so the approver reads exactly what is sent). The Why
 * sits above it, said once (`ReviewSurface`), and the decision is on the bar.
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
 * One attachment: what it is and what it goes as, opening the artifact in the
 * preview panel. One that cannot go says why, before anyone approves.
 * @param props
 * @param props.attachment
 */
function AttachmentChip(props: { attachment: OutboundAttachment }) {
  const a = props.attachment;
  const open = usePreviewOpener({ type: 'artifact', id: String(a.artifactId) });
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={open}
        data-testid="outbound-attachment"
        data-problem={a.problem ? 'true' : undefined}
        title={a.problem ?? `Preview ${a.title}`}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-lg border border-rule px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-hover',
          a.problem && 'border-brand-amber-deep/40',
        )}
      >
        {a.problem
          ? <TriangleAlert className="size-3.5 shrink-0 text-brand-amber-deep" aria-hidden />
          : <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="truncate text-foreground">{a.title}</span>
        {a.meta && <span className="shrink-0 text-[12px] text-muted-foreground">{a.meta}</span>}
      </button>
      {a.problem && <p className="mt-1 text-[12px] text-brand-amber-deep">{a.problem}</p>}
    </li>
  );
}

export function OutboundMessageArtifact(props: {
  outbound: OutboundMessage;
  item: ReviewContent;
  edit?: ContentEdit;
  /** Present when the reviewer may edit; absent, the artifact reads. */
  onEdit?: (patch: ContentEdit) => void;
  disabled?: boolean;
  /** The one-line recommendation, drawn above the thread. */
  lead?: ReactNode;
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
      {props.lead}
      {outbound.thread && (outbound.thread.latest || outbound.thread.messages.length > 0) && (
        <ThreadEvidence
          heading="In reply to"
          subject={outbound.thread.subject}
          href={outbound.thread.href}
          latest={outbound.thread.latest}
          lines={outbound.thread.messages.map(m => ({ from: m.from, at: m.at || null, line: m.snippet }))}
          className="border-b border-rule pb-3"
        />
      )}
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
        {outbound.attachments && outbound.attachments.length > 0 && (
          <section data-testid="outbound-attachments" aria-label="Attachments" className="mt-3 border-t border-rule px-2 pt-3">
            <h3 className="mb-2 text-[12px] text-muted-foreground">
              {`Attached · ${outbound.attachments.length} file${outbound.attachments.length === 1 ? '' : 's'} — open one to see exactly what goes`}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {outbound.attachments.map(a => <AttachmentChip key={a.artifactId} attachment={a} />)}
            </ul>
            <PreviewPanel />
          </section>
        )}
        {email && outbound.signature && (
          <div className="mt-3 px-2" data-testid="outbound-signature">
            <p className="text-[13px] leading-relaxed whitespace-pre-line text-foreground/70">{outbound.signature}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{outbound.modeChoice ? 'Signature · added when it is sent or drafted' : `Signature · added when the ${outbound.mode === 'draft' ? 'draft is created' : 'email is sent'}`}</p>
          </div>
        )}
      </div>
    </div>
  );
}
