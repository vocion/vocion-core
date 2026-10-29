import { ChevronDown, ExternalLink } from 'lucide-react';
import { nameOf } from '@/libs/mail/recipients';
import { cn } from '@/utils/Helpers';

/** One date on the thread, fixed to `en-US` so stories and screenshots read the same everywhere. */
const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function when(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? WHEN.format(d) : '';
}

const shortName = (header: string) => nameOf(header) ?? header.trim();

/** A message as one line: who, when, the opening words. */
export type ThreadEvidenceLine = { from: string; at: string | null; line: string };

/**
 * THE CONVERSATION A DECISION IS ABOUT — one component for every decision
 * about an email: the reply draft's card (`OutboundMessageArtifact`) and the
 * ask that says a reply is owed (`AskThread`), so the two read the same.
 *
 * The other side's latest message is the evidence, so it is shown whole, at a
 * reading measure, with who and when. Every other message is one line in a
 * fold ("12 earlier messages"), and the thread opens in Gmail. Without a
 * whole message (the thread was never read) the newest line stands open and
 * the rest fold; a part with nothing to show is not drawn.
 * @param props - The thread.
 * @param props.heading - What the thread is to this decision ("In reply to").
 * @param props.subject - Its subject.
 * @param props.href - The thread in Gmail.
 * @param props.latest - The other side's latest message, whole.
 * @param props.lines - Every other message, oldest first.
 * @param props.className
 */
export function ThreadEvidence(props: {
  heading?: string;
  subject?: string;
  href?: string;
  latest?: { from: string; at: string | null; body: string } | null;
  lines: readonly ThreadEvidenceLine[];
  className?: string;
}) {
  const { latest } = props;
  const open = latest ? null : props.lines.at(-1) ?? null;
  const folded = open ? props.lines.slice(0, -1) : props.lines;
  if (!latest && !open) {
    return null;
  }
  return (
    <section data-testid="thread-evidence" aria-label={props.subject ? `Email thread: ${props.subject}` : 'Email thread'} className={cn('min-w-0', props.className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-[12px] text-muted-foreground">
          {props.heading ?? 'Email thread'}
          {props.subject && <span className="text-foreground/80">{` · ${props.subject}`}</span>}
        </h3>
        {props.href && (
          <a href={props.href} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[13px] text-primary underline-offset-2 hover:underline" data-testid="thread-open">
            Open in Gmail
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>

      {latest && (
        <article className="mt-1 max-w-[70ch] border-l-2 border-rule pl-3" data-testid="thread-latest">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
            <span className="truncate font-medium text-foreground">{shortName(latest.from)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{when(latest.at)}</span>
          </p>
          <div className="mt-1.5 max-h-[32rem] overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{latest.body}</div>
        </article>
      )}

      {open && (
        <div className="mt-1 max-w-[70ch] border-l-2 border-rule pl-3" data-testid="thread-newest">
          <ThreadLine line={open} />
        </div>
      )}

      {folded.length > 0 && (
        <details className="mt-2" data-testid="thread-history">
          <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5" aria-hidden />
            {`${folded.length} ${latest ? 'other ' : open ? 'earlier ' : ''}message${folded.length === 1 ? '' : 's'}`}
          </summary>
          <ol className="mt-1 flex max-w-[70ch] flex-col gap-2">
            {folded.map(m => (
              <li key={`${m.from}-${m.at}-${m.line.slice(0, 24)}`} className="min-w-0 border-l-2 border-rule pl-3" data-testid="thread-line">
                <ThreadLine line={m} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function ThreadLine({ line }: { line: ThreadEvidenceLine }) {
  return (
    <>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="truncate font-medium text-foreground">{shortName(line.from)}</span>
        <span className="text-[12px] text-muted-foreground tabular-nums">{when(line.at)}</span>
      </p>
      {line.line && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{line.line}</p>}
    </>
  );
}
