'use client';

/**
 * User message bubble (Phase C).
 *
 * Right-aligned, soft border, preserved whitespace, role + time label.
 * Rev-ai pattern: text-only, no background fill on the bubble — just
 * the soft border + tight padding.
 */

export type UserMessageProps = {
  content: string;
  /** Unix ms when the message was sent. */
  timestamp?: number;
};

function formatTime(ts: number | undefined): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function UserMessage({ content, timestamp }: UserMessageProps) {
  return (
    <div className="flex flex-row-reverse gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium uppercase">
        <span aria-hidden="true">you</span>
      </div>
      <div className="max-w-2xl flex-1 text-right">
        <div className="text-[11px] tracking-wider text-muted-foreground uppercase">
          You
          {timestamp ? <span className="ml-2 tracking-normal normal-case">{formatTime(timestamp)}</span> : null}
        </div>
        <div className="mt-2 inline-block rounded-2xl border border-border bg-background px-4 py-2 text-left text-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
