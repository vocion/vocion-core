'use client';

import type { AskRecord, AskThread as Thread } from '@/services/inbox/askEvidence';
import { PanelRight } from 'lucide-react';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { openPreview } from '@/features/preview/previewState';
import { ThreadEvidence } from '@/features/review/ThreadEvidence';
import { Link } from '@/libs/I18nNavigation';
import { nameOf } from '@/libs/mail/recipients';
import { recordRef } from '@/services/chat/recordContext';

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
 * The email thread an ask is about, on the ask's page: the thread as every
 * decision about an email shows it (`ThreadEvidence`, the same block the reply
 * draft's card draws), then the reply — the pending draft, or a way to ask
 * for one. Each
 * part shows only when it was read (`services/inbox/askEvidence`).
 * @param props - The thread.
 * @param props.thread - The thread as read for this ask.
 * @param props.askId - The ask, so "Draft a reply" carries it as context.
 * @param props.askTitle - Its title, for the same.
 * @param props.agentSlug - The asking agent, who drafts the reply.
 */
export function AskThread({ thread, askId, askTitle, agentSlug }: { thread: Thread; askId: number; askTitle: string; agentSlug: string | null }) {
  const who = shortName(thread.counterpart);
  return (
    <section className="mt-4 border-y border-rule py-3" data-testid="ask-thread">
      <ThreadEvidence subject={thread.subject} href={thread.href} latest={thread.latest} lines={thread.history} />

      {thread.draft
        ? (
            <div className="mt-3 border-t border-rule pt-3" data-testid="ask-thread-draft">
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
          <div className="mt-3 border-t border-rule pt-2">
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
