/**
 * The Zendesk calls a hand-off makes, against a fake Zendesk: the requester is
 * found or made in the agreed order, is always the caller, is never an agent
 * or admin, and no existing user is ever changed; a ticket's 404
 * reads as gone, and a create sends the stored body byte for byte with its
 * Idempotency-Key.
 */
import type { ZendeskCredentials } from './client';
import type { Answer } from './fakeZendesk';
import { describe, expect, it } from 'vitest';
import { ZendeskError } from './client';
import { depsFor, FakeZendesk, tokenAnswer } from './fakeZendesk';
import { createTicket, EMAIL_SEARCH_MAX_PAGES, requesterIdFor, RequesterNotEndUserError, ticketByExternalId, ticketStatus } from './tickets';

const TOKENS = '/oauth/tokens';
const SEARCH = '/api/v2/users/search';
const USERS = '/api/v2/users';
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

/**
 * A users search answer.
 * @param users - The users it lists.
 */
function found(...users: Array<Record<string, unknown>>): Answer {
  return { status: 200, body: { users } };
}

/**
 * The methods of every call except the token mint, so a test can say nothing was written.
 * @param fake - The fake Zendesk.
 */
function apiMethods(fake: FakeZendesk): string[] {
  return fake.calls.filter(call => !call.url.includes(TOKENS)).map(call => call.init.method ?? 'GET');
}

/**
 * What each users search asked for, as `external_id=…` or `query=…`.
 * @param fake - The fake Zendesk.
 */
function searches(fake: FakeZendesk): string[] {
  return fake.sentTo(SEARCH).map(call => new URL(call.url).search.slice(1));
}

describe('requesterIdFor', () => {
  it('uses the end user whose external id is the caller id, and changes nothing', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [found({ id: 501, role: 'end-user' })] });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(501);
    expect(searches(fake)).toEqual(['external_id=doc-123']);
    expect(apiMethods(fake)).toEqual(['GET']);
  });

  it('uses an end user an earlier tool keyed by email as is, without moving its external id', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [found(), found({ id: 777, role: 'end-user' })] });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(777);
    expect(searches(fake)).toEqual(['external_id=doc-123', 'external_id=pat%40example.com']);
    expect(apiMethods(fake)).toEqual(['GET', 'GET']);
  });

  it('uses the existing end user whose email is the caller\'s, ignoring case and partial matches', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      [SEARCH]: [found(), found(), found({ id: 300, role: 'end-user', email: 'spat@example.com' }, { id: 410, role: 'end-user', email: 'Pat@Example.com' })],
    });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(410);
    expect(searches(fake)[2]).toBe('query=email%3Apat%40example.com&per_page=100&page=1');
    expect(apiMethods(fake)).toEqual(['GET', 'GET', 'GET']);
  });

  it('reads the next page of the email search while Zendesk says there is one', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      [SEARCH]: [
        found(),
        found(),
        { status: 200, body: { users: [{ id: 300, role: 'end-user', email: 'pat@example.com.au' }], next_page: 'https://acme.zendesk.com/api/v2/users/search.json?page=2' } },
        { status: 200, body: { users: [{ id: 410, role: 'end-user', email: 'pat@example.com' }], next_page: null } },
      ],
    });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(410);
    expect(searches(fake).slice(2)).toEqual(['query=email%3Apat%40example.com&per_page=100&page=1', 'query=email%3Apat%40example.com&per_page=100&page=2']);
  });

  it('stops paging the email search at the cap and goes on to the create, which changes no existing user', async () => {
    const endless: Answer = { status: 200, body: { users: [{ id: 300, role: 'end-user', email: 'pat@example.com.au' }], next_page: 'https://acme.zendesk.com/api/v2/users/search.json?page=next' } };
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      [SEARCH]: [found(), found(), endless],
      [USERS]: [{ status: 201, body: { user: { id: 900, role: 'end-user' } } }],
    });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(900);
    expect(searches(fake).filter(search => search.startsWith('query='))).toHaveLength(EMAIL_SEARCH_MAX_PAGES);
    expect(fake.sentTo(USERS).map(call => call.init.method)).toEqual(['POST']);
  });

  it('picks the lowest id when more than one end user matches, so every tap files for the same one', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [found({ id: 900, role: 'end-user' }, { id: 500, role: 'end-user' })] });

    expect(await requesterIdFor(freshClient(), CALLER, depsFor(fake))).toBe(500);
  });

  it('keeps the caller\'s email out of the error when Zendesk answers a lookup with a malformed user', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [found({ role: 'end-user' })] });

    const failed = await requesterIdFor(freshClient(), CALLER, depsFor(fake)).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(ZendeskError);
    expect((failed as Error).message).not.toContain('example.com');
    expect((failed as Error).message).not.toContain('doc-123');
  });

  it.each([
    ['their id as external id', [found({ id: 8, role: 'agent' })]],
    ['their email as external id', [found(), found({ id: 8, role: 'admin' })]],
    ['their email', [found(), found(), found({ id: 8, role: 'admin', email: 'pat@example.com' })]],
  ])('stops without writing anything when %s matches a Zendesk agent or admin', async (_step, answers) => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: answers });

    const failed = await requesterIdFor(freshClient(), CALLER, depsFor(fake)).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(RequesterNotEndUserError);
    expect(failed).toMatchObject({ zendeskUserId: 8 });
    expect(apiMethods(fake).every(method => method === 'GET')).toBe(true);
  });

  it('stops when an agent shares the caller\'s external id with an end user, rather than picking the end user', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [found({ id: 501, role: 'end-user' }, { id: 8, role: 'agent' })] });

    await expect(requesterIdFor(freshClient(), CALLER, depsFor(fake))).rejects.toBeInstanceOf(RequesterNotEndUserError);
  });

  it('treats a matched user with no role as not an end user', async () => {
    const fake = new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [found({ id: 501 })] });

    await expect(requesterIdFor(freshClient(), CALLER, depsFor(fake))).rejects.toBeInstanceOf(RequesterNotEndUserError);
  });

  it('creates a new end user with POST /api/v2/users from the caller\'s own name, email and id when no lookup matches', async () => {
    const fake = new FakeZendesk({
      [TOKENS]: [tokenAnswer('tok-1')],
      [SEARCH]: [found(), found(), found({ id: 8, role: 'agent', email: 'pat@example.com.au' })],
      [USERS]: [{ status: 201, body: { user: { id: 900, role: 'end-user' } } }],
    });

    const id = await requesterIdFor(freshClient(), CALLER, depsFor(fake));

    expect(id).toBe(900);

    const [create] = fake.sentTo(USERS);

    expect(create!.init.method).toBe('POST');
    expect(sentBody(create!)).toEqual({ user: { name: 'Pat Example', email: 'pat@example.com', external_id: 'doc-123', role: 'end-user' } });
    expect(fake.sentTo('/api/v2/users/create_or_update')).toHaveLength(0);
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
