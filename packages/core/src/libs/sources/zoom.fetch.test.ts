/**
 * fetchZoomMeetingTranscript — the targeted-fetch HTTP contract:
 * UUID path encoding (double-encode when it begins with '/' or contains
 * '//', per Zoom API rules), 404 → null, and VTT flattening into
 * "SPEAKER: text" lines byte-identical to what the sync loop ingests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchZoomMeetingTranscript } from './zoom';

const CREDS = { accountId: 'acct', clientId: 'cid', clientSecret: 'sec' };

const VTT = `WEBVTT

1
00:00:00.000 --> 00:00:02.000
CHRIS: hello everyone

2
00:00:02.000 --> 00:00:04.000
ANDREW: hi Chris`;

function stubFetch(handlers: (url: string) => Response | undefined): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = handlers(url);
    if (!res) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return res;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function tokenResponse(): Response {
  return Response.json({ access_token: `tok-${Math.random()}`, expires_in: 3600 });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchZoomMeetingTranscript', () => {
  it('fetches, flattens the VTT, and builds the sync-identical doc', async () => {
    const fetchFn = stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        return tokenResponse();
      }
      if (url.includes('/meetings/plain-uuid/recordings')) {
        return Response.json({
          uuid: 'plain-uuid',
          id: 42,
          topic: 'Weekly sync',
          start_time: '2026-08-20T10:00:00Z',
          duration: 30,
          host_email: 'chris@metacto.com',
          share_url: 'https://zoom.us/rec/x',
          recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.us/dl/t' }],
        });
      }
      if (url.startsWith('https://zoom.us/dl/t')) {
        return new Response(VTT);
      }
      return undefined;
    });

    const result = await fetchZoomMeetingTranscript({ credentials: CREDS, meetingId: 'plain-uuid' });

    expect(result?.hasTranscript).toBe(true);
    expect(result?.doc.externalId).toBe('zoom:plain-uuid');
    expect(result?.doc.content).toContain('CHRIS: hello everyone');
    expect(result?.doc.content).toContain('ANDREW: hi Chris');
    expect(result?.doc.content).not.toContain('-->');
    expect(result?.doc.metadata?.hasTranscript).toBe(true);

    // Transcript download carries the access token as a query param.
    const dl = fetchFn.mock.calls.map(c => String(c[0])).find(u => u.startsWith('https://zoom.us/dl/t'));

    expect(dl).toMatch(/access_token=/);
  });

  it('double-encodes UUIDs that begin with "/" or contain "//"', async () => {
    const uuid = '/aX9//zzP==';
    const doubled = encodeURIComponent(encodeURIComponent(uuid));
    const fetchFn = stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        return tokenResponse();
      }
      if (url.includes(`/meetings/${doubled}/recordings`)) {
        return Response.json({ uuid, id: 1, recording_files: [] });
      }
      return undefined;
    });

    const result = await fetchZoomMeetingTranscript({ credentials: CREDS, meetingId: uuid });

    expect(result?.hasTranscript).toBe(false);
    expect(fetchFn.mock.calls.some(c => String(c[0]).includes(doubled))).toBe(true);
  });

  it('returns null on 404 and throws on other failures', async () => {
    stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        return tokenResponse();
      }
      if (url.includes('/meetings/gone/recordings')) {
        return new Response('not found', { status: 404 });
      }
      if (url.includes('/meetings/boom/recordings')) {
        return new Response('rate limited', { status: 429 });
      }
      return undefined;
    });

    expect(await fetchZoomMeetingTranscript({ credentials: CREDS, meetingId: 'gone' })).toBeNull();
    await expect(fetchZoomMeetingTranscript({ credentials: CREDS, meetingId: 'boom' }))
      .rejects
      .toThrow(/429/);
  });
});
