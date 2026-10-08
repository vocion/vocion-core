/**
 * The Microsoft 365 read tools: present only for the connectors an agent
 * holds (and the person's source ACL allows), each read made with the
 * workspace's own login, and Outlook Calendar answering the one
 * `calendar_events` tool beside Google's.
 */
import type { RuntimeContext } from '../types';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));

const sourcesByConnector: Record<string, Array<{ id: number; slug: string }>> = {};
vi.mock('./zoomTranscript', () => ({
  sourcesForConnector: vi.fn(async (_orgId: string, connector: string) => sourcesByConnector[connector] ?? []),
  firstCredentialed: vi.fn(async (_orgId: string, sources: Array<{ id: number; slug: string }>) => (sources[0]
    ? { source: sources[0], credentials: { accessToken: `at-${sources[0].slug}`, refreshToken: 'rt', expiresAt: '2999-01-01T00:00:00.000Z' } }
    : undefined)),
}));

const { microsoft365Tools, microsoftInScope } = await import('./microsoft365');
const { calendarTools } = await import('./calendarEvents');

function ctx(sources: string[], over: Partial<RuntimeContext> = {}): RuntimeContext {
  return { orgId: 'org_contoso', connectorSources: sources, timeZone: 'UTC', ...over } as unknown as RuntimeContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(sourcesByConnector)) {
    delete sourcesByConnector[key];
  }
});

describe('Microsoft 365 read tools', () => {
  it('appear only for the connectors the agent holds', () => {
    expect(microsoft365Tools(ctx(['gmail']))).toEqual([]);
    expect(microsoft365Tools(ctx(['outlook-mail'])).map(t => t.name)).toEqual(['outlook_search_mail', 'get_outlook_thread']);
    expect(microsoft365Tools(ctx(['microsoft-teams'])).map(t => t.name)).toEqual(['msteams_list_channels', 'msteams_read_channel', 'msteams_read_chat']);
    expect(microsoft365Tools(ctx(['sharepoint-sales'])).map(t => t.name)).toEqual(['microsoft_files_search', 'microsoft_file_read']);
    expect(microsoft365Tools(ctx(['clients-drive'], { sourceKinds: { 'clients-drive': 'onedrive' } })).map(t => t.name)).toEqual(['microsoft_files_search', 'microsoft_file_read']);
  });

  it('honour the person\'s source ACL', () => {
    expect(microsoftInScope(ctx(['microsoft-teams'], { allowedSourceSlugs: ['gmail'] }), 'microsoft-teams')).toBe(false);
    expect(microsoftInScope(ctx(['microsoft-teams'], { allowedSourceSlugs: ['microsoft-teams'] }), 'microsoft-teams')).toBe(true);
  });

  it('search mail live with the workspace\'s login and return typed rows', async () => {
    sourcesByConnector['outlook-mail'] = [{ id: 7, slug: 'outlook-mail' }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ value: [{ id: 'm1', conversationId: 'c1', subject: 'Northwind renewal', bodyPreview: 'Terms attached', from: { emailAddress: { name: 'Mara Ruiz', address: 'mara@northwind.example' } }, receivedDateTime: '2026-10-07T10:00:00Z' }] })));
    vi.stubGlobal('fetch', fetchMock);
    const search = microsoft365Tools(ctx(['outlook-mail'])).find(t => t.name === 'outlook_search_mail')!;

    const out = JSON.parse(await search.invoke({ query: 'Northwind' }) as string);

    expect(out).toMatchObject({ ok: true, messages: [{ id: 'm1', conversationId: 'c1', from: 'Mara Ruiz <mara@northwind.example>' }] });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(new URL(url).searchParams.get('$search')).toBe('"Northwind"');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer at-outlook-mail');
  });

  it('say what to fix, as data, when the workspace has no Microsoft login', async () => {
    const list = microsoft365Tools(ctx(['microsoft-teams'])).find(t => t.name === 'msteams_list_channels')!;

    expect(JSON.parse(await list.invoke({}) as string)).toEqual({ ok: false, error: expect.stringMatching(/log in with Microsoft on the Connectors page/) });
  });
});

describe('calendar_events with Outlook Calendar', () => {
  it('is offered for an Outlook calendar alone, and reads it live, split against now', async () => {
    sourcesByConnector['outlook-calendar'] = [{ id: 3, slug: 'outlook-calendar' }];
    const later = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 19);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: [
      { id: 'e1', subject: 'Contoso QBR', start: { dateTime: later, timeZone: 'UTC' }, end: { dateTime: later, timeZone: 'UTC' }, attendees: [{ emailAddress: { name: 'Mara Ruiz' } }] },
      { id: 'e2', subject: 'Dropped', isCancelled: true, start: { dateTime: later, timeZone: 'UTC' } },
    ] }))));
    const [tool] = calendarTools(ctx(['outlook-calendar']));

    const out = await tool!.invoke({}) as string;

    expect(out).toContain('STILL AHEAD (1)');
    expect(out).toContain('Contoso QBR');
    expect(out).toContain('with: Mara Ruiz');
    expect(out).not.toContain('Dropped');
  });

  it('says a calendar it could not read rather than presenting the rest as the whole day', async () => {
    const [tool] = calendarTools(ctx(['outlook-calendar']));

    expect(await tool!.invoke({}) as string).toMatch(/^Calendar read failed — Outlook Calendar: No Microsoft 365 login/);
  });
});
