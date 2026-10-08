/**
 * Outlook Calendar connector — ingest events as retrievable documents, the
 * Microsoft 365 twin of the Google Calendar connector.
 *
 * Auth: the workspace's Microsoft login (`Calendars.ReadWrite`; the sync only
 * reads, the write is `outlook.create_event`). A full sync walks a rolling
 * window (`pastDays` back → `futureDays` ahead) through `calendarView`, which
 * expands recurring meetings into their occurrences the way Google's
 * `singleEvents` does. Incremental: the same window, keeping only events
 * modified at or after `ctx.since`; a daily full sync is the reconcile pass
 * that lets a cancelled or deleted event leave the index.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { GRAPH_BASE, graphJson, graphPages, htmlToText, persistTo, resolveGraphToken } from '@/libs/microsoft/graph';
import { inspectMicrosoft } from '@/libs/microsoft/inspect';

export const OUTLOOK_CALENDAR_SLUG = 'outlook-calendar';

const outlookCalendarConfigSchema = z.object({
  /** A calendar id, or blank for the signed-in person's default calendar. */
  calendarId: z.string().optional(),
  /** Full-sync window: how far back to index events. */
  pastDays: z.number().int().positive().default(30),
  /** Full-sync window: how far ahead to index events. */
  futureDays: z.number().int().positive().default(60),
  baseUrl: z.string().url().default(GRAPH_BASE),
});

export type OutlookEvent = {
  id: string;
  subject?: string | null;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: Array<{ emailAddress?: { name?: string; address?: string }; status?: { response?: string } }>;
  lastModifiedDateTime?: string;
  webLink?: string;
  seriesMasterId?: string | null;
  type?: string;
};

const EVENT_FIELDS = 'id,subject,bodyPreview,start,end,isAllDay,isCancelled,location,onlineMeeting,organizer,attendees,lastModifiedDateTime,webLink,seriesMasterId,type';

/**
 * An event time as an ISO instant. Graph answers `calendarView` in UTC when
 * asked (`Prefer: outlook.timezone="UTC"`), without the trailing `Z`.
 * @param t - Graph's dateTimeTimeZone.
 * @param t.dateTime - The local date-time.
 * @param t.timeZone - The zone it is in.
 */
export function eventInstant(t: { dateTime?: string; timeZone?: string } | undefined): string {
  const raw = t?.dateTime ?? '';
  if (!raw) {
    return '';
  }
  return (t?.timeZone ?? 'UTC').toUpperCase() === 'UTC' && !/[Z+]|-\d\d:\d\d$/.test(raw.slice(10)) ? `${raw.replace(/\.\d+$/, '')}Z` : raw;
}

/**
 * The window of events to read, as `calendarView` query parameters.
 * @param base - The calendar's path (`/me/calendar` or `/me/calendars/<id>`).
 * @param start - Window start.
 * @param end - Window end.
 */
export function calendarViewPath(base: string, start: Date, end: Date): string {
  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select: EVENT_FIELDS,
    $orderby: 'start/dateTime',
    $top: '100',
  });
  return `${base}/calendarView?${params.toString()}`;
}

/**
 * The calendar's path: the default calendar, or a named one.
 * @param calendarId - A calendar id, or blank.
 */
export function calendarBase(calendarId: string | undefined): string {
  return calendarId ? `/me/calendars/${encodeURIComponent(calendarId)}` : '/me/calendar';
}

function renderEvent(ev: OutlookEvent): string {
  const attendees = (ev.attendees ?? [])
    .map(a => `${a.emailAddress?.name ?? a.emailAddress?.address ?? 'unknown'}${a.status?.response && a.status.response !== 'none' ? ` (${a.status.response})` : ''}`)
    .join(', ');
  const description = ev.body?.content ? htmlToText(ev.body.content) : (ev.bodyPreview ?? '');
  return [
    `Event: ${ev.subject ?? '(no title)'}`,
    `When: ${eventInstant(ev.start)} → ${eventInstant(ev.end)}${ev.isAllDay ? ' (all day)' : ''}`,
    ev.location?.displayName ? `Where: ${ev.location.displayName}` : '',
    ev.onlineMeeting?.joinUrl ? `Join: ${ev.onlineMeeting.joinUrl}` : '',
    ev.organizer ? `Organizer: ${ev.organizer.emailAddress?.name ?? ev.organizer.emailAddress?.address ?? ''}` : '',
    attendees ? `Attendees: ${attendees}` : '',
    description ? `\n${description}` : '',
  ].filter(Boolean).join('\n');
}

export const outlookCalendarConnector: SourceConnector<typeof outlookCalendarConfigSchema> = {
  slug: OUTLOOK_CALENDAR_SLUG,
  name: 'Outlook Calendar',
  description: 'Meetings from an Outlook (Microsoft 365) calendar. Title, time, attendees and description over a rolling window of recent and upcoming events.',
  icon: 'Calendar',
  authKind: 'oauth',
  brand: 'microsoftoutlook',
  configSchema: outlookCalendarConfigSchema,
  defaultReconcileCron: '20 4 * * *',
  requiredScopes: ['Calendars.ReadWrite'],
  inspectNote: 'Reads who the Microsoft login is and opens the calendar this source syncs. Nothing is saved, except an expired login it renews for a connected source.',
  inspect: input => inspectMicrosoft(OUTLOOK_CALENDAR_SLUG, {
    label: 'Open the calendar',
    run: async (token, config, baseUrl) => {
      const id = typeof config.calendarId === 'string' && config.calendarId ? config.calendarId : undefined;
      const found = await graphJson<{ name?: string; canEdit?: boolean }>(token, { path: `${calendarBase(id)}?$select=name,canEdit`, what: 'the calendar', baseUrl });
      return `${found.name ?? 'Calendar'}${found.canEdit ? ' (can add events)' : ' (read only)'}`;
    },
  }, input),
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = outlookCalendarConfigSchema.parse(ctx.config);
    const token = await resolveGraphToken(ctx.credentials, persistTo(ctx.orgId, ctx.sourceId, message => ctx.onProgress?.({ kind: 'error', message })), OUTLOOK_CALENDAR_SLUG);
    const now = Date.now();
    const path = calendarViewPath(calendarBase(cfg.calendarId), new Date(now - cfg.pastDays * 86_400_000), new Date(now + cfg.futureDays * 86_400_000));
    const since = ctx.since?.getTime() ?? null;
    for await (const ev of graphPages<OutlookEvent>(token, { path, what: 'Outlook calendar events', baseUrl: cfg.baseUrl, headers: { Prefer: 'outlook.timezone="UTC"' } })) {
      const modified = ev.lastModifiedDateTime ? Date.parse(ev.lastModifiedDateTime) : Number.NaN;
      if (ev.isCancelled || (since !== null && Number.isFinite(modified) && modified < since)) {
        ctx.onProgress?.({ kind: 'skipped', uri: ev.id });
        continue;
      }
      ctx.onProgress?.({ kind: 'fetched', uri: ev.id });
      const start = eventInstant(ev.start);
      yield {
        externalId: `outlook-event:${cfg.calendarId ?? 'default'}:${ev.id}`,
        title: `${ev.subject ?? '(no title)'}${start ? ` — ${start}` : ''}`,
        content: renderEvent(ev),
        lastModifiedAt: Number.isFinite(modified) ? new Date(modified) : null,
        metadata: {
          kind: 'calendar-event',
          calendarId: cfg.calendarId ?? 'default',
          start,
          end: eventInstant(ev.end),
          organizer: ev.organizer?.emailAddress?.address ?? null,
          attendees: (ev.attendees ?? []).map(a => a.emailAddress?.address).filter(Boolean),
          joinUrl: ev.onlineMeeting?.joinUrl ?? null,
          webLink: ev.webLink ?? null,
          recurring: Boolean(ev.seriesMasterId),
        },
      };
    }
  },
};
