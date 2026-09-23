/**
 * How a lead's facts read — dates, the entrance enum, the lane pill.
 *
 * Split out of `LeadContext` when the lead page became a workspace with tabs
 * (`docs/specs/personalization-v2.md`): the queue rows and every tab need the
 * same formatting, and a component that renders one tab is the wrong home for
 * it.
 */

/**
 * The entrance path is a CRM enum (`PAID_SOCIAL`, `ORGANIC_SEARCH`). Shown
 * raw it reads as a database value rather than how someone found us.
 * @param value - The CRM enum.
 */
export function entranceLabel(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Fixed locale + UTC so the server render and the client render agree. */
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const FULL_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * "Sep 1".
 * @param iso - An ISO timestamp.
 */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : SHORT_DATE.format(d);
}

const SHORT_DATE_TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

/**
 * "Sep 1, 10:00 AM UTC". For the moments a reviewer sorts and filters by,
 * where the day alone does not separate two passes on the same day.
 * @param iso - An ISO timestamp.
 */
export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : SHORT_DATE_TIME.format(d);
}

/**
 * "Sep 1, 2026".
 * @param iso - An ISO timestamp.
 */
export function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : FULL_DATE.format(d);
}

/** Queue lane → pill, shared by the queue rows and the lead page header. */
export const LANE_PILL: Record<string, { status: 'pending' | 'approved' | 'paused' | 'completed'; label: string }> = {
  queued: { status: 'paused', label: 'Queued' },
  ready_for_review: { status: 'pending', label: 'Review' },
  handed_off: { status: 'approved', label: 'Handed off' },
  held: { status: 'paused', label: 'Held' },
  sent: { status: 'completed', label: 'Sent' },
};

/** The handoff trigger, as the page says it. */
export const HANDOFF_TRIGGER_LABEL: Record<string, string> = {
  reply: 'Replied',
  meeting: 'Meeting booked',
  intent: 'Intent',
  routed: 'Routed by a reviewer',
};
