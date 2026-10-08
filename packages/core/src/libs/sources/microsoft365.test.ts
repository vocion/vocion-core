/**
 * The Microsoft 365 connectors against recorded Graph shapes: what each
 * asks Graph for, what it yields, and how the shared Graph client pages,
 * waits out throttling and words a failure. No network: `fetch` is a stub,
 * and every fixture is fictional (Contoso, Northwind).
 */
import type { SourceConnector } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));
vi.mock('@/services/chat/attachments', () => ({ extractText: vi.fn(async (data: Buffer) => `pdf text of ${data.toString('utf8')}`) }));

const { graphFailure, graphJson, graphPages, htmlToText, resolveGraphToken } = await import('@/libs/microsoft/graph');
const { outlookCalendarConnector, eventInstant } = await import('./outlookCalendar');
const { teamsConnector } = await import('./microsoftTeams');
const { onedriveConnector, sharepointConnector, sitePath, readModeOf } = await import('./microsoftFiles');

const LOGIN = { accessToken: 'at-good', refreshToken: 'rt-1', expiresAt: '2999-01-01T00:00:00.000Z' };

type Route = (url: URL, init?: RequestInit) => unknown;

/**
 * Stub `fetch` with Graph answers routed by path; records every URL asked.
 * @param route - The answer for a URL, or a Response to send as is.
 */
function stubGraph(route: Route) {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url);
    const answer = route(url, init);
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer ?? {}), { status: 200 });
  }));
  return urls;
}

async function drain(connector: SourceConnector, config: Record<string, unknown>, since?: Date): Promise<IngestDoc[]> {
  const docs: IngestDoc[] = [];
  for await (const doc of connector.sync({ orgId: 'org_contoso', sourceId: 1, credentials: LOGIN, config, ...(since ? { since } : {}) })) {
    docs.push(doc);
  }
  return docs;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Graph client', () => {
  it('follows @odata.nextLink page by page', async () => {
    stubGraph(url => (url.searchParams.get('page') === '2'
      ? { value: [{ id: 'c' }] }
      : { 'value': [{ id: 'a' }, { id: 'b' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/things?page=2' }));
    const ids: string[] = [];
    for await (const item of graphPages<{ id: string }>('tok', { path: '/me/things', what: 'things' })) {
      ids.push(item.id);
    }

    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('never follows a next link to another host, so the token stays with Graph', async () => {
    stubGraph(() => ({ 'value': [], '@odata.nextLink': 'https://elsewhere.example/steal' }));

    await expect(async () => {
      for await (const _item of graphPages('tok', { path: '/me/things', what: 'things' })) {
        // Draining is the point.
      }
    }).rejects.toThrow(/another host/);
  });

  it('waits out a 429 for as long as Retry-After says, then carries on', async () => {
    let calls = 0;
    stubGraph(() => {
      calls += 1;
      return calls === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } }) : { ok: 1 };
    });
    const sleep = vi.fn(async () => {});

    expect(await graphJson('tok', { path: '/me', what: 'me', sleep })).toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('words a refusal as the fix, with Graph\'s code but never its free text', async () => {
    stubGraph(() => new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied', message: 'token eyJ0… was denied' } }), { status: 403 }));

    const failure = graphJson('tok', { path: '/me/messages', what: 'Outlook messages' });

    await expect(failure).rejects.toThrow(/may not read Outlook messages \(403 ErrorAccessDenied\)/);
    await expect(graphJson('tok', { path: '/me/messages', what: 'Outlook messages' })).rejects.not.toThrow(/eyJ0/);
    expect(graphFailure('mail', 401, null)).toMatch(/log in with Microsoft again/);
  });

  it('mints a token from a pasted client and refresh token, and refuses a bag with nothing usable', async () => {
    const urls = stubGraph(() => ({ access_token: 'at-pasted', expires_in: 3600 }));

    expect(await resolveGraphToken({ clientId: 'app', clientSecret: 'value', refreshToken: 'rt-pasted' }, { kind: 'never' }, 'onedrive')).toBe('at-pasted');
    expect(urls[0]!.toString()).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    await expect(resolveGraphToken({}, { kind: 'never' }, 'onedrive')).rejects.toThrow(/log in with Microsoft/);
  });

  it('reads HTML as text', () => {
    expect(htmlToText('<p>Hi&nbsp;team,</p><div>Q3 plan &amp; budget<br>attached</div><style>p{}</style>')).toBe('Hi team,\nQ3 plan & budget\nattached');
  });
});

describe('Outlook Calendar', () => {
  it('reads the window through calendarView in UTC, skipping cancelled events and, incrementally, unchanged ones', async () => {
    const urls = stubGraph(() => ({
      value: [
        { id: 'ev-1', subject: 'Contoso QBR', start: { dateTime: '2026-10-09T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-09T16:00:00.0000000', timeZone: 'UTC' }, lastModifiedDateTime: '2026-10-05T00:00:00Z', attendees: [{ emailAddress: { name: 'Mara Ruiz', address: 'mara@northwind.example' }, status: { response: 'accepted' } }], onlineMeeting: { joinUrl: 'https://teams.example/join/1' } },
        { id: 'ev-2', subject: 'Cancelled sync', isCancelled: true, lastModifiedDateTime: '2026-10-05T00:00:00Z' },
        { id: 'ev-3', subject: 'Old standup', lastModifiedDateTime: '2026-09-01T00:00:00Z' },
      ],
    }));

    const docs = await drain(outlookCalendarConnector, {}, new Date('2026-10-01T00:00:00Z'));

    expect(docs.map(d => d.externalId)).toEqual(['outlook-event:default:ev-1']);
    expect(docs[0]!.content).toContain('Attendees: Mara Ruiz (accepted)');
    expect(docs[0]!.metadata).toMatchObject({ start: '2026-10-09T15:00:00Z', attendees: ['mara@northwind.example'], joinUrl: 'https://teams.example/join/1' });
    expect(urls[0]!.pathname).toBe('/v1.0/me/calendar/calendarView');
    expect(eventInstant({ dateTime: '2026-10-09T15:00:00.0000000', timeZone: 'UTC' })).toBe('2026-10-09T15:00:00Z');
  });
});

describe('Microsoft Teams', () => {
  it('sweeps every channel of every joined team, one document per thread with its replies', async () => {
    const urls = stubGraph((url) => {
      if (url.pathname === '/v1.0/me/joinedTeams') {
        return { value: [{ id: 'team-1', displayName: 'Contoso Sales' }] };
      }
      if (url.pathname === '/v1.0/teams/team-1/channels') {
        return { value: [{ id: '19:general@thread.tacv2', displayName: 'General' }] };
      }
      if (url.pathname.endsWith('/messages/delta')) {
        return { value: [
          { id: 'm-1', messageType: 'message', subject: 'Northwind pilot', createdDateTime: '2026-10-07T10:00:00Z', lastModifiedDateTime: '2026-10-07T10:00:00Z', from: { user: { displayName: 'Ann Lee' } }, body: { contentType: 'html', content: '<p>Pilot starts <b>Monday</b></p>' } },
          { id: 'm-2', messageType: 'systemEventMessage', createdDateTime: '2026-10-07T09:00:00Z' },
        ] };
      }
      if (url.pathname.endsWith('/m-1/replies')) {
        return { value: [{ id: 'r-1', messageType: 'message', createdDateTime: '2026-10-07T11:00:00Z', from: { user: { displayName: 'Mara Ruiz' } }, body: { contentType: 'text', content: 'Confirmed.' } }] };
      }
      return { value: [] };
    });

    const docs = await drain(teamsConnector, {});

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ externalId: 'msteams:team-1:19:general@thread.tacv2:m-1', title: 'Northwind pilot' });
    expect(docs[0]!.content).toContain('Ann Lee: Pilot starts Monday');
    expect(docs[0]!.content).toContain('Mara Ruiz: Confirmed.');
    expect(docs[0]!.metadata).toMatchObject({ kind: 'msteams-thread', replyCount: 1, channelName: 'General' });

    const delta = urls.find(u => u.pathname.endsWith('/messages/delta'))!;

    expect(delta.searchParams.get('$filter')).toMatch(/^lastModifiedDateTime gt \d{4}-/);
  });

  it('a channel it cannot read is reported and the others carry on', async () => {
    stubGraph((url) => {
      if (url.pathname === '/v1.0/teams/team-1/channels') {
        return { value: [{ id: 'c-private', displayName: 'Board' }, { id: 'c-open', displayName: 'General' }] };
      }
      if (url.pathname.includes('/c-private/')) {
        return new Response(JSON.stringify({ error: { code: 'Forbidden' } }), { status: 403 });
      }
      if (url.pathname.endsWith('/messages/delta')) {
        return { value: [{ id: 'm-9', messageType: 'message', createdDateTime: new Date().toISOString(), from: { user: { displayName: 'Ann Lee' } }, body: { contentType: 'text', content: 'Hello' } }] };
      }
      return { value: [] };
    });
    const errors: string[] = [];
    const docs: IngestDoc[] = [];
    for await (const doc of teamsConnector.sync({ orgId: 'org_contoso', sourceId: 1, credentials: LOGIN, config: { teamId: 'team-1' }, onProgress: (e) => {
      if (e.kind === 'error') {
        errors.push(e.message ?? '');
      }
    } })) {
      docs.push(doc);
    }

    expect(docs.map(d => d.metadata?.channelName)).toEqual(['General']);
    expect(errors[0]).toMatch(/403 Forbidden/);
  });
});

describe('OneDrive and SharePoint', () => {
  it('walks folders, renders Office files to PDF for their text, downloads text files, and lists binaries by name', async () => {
    const urls = stubGraph((url) => {
      if (url.pathname === '/v1.0/me/drive/root/children') {
        return { value: [
          { id: 'f-1', folder: { childCount: 1 }, name: 'Clients' },
          { id: 'd-1', name: 'notes.md', file: { mimeType: 'text/markdown' }, size: 20, lastModifiedDateTime: '2026-10-01T00:00:00Z', parentReference: { driveId: 'drv' } },
        ] };
      }
      if (url.pathname === '/v1.0/me/drive/items/f-1/children') {
        return { value: [
          { id: 'd-2', name: 'Northwind proposal.docx', file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, size: 2000, lastModifiedDateTime: '2026-10-02T00:00:00Z', parentReference: { driveId: 'drv' } },
          { id: 'd-3', name: 'logo.png', file: { mimeType: 'image/png' }, size: 10, lastModifiedDateTime: '2026-10-02T00:00:00Z', parentReference: { driveId: 'drv' } },
        ] };
      }
      if (url.pathname === '/v1.0/me/drive/items/d-1/content') {
        return new Response('# Notes\nKestrel call', { status: 200 });
      }
      if (url.pathname === '/v1.0/me/drive/items/d-2/content') {
        return new Response(Buffer.from('proposal-pdf'), { status: 200 });
      }
      return { value: [] };
    });

    const docs = await drain(onedriveConnector, {});
    const byName = Object.fromEntries(docs.map(d => [d.title, d]));

    expect(Object.keys(byName).sort()).toEqual(['Northwind proposal.docx', 'logo.png', 'notes.md']);
    expect(byName['notes.md']!.content).toBe('# Notes\nKestrel call');
    expect(byName['Northwind proposal.docx']!.content).toBe('pdf text of proposal-pdf');
    expect(byName['Northwind proposal.docx']!.metadata).toMatchObject({ path: 'Clients/Northwind proposal.docx' });
    expect(byName['logo.png']!.content).toBe('logo.png\nClients/logo.png');
    expect(urls.find(u => u.pathname.endsWith('/d-2/content'))!.searchParams.get('format')).toBe('pdf');
    expect(urls.some(u => u.pathname.endsWith('/d-3/content'))).toBe(false);
  });

  it('an incremental run downloads only what changed since the watermark', async () => {
    const urls = stubGraph((url) => {
      if (url.pathname === '/v1.0/me/drive/root/children') {
        return { value: [
          { id: 'old', name: 'old.txt', file: {}, lastModifiedDateTime: '2026-01-01T00:00:00Z' },
          { id: 'new', name: 'new.txt', file: {}, lastModifiedDateTime: '2026-10-05T00:00:00Z' },
        ] };
      }
      return new Response('text', { status: 200 });
    });

    const docs = await drain(onedriveConnector, {}, new Date('2026-10-01T00:00:00Z'));

    expect(docs.map(d => d.title)).toEqual(['new.txt']);
    expect(urls.some(u => u.pathname.endsWith('/old/content'))).toBe(false);
  });

  it('opens a SharePoint site by its address and a library by name', async () => {
    const urls = stubGraph((url) => {
      if (url.pathname === '/v1.0/sites/contoso.sharepoint.com:/sites/Sales:') {
        return { id: 'site-1', displayName: 'Sales' };
      }
      if (url.pathname === '/v1.0/sites/site-1/drives') {
        return { value: [{ id: 'drv-docs', name: 'Documents' }, { id: 'drv-prop', name: 'Proposals' }] };
      }
      if (url.pathname === '/v1.0/drives/drv-prop/root/children') {
        return { value: [{ id: 'p-1', name: 'Kestrel.pdf', file: { mimeType: 'application/pdf' }, size: 5, parentReference: { driveId: 'drv-prop' } }] };
      }
      if (url.pathname === '/v1.0/drives/drv-prop/items/p-1/content') {
        return new Response(Buffer.from('kestrel'), { status: 200 });
      }
      return { value: [] };
    });

    const docs = await drain(sharepointConnector, { site: 'https://contoso.sharepoint.com/sites/Sales', library: 'proposals' });

    expect(docs).toEqual([expect.objectContaining({ externalId: 'sharepoint:drv-prop:p-1', content: 'pdf text of kestrel', metadata: expect.objectContaining({ siteName: 'Sales', library: 'Proposals' }) })]);
    expect(urls[0]!.pathname).toBe('/v1.0/sites/contoso.sharepoint.com:/sites/Sales:');
  });

  it('reads a site however it was pasted, and knows which files have text', () => {
    expect(sitePath('')).toBe('/sites/root');
    expect(sitePath('https://contoso.sharepoint.com/')).toBe('/sites/contoso.sharepoint.com');
    expect(sitePath('contoso.sharepoint.com:/sites/Sales')).toBe('/sites/contoso.sharepoint.com:/sites/Sales:');
    expect(sitePath('contoso.sharepoint.com,1111,2222')).toBe('/sites/contoso.sharepoint.com,1111,2222');
    expect(readModeOf({ id: '1', name: 'Budget.XLSX' })).toBe('convert');
    expect(readModeOf({ id: '1', name: 'scan.pdf' })).toBe('pdf');
    expect(readModeOf({ id: '1', name: 'data.csv' })).toBe('text');
    expect(readModeOf({ id: '1', name: 'video.mp4' })).toBe('none');
  });
});
