'use client';

import type { AskRecord, AskThread as Thread } from '@/services/inbox/askEvidence';
import { ChevronDown, ExternalLink, PanelRight } from 'lucide-react';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { openPreview } from '@/features/preview/previewState';
import { Link } from '@/libs/I18nNavigation';
import { nameOf } from '@/libs/mail/recipients';
import { recordRef } from '@/services/chat/recordContext';

/** One date on the thread, fixed to `en-US` so stories and screenshots read the same everywhere. */
const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function when(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? WHEN.format(d) : '';
}

const shortName = (header: string) => nameOf(header) ?? header.trim();

/**
 * The records an ask names, each opening in the pane: the deal or contact a
 * decision about an email is really about, by name.
 * @param props - The records.
 * @param props.records - From `services/inbox/askEvidence`.
 */
export function AskRecords({ records }: { records: AskRecord[] }) {
  if (records.length === 0) {
    return null;
  }
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Records" data-testid="ask-records">
      {records.map(r => (
        <li key={r.id}>
          <button
            type="button"
            onClick={ev => openPreview({ type: r.type, id: r.id }, ev.currentTarget)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm hover:bg-surface-soft"
          >
            <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{r.noun}</span>
            <span className="max-w-[16rem] truncate">{r.label}</span>
            <PanelRight className="size-3.5 text-muted-foreground" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The email thread an ask is about, on the ask's page: the other side's
 * latest message in full, the rest of the thread one fold away, the thread in
 * Gmail, and the reply — the pending draft, or a way to ask for one. Each
 * part shows only when it was read (`services/inbox/askEvidence`).
 * @param props - The thread.
 * @param props.thread - The thread as read for this ask.
 * @param props.askId - The ask, so "Draft a reply" carries it as context.
 * @param props.askTitle - Its title, for the same.
 * @param props.agentSlug - The asking agent, who drafts the reply.
 */
export function AskThread({ thread, askId, askTitle, agentSlug }: { thread: Thread; askId: number; askTitle: string; agentSlug: string | null }) {
  const earlier = thread.history.length;
  const who = shortName(thread.counterpart);
  return (
    <section className="mt-4 border-y border-rule" aria-label={thread.subject ? `Email thread: ${thread.subject}` : 'Email thread'} data-testid="ask-thread">
      <div className="flex items-baseline justify-between gap-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium">{thread.subject || 'Email thread'}</p>
        <a href={thread.href} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline" data-testid="ask-thread-open">
          Open in Gmail
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>

      {thread.latest && (
        <article className="border-t border-rule py-3" data-testid="ask-thread-latest">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
            <span className="truncate font-medium text-foreground">{shortName(thread.latest.from)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{when(thread.latest.at)}</span>
          </p>
          <div className="mt-2 max-h-[28rem] overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap">{thread.latest.body}</div>
        </article>
      )}

      {earlier > 0 && (
        <details className="border-t border-rule py-2" data-testid="ask-thread-history">
          <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-4" aria-hidden />
            {thread.latest ? `${earlier} other message${earlier === 1 ? '' : 's'}` : `${earlier} message${earlier === 1 ? '' : 's'}`}
          </summary>
          <ol className="mt-1 flex flex-col gap-2 pb-1">
            {thread.history.map(m => (
              <li key={`${m.from}-${m.at}`} className="min-w-0 border-l-2 border-rule pl-3">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="truncate font-medium text-foreground">{shortName(m.from)}</span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">{when(m.at)}</span>
                </p>
                {m.line && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{m.line}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {thread.draft
        ? (
            <div className="border-t border-rule py-3" data-testid="ask-thread-draft">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium">
                  {thread.draft.mode === 'send' ? 'Reply ready to send' : 'Reply drafted'}
                  {thread.draft.to && <span className="ml-2 text-xs font-normal text-muted-foreground">{`to ${shortName(thread.draft.to)}`}</span>}
                </p>
                <Link href={thread.draft.href} className="inline-flex min-h-10 shrink-0 items-center text-sm text-primary underline-offset-2 hover:underline" data-testid="ask-thread-draft-open">
                  Review and approve
                </Link>
              </div>
              {thread.draft.body && <p className="mt-1 line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{thread.draft.body}</p>}
            </div>
          )
        : agentSlug && (
          <div className="border-t border-rule py-2">
            <AskAboutThis
              record={recordRef('ask', askId, askTitle)}
              label="Draft a reply"
              agentSlug={agentSlug}
              send
              prompt={`Draft a reply to ${who || 'the other side'} in this email thread (Gmail thread ${thread.threadId}${thread.subject ? `, "${thread.subject}"` : ''}). Read the whole thread first, and file the reply as a draft in that thread.`}
            />
          </div>
        )}
    </section>
  );
}
