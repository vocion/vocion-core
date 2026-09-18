/**
 * calendar_events — what is actually on the calendar, read live.
 *
 * This exists because the agent had no way to answer "what's on my calendar
 * today" except second-hand. Calendar events reached it only as retrieved
 * knowledge documents, or worse, quoted inside a briefing written hours
 * earlier by a different run. On 2026-09-17 that produced a whole day's
 * schedule, read out confidently at 12:51pm, naming a 10:30am call that was
 * not on the calendar at all — and three separate fixes to dates, staleness
 * and citations could not repair it, because none of them made anything
 * LOOK at the calendar.
 *
 * Two things here do the work, and both are the same idea applied twice: ask
 * the source directly, and let code do the arithmetic the model gets wrong.
 *
 * 1. An explicit window is sent to the API (`timeMin`/`timeMax`), so the
 *    answer is bounded by a date rather than by whatever a semantic search
 *    happened to rank. Retrieval cannot do this — an embedding has no notion
 *    of "today", which is why yesterday's stand-up outranked today's.
 * 2. The result is PARTITIONED against now, in code, into what is still
 *    ahead and what already happened, each event carrying how far away it is.
 *    A model handed a flat list of timestamps will read the first one out as
 *    "next"; it cannot reliably diff twelve ISO strings against a thirteenth.
 *
 * Access boundary is the source gate, the same as every other connector tool:
 * no connected Google Calendar source, no tool.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { resolveGoogleAccessToken } from '@/libs/sources/googleAuth';
import { dayKey, DEFAULT_TIME_ZONE, formatDate, formatDateTime, startOfDay } from '@/libs/time/zone';
import { firstCredentialed, sourcesForConnector } from './zoomTranscript';

const API = 'https://www.googleapis.com/calendar/v3';

type CalEvent = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email?: string };
};

/**
 * An event's start as an instant, or null for an all-day event with no time.
 * @param ev
 */
function startsAt(ev: CalEvent): Date | null {
  const raw = ev.start?.dateTime ?? ev.start?.date;
  if (!raw) {
    return null;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * How far from now, in words — `in 1h 10m`, `2h ago`, `now`.
 *
 * Computed here rather than left to the model for the same reason the date
 * stamp on a search hit is: "coming up in ~1hr" is a fact a reader can act on,
 * and a bare timestamp is one they have to do arithmetic on.
 * @param at - The instant.
 * @param now - Reference instant.
 */
export function relativeTime(at: Date, now: Date): string {
  const mins = Math.round((at.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(mins);
  if (abs < 5) {
    return 'now';
  }
  const body = abs < 60 ? `${abs}m` : `${Math.floor(abs / 60)}h${abs % 60 > 0 ? ` ${abs % 60}m` : ''}`;
  return mins > 0 ? `in ${body}` : `${body} ago`;
}

/**
 * One event as a line the model can quote without re-deriving anything.
 * @param ev
 * @param now
 * @param tz
 */
function renderEvent(ev: CalEvent, now: Date, tz: string): string {
  const at = startsAt(ev);
  const allDay = !ev.start?.dateTime && Boolean(ev.start?.date);
  // The person's zone, named — the model used to get a bare UTC instant and
  // relabel it in whatever zone it assumed (2026-09-18: "2:30pm ET" for an
  // 11:30am Pacific session).
  const when = allDay
    ? `${ev.start?.date} (all day)`
    : at
      ? `${formatDateTime(at, tz)} · ${relativeTime(at, now)}`
      : '(no start time)';
  const who = (ev.attendees ?? [])
    .map(a => a.displayName ?? a.email)
    .filter((x): x is string => Boolean(x))
    .slice(0, 8);
  const parts = [
    `- ${ev.summary ?? '(no title)'} — ${when}`,
    who.length > 0 ? `  with: ${who.join(', ')}` : '',
    ev.location ? `  where: ${ev.location}` : '',
    ev.hangoutLink ? `  link: ${ev.hangoutLink}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Format a whole day's calendar, split against now.
 * @param events - Events from the API, any order.
 * @param now - Reference instant.
 * @param windowLabel - Human description of the window that was queried.
 * @param tz
 */
export function renderCalendar(events: CalEvent[], now: Date, windowLabel: string, tz: string = DEFAULT_TIME_ZONE): string {
  const live = events.filter(e => e.status !== 'cancelled');
  if (live.length === 0) {
    // A real answer. The failure this tool exists to prevent is an invented
    // schedule, and "nothing is on it" must be sayable.
    return `NOW: ${formatDateTime(now, tz)} (${tz}) · ${now.toISOString()} UTC.\nNothing on the calendar for ${windowLabel}. Say exactly that — do not fill the gap from a briefing, a transcript, or memory.`;
  }

  const sorted = [...live].sort((a, b) => (startsAt(a)?.getTime() ?? 0) - (startsAt(b)?.getTime() ?? 0));
  const ahead = sorted.filter((e) => {
    const at = startsAt(e);
    return at === null || at.getTime() >= now.getTime();
  });
  const past = sorted.filter((e) => {
    const at = startsAt(e);
    return at !== null && at.getTime() < now.getTime();
  });

  const out = [`NOW: ${formatDateTime(now, tz)} (${tz}) · ${now.toISOString()} UTC. Calendar for ${windowLabel}, read live just now.`];
  out.push('', ahead.length > 0 ? `STILL AHEAD (${ahead.length}):` : 'STILL AHEAD: nothing left today.');
  for (const e of ahead) {
    out.push(renderEvent(e, now, tz));
  }
  if (past.length > 0) {
    out.push('', `ALREADY HAPPENED (${past.length}) — past tense only, never present these as upcoming:`);
    for (const e of past) {
      out.push(renderEvent(e, now, tz));
    }
  }
  out.push(
    '',
    'This list is the calendar. If a meeting is not here, it is not on the calendar — say so rather than repeating one you read in a briefing or a transcript.',
  );
  return out.join('\n');
}

/**
 * Midnight-to-midnight around a day in the person's zone, as UTC instants for the API.
 * @param day
 * @param now
 * @param tz
 */
function dayWindow(day: string | undefined, now: Date, tz: string): { timeMin: string; timeMax: string; label: string } {
  const key = day ?? dayKey(now, tz);
  const start = startOfDay(key, tz);
  // The next local midnight, so a DST day is still one whole day.
  const [y, m, d] = key.split('-').map(n => Number.parseInt(n, 10)) as [number, number, number];
  const nextKey = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const end = startOfDay(nextKey, tz);
  const label = day ? `${formatDate(start, tz)} (${tz})` : `today, ${formatDate(start, tz)} (${tz})`;
  return { timeMin: start.toISOString(), timeMax: end.toISOString(), label };
}

export function hasCalendarSource(ctx: RuntimeContext): boolean {
  return ctx.connectorSources.some(s => /^google-calendar(?:$|-)/.test(s));
}

export function calendarTools(ctx: RuntimeContext) {
  if (!hasCalendarSource(ctx)) {
    return [];
  }

  const calendarEvents = tool(
    async (args) => {
      const { day, days_ahead } = args as { day?: string; days_ahead?: number };
      const sources = await sourcesForConnector(ctx.orgId, 'google-calendar');
      if (sources.length === 0) {
        return 'No Google Calendar source is connected for this workspace. Say that the calendar could not be read — do not substitute a schedule from a briefing or from memory.';
      }
      const credentialed = await firstCredentialed(ctx.orgId, sources);
      if (!credentialed) {
        return 'The Google Calendar source has no live credentials. Say the calendar could not be read; never infer a schedule from other documents.';
      }

      const now = new Date();
      const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
      const { timeMin, timeMax, label } = dayWindow(day, now, tz);
      const span = Math.min(Math.max(days_ahead ?? 0, 0), 14);
      const end = new Date(new Date(timeMax).getTime() + span * 86_400_000).toISOString();
      const windowLabel = span > 0 ? `${label} and the next ${span} day(s)` : label;

      try {
        const token = await resolveGoogleAccessToken(credentialed.credentials);
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
          timeMin,
          timeMax: end,
        });
        const res = await fetch(`${API}/calendars/primary/events?${params.toString()}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          return `Calendar read failed (${res.status}). Say the calendar could not be read; do not substitute a schedule from another document.`;
        }
        const list = (await res.json()) as { items?: CalEvent[] };
        return renderCalendar(list.items ?? [], now, windowLabel, tz);
      } catch (err) {
        return `Calendar read failed: ${(err as Error).message ?? 'unknown'}. Say the calendar could not be read; do not substitute a schedule from another document.`;
      }
    },
    {
      name: 'calendar_events',
      description: [
        'Read the calendar LIVE for a given day. This is the only source of truth for what is on the calendar.',
        'Call it before answering anything about the day, the schedule, meetings, or "what should I do now" — never take a schedule from a briefing, a transcript, or search results, all of which may be repeating a day that has passed.',
        'Returns the current time, then what is STILL AHEAD and what ALREADY HAPPENED, each event with how far away it is ("in 1h 10m", "2h ago").',
        'If a meeting is not in this list it is not on the calendar: say so rather than repeating one you read elsewhere.',
      ].join(' '),
      schema: z.object({
        day: z.string().optional().describe('The day to read, as YYYY-MM-DD. Omit for today.'),
        days_ahead: z.number().int().optional().describe('Also include this many days after `day` (0-14). Omit for just the one day.'),
      }),
    },
  );

  return [calendarEvents];
}
