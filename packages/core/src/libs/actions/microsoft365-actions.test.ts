/**
 * The two Microsoft 365 writes: a Teams channel post (not reversible from
 * here) and an Outlook calendar event (Undo deletes it). Graph is a stub; the
 * workspace's Microsoft token comes from a mocked resolver, per org.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));

const tokens: Record<string, string> = { org_contoso: 'at-contoso', org_northwind: 'at-northwind' };
vi.mock('@/services/agents/tools/microsoft365', () => ({
  graphTokenForConnector: vi.fn(async (orgId: string) => (tokens[orgId]
    ? { ok: true, token: tokens[orgId] }
    : { ok: false, error: 'No Microsoft 365 login is stored for this workspace. An admin needs to log in with Microsoft on the Connectors page.' })),
}));

const { teamsHtml, teamsPostMessageAction, teamsPostPath } = await import('./msteams-post-message');
const { eventBody, graphDateTime, outlookCreateEventAction } = await import('./outlook-create-event');
const { getAction } = await import('./registry');
const { DEFAULT_RISK_TIER } = await import('@/services/autonomy/rungs');

type Call = { url: string; method: string; authorization: string | null; body: unknown };

function stubGraph(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call = { url: String(url), method: init?.method ?? 'GET', authorization: headers.authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return answer(call);
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('msteams.post_message', () => {
  const input = teamsPostMessageAction.inputSchema.parse({ teamId: 'team-1', channelId: '19:general@thread.tacv2', text: 'Pilot starts Monday.\nBring the <draft> & notes.', subject: 'Northwind pilot', channelName: 'Contoso Sales › General' });

  it('is registered, gated like any outbound post, and declares no Undo', () => {
    expect(getAction('msteams.post_message')).toBe(teamsPostMessageAction);
    expect(teamsPostMessageAction.external).toBe(true);
    expect(teamsPostMessageAction.undo).toBeUndefined();
    expect(DEFAULT_RISK_TIER['msteams.post_message']).toBe('medium');
  });

  it('posts as the workspace\'s own login, the text escaped into Teams\' HTML, and says it cannot be undone on the card', async () => {
    const calls = stubGraph(() => new Response(JSON.stringify({ id: 'msg-1', webUrl: 'https://teams.example/l/message/1' }), { status: 201 }));

    const result = await teamsPostMessageAction.execute({ orgId: 'org_contoso' }, input);

    expect(calls[0]).toMatchObject({
      url: 'https://graph.microsoft.com/v1.0/teams/team-1/channels/19%3Ageneral%40thread.tacv2/messages',
      method: 'POST',
      authorization: 'Bearer at-contoso',
      body: { subject: 'Northwind pilot', body: { contentType: 'html', content: 'Pilot starts Monday.<br>Bring the &lt;draft&gt; &amp; notes.' } },
    });
    expect(result).toMatchObject({ posted: true, messageId: 'msg-1', line: 'Posted to Teams channel Contoso Sales › General.' });

    const card = await teamsPostMessageAction.reviewCard!({ orgId: 'org_contoso' }, input);

    expect(card.headline).toMatch(/cannot be undone from here/);
    expect(card.badges).toContainEqual({ label: 'Irreversible', tone: 'warn' });
  });

  it('replies in a thread when given its root, and each org posts with its own token', async () => {
    const calls = stubGraph(() => new Response(JSON.stringify({ id: 'r-1' }), { status: 201 }));

    await teamsPostMessageAction.execute({ orgId: 'org_northwind' }, { ...input, replyToId: 'm-1' });

    expect(calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/teams/team-1/channels/19%3Ageneral%40thread.tacv2/messages/m-1/replies');
    expect(calls[0]!.authorization).toBe('Bearer at-northwind');
    expect(calls[0]!.body).not.toHaveProperty('subject');
    expect(teamsPostPath({ teamId: 't', channelId: 'c' })).toBe('/teams/t/channels/c/messages');
    expect(teamsHtml('a\r\nb')).toBe('a<br>b');
  });

  it('is refused at the door, with the fix, in a workspace with no Microsoft login', async () => {
    expect(await teamsPostMessageAction.precheck!({ orgId: 'org_none' }, input)).toMatch(/log in with Microsoft/);
    expect(await teamsPostMessageAction.precheck!({ orgId: 'org_contoso' }, input)).toBeUndefined();
  });

  it('takes the reviewer\'s edit to the words', () => {
    expect(teamsPostMessageAction.applyContentEdits!(input, [{ id: 'message', body: 'Pilot moved to Tuesday.' }]).text).toBe('Pilot moved to Tuesday.');
  });
});

describe('outlook.create_event', () => {
  const input = outlookCreateEventAction.inputSchema.parse({
    subject: 'Kestrel Capital intro',
    start: '2026-10-12T15:00:00Z',
    end: '2026-10-12T15:30:00-00:00',
    attendees: ['mara@kestrel.example'],
    location: 'Online',
    body: 'Agenda: fund overview.',
    teamsMeeting: true,
  });

  it('is registered, reversible and gated at medium', () => {
    expect(getAction('outlook.create_event')).toBe(outlookCreateEventAction);
    expect(typeof outlookCreateEventAction.undo).toBe('function');
    expect(DEFAULT_RISK_TIER['outlook.create_event']).toBe('medium');
  });

  it('writes instants as UTC and wall-clock times in the zone named', () => {
    expect(graphDateTime('2026-10-12T08:00:00-07:00', undefined)).toEqual({ dateTime: '2026-10-12T15:00:00', timeZone: 'UTC' });
    expect(graphDateTime('2026-10-12T08:00:00', 'Pacific Standard Time')).toEqual({ dateTime: '2026-10-12T08:00:00', timeZone: 'Pacific Standard Time' });
    expect(eventBody(input)).toMatchObject({
      attendees: [{ emailAddress: { address: 'mara@kestrel.example' }, type: 'required' }],
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
      body: { contentType: 'text', content: 'Agenda: fund overview.' },
    });
  });

  it('refuses an event that ends before it starts, before anything is queued', async () => {
    expect(await outlookCreateEventAction.precheck!({ orgId: 'org_contoso' }, { ...input, end: '2026-10-12T14:00:00Z' })).toMatch(/ends before it starts/);
  });

  it('creates the event and records its id, and Undo deletes that event', async () => {
    const calls = stubGraph(call => (call.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ id: 'evt-1', webLink: 'https://outlook.example/evt-1', onlineMeeting: { joinUrl: 'https://teams.example/join/2' } }), { status: 201 })));

    const result = await outlookCreateEventAction.execute({ orgId: 'org_contoso' }, input);

    expect(calls[0]).toMatchObject({ url: 'https://graph.microsoft.com/v1.0/me/events', method: 'POST', authorization: 'Bearer at-contoso' });
    expect(result).toMatchObject({ created: true, eventId: 'evt-1', joinUrl: 'https://teams.example/join/2' });

    const undone = await outlookCreateEventAction.undo!({ orgId: 'org_contoso' }, input, result);

    expect(calls[1]).toMatchObject({ url: 'https://graph.microsoft.com/v1.0/me/events/evt-1', method: 'DELETE' });
    expect(undone).toMatchObject({ deleted: true, eventId: 'evt-1' });
  });

  it('Undo of an event already deleted in Outlook says so instead of failing', async () => {
    stubGraph(() => new Response(JSON.stringify({ error: { code: 'ErrorItemNotFound' } }), { status: 404 }));

    expect(await outlookCreateEventAction.undo!({ orgId: 'org_contoso' }, input, { eventId: 'evt-gone' })).toMatchObject({ deleted: true, line: expect.stringMatching(/already gone/) });
  });
});
