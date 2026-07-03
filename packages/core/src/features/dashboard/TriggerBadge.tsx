import cronstrue from 'cronstrue';
import { CalendarClock, Hand, Zap } from 'lucide-react';

/**
 * Human-readable cron: "0 12 * * 1-5" → "12:00 PM, Monday through Friday (UTC)".
 * Falls back to the raw expression when cronstrue can't parse it.
 * @param cron
 */
export function cronToText(cron: string): string {
  try {
    return `${cronstrue.toString(cron, { verbose: false }).replace(/^At /, '')} (UTC)`;
  } catch {
    return cron;
  }
}

/**
 * Compact chip describing what starts a workflow or mission check:
 * manual (a human), event (the event bus), or a schedule (a cron, shown
 * as human-readable text with the raw expression on hover).
 * @param props
 * @param props.trigger
 * @param props.schedule
 */
export function TriggerBadge(props: {
  trigger: Record<string, unknown> | null | undefined;
  /** Mission-schedule rendering: pass the cron directly. */
  schedule?: string | null;
}) {
  const t = props.trigger as { type?: string; event?: string; cron?: string } | null | undefined;
  const cron = props.schedule ?? (t?.type === 'schedule' ? t.cron : undefined);
  if (cron) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
        title={cron}
      >
        <CalendarClock className="size-3" />
        {cronToText(cron)}
      </span>
    );
  }
  if (t?.type === 'event') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        <Zap className="size-3" />
        on
        {' '}
        <code className="font-mono">{t.event}</code>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      <Hand className="size-3" />
      manual
    </span>
  );
}
