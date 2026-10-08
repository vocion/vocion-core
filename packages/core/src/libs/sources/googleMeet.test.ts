/**
 * Google Meet connector against a mocked `fetch`: a meeting is a calendar
 * event with Meet conference data, and its transcript and Gemini notes are
 * the Docs Meet attached to it. Every name and id here is invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleMeetConnector } from './googleMeet';

const DOC = 'application/vnd.google-apps.document';

const meetEvent = {
  id: 'evt0northwind01',
  summary: 'Northwind renewal review',
  htmlLink: 'https://calendar.google.com/calendar/event?eid=evt0northwind01',
  updated: '2026-09-30T18:00:00.000Z',
  start: { dateTime: '2026-09-30T16:00:00Z' },
  end: { dateTime: '2026-09-30T16:45:00Z' },
  attendees: [{ email: 'dana@northwind.example', displayName: 'Dana Reyes' }, { email: 'sam@contoso.example' }],
  conferenceData: { conferenceId: 'abc-defg-hij', conferenceSolution: { key: { type: 'hangoutsMeet' } } },
  attachments: [
    { fileId: 'file_transcript_01', title: 'Northwind renewal review - Transcript', mimeType: DOC },
    { fileId: 'file_notes_01', title: 'Northwind renewal review - Notes by Gemini', mimeType: DOC },
    { fileId: 'file_video_01', title: 'Northwind renewal review - Recording', mimeType: 'video/mp4', fileUrl: 'https://drive.google.com/file/d/file_video_01/view' },
  ],
};
const plainEvent = { id: 'evt0plain', summary: 'Lunch', start: { dateTime: '2026-09-29T12:00:00Z' } };
const meetWithoutFiles = { ...meetEvent, id: 'evt0nofiles', attachments: [] };

function respond(body: unknown, init: { status?: number; text?: boolean } = {}): Response {
  const raw = init.text ? String(body) : JSON.stringify(body);
  return new Response(raw, { status: init.status ?? 200 });
}

function router(overrides: Partial<Record<'transcript' | 'notes', Response>> = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/calendars/')) {
      return respond({ items: [meetEvent, plainEvent, meetWithoutFiles] });
    }
    if (url.includes('file_transcript_01/export')) {
      return overrides.transcript ?? respond('Dana Reyes: Can we hold the price for Acme?\nSam: Yes, through March.', { text: true });
    }
    if (url.includes('file_notes_01/export')) {
      return overrides.notes ?? respond('Summary: price held through March.', { text: true });
    }
    return respond({ error: { message: 'unexpected' } }, { status: 500 });
  });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return { sourceId: 1, orgId: 'org_1', config: {}, credentials: { token: 'ya29.fixture' }, ...over };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('googleMeetConnector', () => {
  it('yields one document per recorded Meet meeting, with its transcript and Gemini notes', async () => {
    const fetchMock = router();
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(googleMeetConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('gmeet:evt0northwind01');
    expect(docs[0]!.content).toContain('Transcript:\nDana Reyes: Can we hold the price for Acme?');
    expect(docs[0]!.content).toContain('Summary:\nSummary: price held through March.');
    expect(docs[0]!.content).toContain('Recording: https://drive.google.com/file/d/file_video_01/view');
    expect(docs[0]!.metadata).toMatchObject({ kind: 'meet-meeting', conferenceId: 'abc-defg-hij', hasTranscript: true, attendees: ['dana@northwind.example', 'sam@contoso.example'] });

    // The recording is a link: no request ever touched the video.
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('file_video_01'))).toBe(false);
    // Bearer token on every call.
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('authorization')).toBe('Bearer ya29.fixture');
  });

  it('asks Calendar only for events changed since the watermark when incremental', async () => {
    const fetchMock = router();
    vi.stubGlobal('fetch', fetchMock);
    const since = new Date('2026-09-28T00:00:00.000Z');
    await collect(googleMeetConnector.sync(ctx({ since })));

    const url = new URL(String(fetchMock.mock.calls[0]![0]));

    expect(url.searchParams.get('updatedMin')).toBe(since.toISOString());
    expect(url.searchParams.get('singleEvents')).toBe('true');
  });

  it('reports a transcript it could not export and carries on with the rest', async () => {
    vi.stubGlobal('fetch', router({ transcript: respond({ error: { message: 'File not found' } }, { status: 404 }) }));
    const progress: Array<{ kind: string }> = [];
    const docs = await collect(googleMeetConnector.sync(ctx({ onProgress: e => progress.push(e) })));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.content).toContain('price held through March');
    expect(progress.filter(e => e.kind === 'error')).toHaveLength(1);
  });

  it('throws when the events cannot be listed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ error: { message: 'Insufficient Permission' } }, { status: 403 })));

    await expect(collect(googleMeetConnector.sync(ctx()))).rejects.toThrow(/could not be listed/);
  });

  it('refuses without a Google credential', async () => {
    vi.stubGlobal('fetch', router());

    await expect(collect(googleMeetConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/Google credentials missing/);
  });

  it('parses an empty config onto its defaults', () => {
    expect(googleMeetConnector.configSchema.safeParse({}).success).toBe(true);
  });

  it('tests the connection with one calendar read and one Drive read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/calendars/') ? respond({ items: [meetEvent] }) : respond({ files: [] }))));
    const inspection = await googleMeetConnector.inspect!({ config: {}, credentials: { token: 'ya29.fixture' }, options: {} }) as { authorized: boolean; checks: Array<{ ok: boolean }>; error: string | null };

    expect(inspection.authorized).toBe(true);
    expect(inspection.checks.every(c => c.ok)).toBe(true);
    expect(inspection.error).toBeNull();
  });
});
