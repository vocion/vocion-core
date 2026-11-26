/**
 * The Zendesk calls a hand-off makes, against a fake Zendesk: the requester is
 * found or fixed in the agreed order and is always the caller, a ticket's 404
 * reads as gone, and a create sends the stored body byte for byte with its
 * Idempotency-Key.
 */
import type { ZendeskCredentials } from './client';
import { describe, expect, it } from 'vitest';
import { ZendeskError } from './client';
import { depsFor, FakeZendesk, tokenAnswer } from './fakeZendesk';
import { createTicket, requesterIdFor, ticketByExternalId, ticketStatus } from './tickets';

const TOKENS = '/oauth/tokens';
const SEARCH = '/api/v2/users/search';
const CREATE_OR_UPDATE = '/api/v2/users/create_or_update';
const CALLER = { id: 'doc-123', name: 'Pat Example', email: 'pat@example.com' };

let clientCount = 0;

/** A client no other test has used, so the module's token cache starts empty for it. */
function freshClient(): ZendeskCredentials {
  clientCount += 1;
  return { subdomain: 'acme', clientId: `vocion-tickets-test-${clientCount}`, clientSecret: 'fixture-secret-0002' };
}

/**
 * The parsed JSON body of a call.
 * @param call - A call the fake recorded.
 * @param call.init - Its request init.
 */
function sentBody(call: { init: RequestInit }): unknown {
  return JSON.parse(String(call.init.body));
}

describe('requesterIdFor', () => {
  it('uses the user whose external id is the caller id, and changes nothing', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [{ status: 200, body: { users: [{ id: 501 }] } }] });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(501);
    expect(fake.sentTo(SEARCH).map(call => new URL(call.url).searchParams.get('external_id'))).toEqual(['doc-123']);
    expect(fake.calls.filter(call => !call.url.includes(TOKENS)).map(call => call.init.method ?? 'GET')).toEqual(['GET']);
  });

  it('moves a user an earlier tool keyed by email over to the caller id instead of making a second user', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      [SEARCH]: [{ status: 200, body: { users: [] } }, { status: 200, body: { users: [{ id: 777 }] } }],
      '/api/v2/users/777': [{ status: 200, body: { user: { id: 777 } } }],
    });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(777);
    expect(fake.sentTo(SEARCH).map(call => new URL(call.url).searchParams.get('external_id'))).toEqual(['doc-123', 'pat@example.com']);

    const [put] = fake.sentTo('/api/v2/users/777');

    expect(put!.init.method).toBe('PUT');
    expect(sentBody(put!)).toEqual({ user: { external_id: 'doc-123' } });
    expect(fake.sentTo(CREATE_OR_UPDATE)).toHaveLength(0);
  });

  it('creates the user from the caller\'s own name, email and id when neither lookup finds one', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      [SEARCH]: [{ status: 200, body: { users: [] } }],
      [CREATE_OR_UPDATE]: [{ status: 201, body: { user: { id: 900 } } }],
    });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(900);
    expect(sentBody(fake.sentTo(CREATE_OR_UPDATE)[0]!)).toEqual({ user: { name: 'Pat Example', email: 'pat@example.com', external_id: 'doc-123' } });
  });
});

describe('ticketStatus', () => {
  it('reads a ticket\'s status', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], '/api/v2/tickets/42': [{ status: 200, body: { ticket: { id: 42, status: 'pending' } } }] });

    expect(await ticketStatus(freshClient(), 42, depsFor(fake))).toBe('pending');
  });

  it('reads a 404 as gone, so the next tap may open a new ticket', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], '/api/v2/tickets/42': [{ status: 404, body: { error: 'RecordNotFound' } }] });

    expect(await ticketStatus(freshClient(), 42, depsFor(fake))).toBeNull();
  });

  it('does not read a server error as gone', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], '/api/v2/tickets/42': [{ status: 503 }] });

    await expect(ticketStatus(freshClient(), 42, depsFor(fake))).rejects.toBeInstanceOf(ZendeskError);
  });
});

describe('ticketByExternalId', () => {
  it('picks the first ticket made when Zendesk answers more than one', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      '/api/v2/tickets': [{ status: 200, body: { tickets: [{ id: 90, status: 'open' }, { id: 12, status: 'new' }] } }],
    });

    expect(await ticketByExternalId(freshClient(), 'vocion-handoff-k1', depsFor(fake))).toEqual({ id: 12, status: 'new' });
    expect(new URL(fake.sentTo('/api/v2/tickets')[0]!.url).searchParams.get('external_id')).toBe('vocion-handoff-k1');
  });

  it('answers null when no ticket carries the external id', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], '/api/v2/tickets': [{ status: 200, body: { tickets: [] } }] });

    expect(await ticketByExternalId(freshClient(), 'vocion-handoff-k1', depsFor(fake))).toBeNull();
  });
});

describe('createTicket', () => {
  it('sends the stored body unchanged with the Idempotency-Key', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], '/api/v2/tickets': [{ status: 201, body: { ticket: { id: 55, status: 'new' } } }] });
    const body = '{"ticket":{"subject":"[TEST] Help","comment":{"body":"Needs a person"},"status":"new"}}';

    const ticket = await createTicket(freshClient(), body, 'key-1', depsFor(fake));

    expect(ticket).toEqual({ id: 55, status: 'new' });

    const [call] = fake.sentTo('/api/v2/tickets');

    expect(call!.init.body).toBe(body);
    expect((call!.init.headers as Record<string, string>)['idempotency-key']).toBe('key-1');
  });
});
