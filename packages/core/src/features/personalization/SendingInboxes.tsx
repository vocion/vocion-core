import type { InboxStatus } from '@/services/personalization/senderLedger';

/**
 * Where each sending inbox stands today: enrollments sent against its cap,
 * the ramp week for a warm-up inbox, and the last seven days. Read-only; the
 * ramp itself is workspace config (`sources/hubspot-contacts.yaml`).
 * @param props
 * @param props.day - Today in the sender's timezone, YYYY-MM-DD.
 * @param props.timezone
 * @param props.inboxes
 */
export function SendingInboxes(props: { day: string; timezone: string; inboxes: InboxStatus[] }) {
  return (
    <section aria-label="Sending inboxes" className="mb-4 border-b border-border pb-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Sending inboxes</h2>
        <span className="text-xs text-muted-foreground">
          Today,
          {' '}
          {props.day}
          {' '}
          (
          {props.timezone}
          )
        </span>
      </div>
      <ul className="divide-y divide-border">
        {props.inboxes.map((inbox) => {
          const state = inbox.paused
            ? 'Paused'
            : inbox.week === 0
              ? 'Ramp not started'
              : inbox.week
                ? `Warm-up week ${inbox.week}`
                : 'Established';
          return (
            <li key={inbox.email} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{inbox.email}</span>
              <span className="flex items-baseline gap-4 text-muted-foreground tabular-nums">
                <span>{state}</span>
                <span>
                  {inbox.capToday === null ? `${inbox.usedToday} today` : `${inbox.usedToday} of ${inbox.capToday} today`}
                </span>
                <span>
                  {inbox.last7Days}
                  {' '}
                  in 7 days
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
