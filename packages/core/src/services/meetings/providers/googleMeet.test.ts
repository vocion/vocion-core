/**
 * The Google Meet meetings provider: lists recorded Meet meetings and reads
 * one whole, each workspace on its own Google login. Names and ids invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const DOC = 'application/vnd.google-apps.document';

const credentialsByOrg: Record<string, Record<string, unknown>> = {
  org_northwind: { token: 'ya29.northwind' },
  org_kestrel: { token: 'ya29.kestrel' },
};

vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string }) => credentialsByOrg[input.orgId],
}));

const { googleMeetMeetingProvider } = await import('./googleMeet');

function source(slug = 'google-meet') {
  return { id: 7, slug, kind: 'google-meet', config: {}, apiTokenId: null };
}

function event(id: string, start: string, attachments: unknown[]) {
  return {
    id,
    summary: `Kestrel Capital sync ${id}`,
    htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
    start: { dateTime: start },
    end: { dateTime: start.replace('T10', 'T11') },
    attendees: [{ email: 'lee@kestrel.example', displayName: 'Lee Park' }],
    conferenceData: { conferenceSolution: { key: { type: 'hangoutsMeet' } } },
    attachments,
  };
}

const older = event('evt0older', '2026-09-20T10:00:00Z', [{ fileId: 'file_a', title: 'Sync - Transcript', mimeType: DOC }]);
const newer = event('evt0newer', '2026-09-27T10:00:00Z', [{ fileId: 'file_b', title: 'Sync - Recording', mimeType: 'video/mp4', fileUrl: 'https://drive.google.com/file/d/file_b/view' }]);
const bare = event('evt0bare', '2026-09-25T10:00:00Z', []);

function respond(body: unknown, status = 200, text = false): Response {
  return new Response(text ? String(body) : JSON.stringify(body), { status });
}

function vendor() {
  return vi.fn(async (url: string) => {
    if (url.includes('/events/evt0older')) {
      return respond(older);
    }
    if (url.includes('/events/evt0missing')) {
      return respond({ error: { message: 'Not Found' } }, 404);
    }
    if (url.includes('/events?')) {
      return respond({ items: [older, bare, newer] });
    }
    if (url.includes('file_a/export')) {
      return respond('Lee Park: The Contoso numbers look right.', 200, true);
    }
    return respond({}, 500);
  });
}

function bearerOf(call: unknown): string | null {
  return new Headers((call as [string, RequestInit])[1].headers).get('authorization');
}

afterEach(() => vi.unstubAllGlobals());

describe('googleMeetMeetingProvider', () => {
  it('lists recorded meetings newest first, leaving out events Meet left nothing on', async () => {
    vi.stubGlobal('fetch', vendor());
    const provider = await googleMeetMeetingProvider('org_kestrel', source());
    const found = await provider.findMeetings({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z'), limit: 10 });

    expect(found.map(m => m.id)).toEqual(['evt0newer', 'evt0older']);
    expect(found[0]).toMatchObject({ hasTranscript: false, participants: ['Lee Park'], durationMinutes: 60 });
    expect(found[1]).toMatchObject({ hasTranscript: true });
    expect(provider.externalId('evt0older')).toBe('gmeet:evt0older');
  });

  it('reads one meeting whole, and answers null for an event the calendar does not have', async () => {
    vi.stubGlobal('fetch', vendor());
    const provider = await googleMeetMeetingProvider('org_kestrel', source());

    const read = await provider.readTranscript('evt0older');

    expect(read).toMatchObject({ id: 'evt0older', transcript: 'Lee Park: The Contoso numbers look right.', hasTranscript: true });
    expect(await provider.readTranscript('evt0missing')).toBeNull();
  });

  it('spends each workspace\'s own Google login, never another\'s', async () => {
    const fetchMock = vendor();
    vi.stubGlobal('fetch', fetchMock);
    const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z'), limit: 5 };

    await (await googleMeetMeetingProvider('org_northwind', source())).findMeetings(window);
    const northwindCalls = fetchMock.mock.calls.length;
    await (await googleMeetMeetingProvider('org_kestrel', source())).findMeetings(window);

    expect(fetchMock.mock.calls.slice(0, northwindCalls).map(bearerOf)).toEqual(Array.from({ length: northwindCalls }, () => 'Bearer ya29.northwind'));
    expect(fetchMock.mock.calls.slice(northwindCalls).map(bearerOf).every(b => b === 'Bearer ya29.kestrel')).toBe(true);
  });

  it('says so when the source has no Google login stored', async () => {
    await expect(googleMeetMeetingProvider('org_nobody', source())).rejects.toThrow(/no Google login stored/);
  });
});
