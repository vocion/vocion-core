import type { Ask } from '@/services/AskService';
import { Check, ExternalLink, MessageSquareReply, X } from 'lucide-react';
import { labelFor } from './askOptions';
import { KIND_LABEL } from './inboxMeta';

/**
 * How a decided ask reads afterwards — the question, the answer, who and when,
 * and whether the team owes a follow-up. Server-rendered; a link filed into a
 * PR or a chat keeps working after the answer is given.
 * @param props
 * @param props.ask
 * @param props.compact - One row in a sheet's receipt list rather than a full card.
 */
export function AskReceipt({ ask, compact = false }: { ask: Ask; compact?: boolean }) {
  const label = ask.decision ? labelFor(ask, ask.decision) : ask.status;
  const Icon = ask.status === 'rejected' ? X : Check;
  const tone = ask.status === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
  return (
    <div className={compact ? 'flex items-start gap-3 px-4 py-3' : 'rounded-md border border-border px-4 py-3'}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{ask.title}</p>
        <p className="mt-0.5 text-sm">
          <span className={`font-medium ${tone}`}>{label}</span>
          {ask.decisionNote && <span className="text-muted-foreground">{` — ${ask.decisionNote}`}</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium">{KIND_LABEL[ask.kind] ?? ask.kind}</span>
          {ask.decidedBy && <span className="truncate font-mono">{ask.decidedBy}</span>}
          {ask.decidedAt && <span>{ask.decidedAt.toLocaleString()}</span>}
          {ask.followUp && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <MessageSquareReply className="size-3" aria-hidden />
              follow-up owed
            </span>
          )}
          {ask.contextUrl && (
            <a href={ask.contextUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
              context
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </p>
      </div>
    </div>
  );
}
