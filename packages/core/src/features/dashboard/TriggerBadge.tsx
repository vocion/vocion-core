import { CalendarClock, Hand, Zap } from 'lucide-react';

/**
 * Compact chip describing what starts a workflow or mission check:
 * manual (a human), event (the event bus), or schedule/heartbeat (a cron).
 * @param props
 * @param props.trigger
 * @param props.heartbeat
 */
export function TriggerBadge(props: {
  trigger: Record<string, unknown> | null | undefined;
  /** Mission-heartbeat rendering: pass the cron directly. */
  heartbeat?: string | null;
}) {
  const t = props.trigger as { type?: string; event?: string; cron?: string } | null | undefined;
  if (props.heartbeat) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        <CalendarClock className="size-3" />
        heartbeat
        {' '}
        <code className="font-mono">{props.heartbeat}</code>
      </span>
    );
  }
  if (t?.type === 'schedule' && t.cron) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        <CalendarClock className="size-3" />
        schedule
        {' '}
        <code className="font-mono">{t.cron}</code>
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
