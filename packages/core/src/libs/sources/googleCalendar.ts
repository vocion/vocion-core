/**
 * Google Calendar connector — ingest events as retrievable documents so
 * briefings can answer "what's on the calendar today / this week / what
 * did we meet about."
 *
 * Auth: same durable Google OAuth as gmail/drive (see googleAuth) with the
 * `calendar.readonly` scope. Incremental: when `ctx.since` is set, only
 * events UPDATED at/after it are fetched (`updatedMin`); a full sync walks a
 * rolling window (`pastDays` back → `futureDays` ahead) so the index holds
 * recent history plus the upcoming schedule without unbounded growth.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { resolveGoogleAccessToken } from './googleAuth';

const calendarConfigSchema = z.object({
  /** Calendar to sync — `primary` or a calendar id (email-shaped). */
  calendarId: z.string().default('primary'),
  /** Full-sync window: how far back to index events. */
  pastDays: z.number().int().positive().default(30),
  /** Full-sync window: how far ahead to index events. */
  futureDays: z.number().int().positive().default(60),
  baseUrl: z.string().url().default('https://www.googleapis.com/calendar/v3'),
});

type CalEventsList = {
  items?: CalEvent[];
  nextPageToken?: string;
};

type CalEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>;
  recurringEventId?: string;
};

function eventTime(t?: { dateTime?: string; date?: string }): string {
  return t?.dateTime ?? t?.date ?? '';
}

function renderEvent(ev: CalEvent): string {
  const attendees = (ev.attendees ?? [])
    .map(a => `${a.displayName ?? a.email ?? 'unknown'}${a.responseStatus ? ` (${a.responseStatus})` : ''}`)
    .join(', ');
  return [
    `Event: ${ev.summary ?? '(no title)'}`,
    `When: ${eventTime(ev.start)} → ${eventTime(ev.end)}`,
    ev.location ? `Where: ${ev.location}` : '',
    ev.hangoutLink ? `Meet: ${ev.hangoutLink}` : '',
    ev.organizer ? `Organizer: ${ev.organizer.displayName ?? ev.organizer.email ?? ''}` : '',
    attendees ? `Attendees: ${attendees}` : '',
    ev.description ? `\n${ev.description}` : '',
  ].filter(Boolean).join('\n');
}

export const googleCalendarConnector: SourceConnector<typeof calendarConfigSchema> = {
  slug: 'google-calendar',
  name: 'Google Calendar',
  description: 'Ingest calendar events (title, time, attendees, description) — a rolling window of recent + upcoming.',
  icon: 'Calendar',
  authKind: 'oauth',
  configSchema: calendarConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = calendarConfigSchema.parse(ctx.config);
    const token = await resolveGoogleAccessToken(ctx.credentials);
    const headers = { authorization: `Bearer ${token}` };

    const now = Date.now();
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '250',
      timeMin: new Date(now - cfg.pastDays * 86_400_000).toISOString(),
      timeMax: new Date(now + cfg.futureDays * 86_400_000).toISOString(),
    });
    if (ctx.since) {
      // Incremental: only events whose content changed since the watermark.
      // The time window still applies so long-dead events never reappear.
      params.set('updatedMin', ctx.since.toISOString());
    }

    let pageToken: string | undefined;
    do {
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const url = `${cfg.baseUrl}/calendars/${encodeURIComponent(cfg.calendarId)}/events?${params.toString()}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Calendar events list failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const list = (await res.json()) as CalEventsList;
      for (const ev of list.items ?? []) {
        if (ev.status === 'cancelled') {
          ctx.onProgress?.({ kind: 'skipped', uri: ev.id });
          continue;
        }
        ctx.onProgress?.({ kind: 'fetched', uri: ev.id });
        const start = eventTime(ev.start);
        yield {
          externalId: `gcal:${cfg.calendarId}:${ev.id}`,
          title: `${ev.summary ?? '(no title)'}${start ? ` — ${start}` : ''}`,
          content: renderEvent(ev),
          lastModifiedAt: ev.updated ? new Date(ev.updated) : null,
          metadata: {
            kind: 'calendar-event',
            calendarId: cfg.calendarId,
            start,
            end: eventTime(ev.end),
            organizer: ev.organizer?.email ?? null,
            attendees: (ev.attendees ?? []).map(a => a.email).filter(Boolean),
            recurring: !!ev.recurringEventId,
          },
        };
      }
      pageToken = list.nextPageToken;
    } while (pageToken);
  },
};
