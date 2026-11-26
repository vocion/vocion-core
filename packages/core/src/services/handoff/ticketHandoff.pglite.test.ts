import type { TicketHandoffInput } from './ticketHandoff';
/**
 * Handing a conversation to a person, against a real (PGlite) database and a
 * fake Zendesk: one open ticket per conversation however the taps arrive, a
 * retry that can only get the same ticket, a solved or missing ticket that
 * lets the next tap open a new one, and a ticket that finds its conversation.
 */
import type { ZendeskCredentials } from '@/libs/zendesk/client';
import type { Answer } from '@/libs/zendesk/fakeZendesk';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { db } from '@/libs/DB';
import { depsFor, FakeZendesk, tokenAnswer } from '@/libs/zendesk/fakeZendesk';
import { zendeskTicketSettingsSchema } from '@/libs/zendesk/ticketSettings';
import { ticketHandoffSchema } from '@/models/Schema';
import { createConversation } from '@/services/ConversationService';
import { conversationForTicket, handOffToTicket, openHandoffFor, TicketHandoffError } from './ticketHandoff';

vi.mock('@/libs/DB');

const ORG = 'org_handoff';
const TOKENS = '/oauth/tokens';
const SEARCH = '/api/v2/users/search';
const TICKETS = '/api/v2/tickets';
const CALLER = { id: 'doc-123', name: 'Pat Example', email: 'pat@example.com' };
const SETTINGS = zendeskTicketSettingsSchema.parse({ topicTags: { billing: 'billing_queue' }, fallbackTopicTag: 'else', tags: ['vocion-dev'], subjectPrefix: '[TEST]' });

let clientCount = 0;

/** A client no other test has used, so the module's token cache starts empty for it. */
function freshClient(): ZendeskCredentials {
  clientCount += 1;
  return { subdomain: 'acme', clientId: `vocion-handoff-test-${clientCount}`, clientSecret: 'fixture-secret-0003' };
}

/** A conversation row for the hand-off to point at. */
async function newConversation(): Promise<number> {
  const conversation = await createConversation({ orgId: ORG, agentSlug: 'support-lead' });
  return conversation.id;
}

/**
 * A fake Zendesk that knows the caller already, with these answers for the tickets paths.
 * @param tickets - Answers by path, merged over the defaults.
 */
function zendesk(tickets: Record<string, Answer[]>): FakeZendesk {
  return new FakeZendesk({ [TOKENS]: [tokenAnswer('tok-1')], [SEARCH]: [{ status: 200, body: { users: [{ id: 501 }] } }], ...tickets });
}

/**
 * One tap's input.
 * @param conversationId - The conversation.
 * @param fake - The fake Zendesk.
 * @param credentials - The client.
 * @param overrides - Fields to change.
 */
function tap(conversationId: number, fake: FakeZendesk, credentials: ZendeskCredentials, overrides: Partial<TicketHandoffInput> = {}): TicketHandoffInput {
  return {
    orgId: ORG,
    conversationId,
    sourceSlug: 'zendesk',
    caller: CALLER,
    ticket: { subject: 'Card not charging', summary: 'The card stopped charging after the update.', topic: 'Billing' },
    credentials,
    settings: SETTINGS,
    requestUrlBase: 'https://help.example.com/hc/en-us/requests/',
    deps: depsFor(fake),
    ...overrides,
  };
}

/**
 * The ticket creates the fake received.
 * @param fake - The fake Zendesk.
 */
function creates(fake: FakeZendesk) {
  return fake.sentTo(TICKETS).filter(call => call.init.method === 'POST');
}

describe('handOffToTicket', () => {
  it('opens the ticket for the caller with status new, the prefix, the settings\' tags and its external id', async () => {
    const conversationId = await newConversation();
    const fake = zendesk({ [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 42, status: 'new' } } }] });

    const result = await handOffToTicket(tap(conversationId, fake, freshClient()));

    expect(result).toMatchObject({ ticketId: 42, created: true, requestUrl: 'https://help.example.com/hc/en-us/requests/42' });

    const row = await openHandoffFor(ORG, conversationId);
    const [create] = creates(fake);

    expect(JSON.parse(String(create!.init.body))).toEqual({
      ticket: {
        subject: '[TEST] Card not charging',
        comment: { body: 'The card stopped charging after the update.' },
        requester_id: 501,
        status: 'new',
        tags: ['billing_queue', 'vocion-dev'],
        external_id: `vocion-handoff-${row!.idempotencyKey}`,
      },
    });
    expect((create!.init.headers as Record<string, string>)['idempotency-key']).toBe(row!.idempotencyKey);
    expect(row).toMatchObject({ ticketId: 42, ticketStatus: 'new', callerId: 'doc-123', status: 'open' });
  });

  it('gives a second tap the same unsolved ticket and creates nothing', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({
      [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 42, status: 'new' } } }],
      '/api/v2/tickets/42': [{ status: 200, body: { ticket: { id: 42, status: 'open' } } }],
    });

    await handOffToTicket(tap(conversationId, fake, credentials));
    const second = await handOffToTicket(tap(conversationId, fake, credentials));

    expect(second).toMatchObject({ ticketId: 42, created: false });
    expect(creates(fake)).toHaveLength(1);
  });

  it('opens one ticket when two taps arrive at the same moment', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({
      [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 42, status: 'new' } } }],
      '/api/v2/tickets/42': [{ status: 200, body: { ticket: { id: 42, status: 'new' } } }],
    });

    const results = await Promise.all([handOffToTicket(tap(conversationId, fake, credentials)), handOffToTicket(tap(conversationId, fake, credentials))]);

    expect(results.map(r => r.ticketId)).toEqual([42, 42]);
    expect(results.filter(r => r.created)).toHaveLength(1);
    expect(creates(fake)).toHaveLength(1);
  });

  it('keeps the hand-off open after a timeout and replays the same body with the same key on the next tap', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({
      [TICKETS]: [
        { status: 200, body: { tickets: [] } },
        new Error('socket hang up'),
        { status: 200, body: { tickets: [] } },
        { status: 201, body: { ticket: { id: 43, status: 'new' } } },
      ],
    });

    const failed = await handOffToTicket(tap(conversationId, fake, credentials)).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(TicketHandoffError);
    expect((failed as TicketHandoffError).retryable).toBe(true);

    const stored = await openHandoffFor(ORG, conversationId);

    expect(stored?.requestBody).toBeTruthy();

    // The retry is a later tap with different wording: the stored body still wins.
    const retried = await handOffToTicket(tap(conversationId, fake, credentials, { ticket: { subject: 'Something else', summary: 'Different words', topic: 'other' } }));

    expect(retried).toMatchObject({ ticketId: 43, created: true });

    const [first, second] = creates(fake);

    expect(second!.init.body).toBe(first!.init.body);
    expect(second!.init.body).toBe(stored!.requestBody);
    expect((second!.init.headers as Record<string, string>)['idempotency-key']).toBe((first!.init.headers as Record<string, string>)['idempotency-key']);
    expect(fake.sentTo(SEARCH)).toHaveLength(1);
  });

  it('finds the ticket an earlier attempt made by its external id instead of creating a second one', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({ [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 503 }, { status: 200, body: { tickets: [{ id: 44, status: 'new' }] } }] });

    await handOffToTicket(tap(conversationId, fake, credentials)).catch(() => undefined);
    const found = await handOffToTicket(tap(conversationId, fake, credentials));

    expect(found).toMatchObject({ ticketId: 44, created: false });
    expect(creates(fake)).toHaveLength(1);
  });

  it.each([
    ['solved', { status: 200, body: { ticket: { id: 42, status: 'solved' } } }, 'solved'],
    ['missing (404)', { status: 404, body: { error: 'RecordNotFound' } }, 'not_found'],
  ])('closes the hand-off and opens a new ticket when the old one is %s', async (_label, answer, closedAs) => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({
      [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 42, status: 'new' } } }, { status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 60, status: 'new' } } }],
      '/api/v2/tickets/42': [answer as Answer],
    });

    await handOffToTicket(tap(conversationId, fake, credentials));
    const next = await handOffToTicket(tap(conversationId, fake, credentials));

    expect(next).toMatchObject({ ticketId: 60, created: true });

    const rows = await db.select().from(ticketHandoffSchema).where(eq(ticketHandoffSchema.conversationId, conversationId));

    expect(rows.map(r => [r.ticketId, r.status, r.ticketStatus]).sort()).toEqual([[42, 'closed', closedAs], [60, 'open', 'new']]);

    const [first, second] = creates(fake);

    expect((second!.init.headers as Record<string, string>)['idempotency-key']).not.toBe((first!.init.headers as Record<string, string>)['idempotency-key']);
  });

  it('closes the hand-off when Zendesk refuses the create, so the next tap builds a fresh one', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({ [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 422, body: { error: 'RecordInvalid' } }] });

    const failed = await handOffToTicket(tap(conversationId, fake, credentials)).catch((error: unknown) => error);

    expect(failed).toMatchObject({ code: 'ZENDESK_REFUSED', retryable: false });
    expect(await openHandoffFor(ORG, conversationId)).toBeNull();
  });

  it('keeps the hand-off open when Zendesk refuses a read, because an earlier create may have gone through', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({ [TICKETS]: [{ status: 403, body: { error: 'Forbidden' } }] });

    const failed = await handOffToTicket(tap(conversationId, fake, credentials)).catch((error: unknown) => error);

    expect(failed).toMatchObject({ code: 'ZENDESK_REFUSED' });
    expect((await openHandoffFor(ORG, conversationId))?.requestBody).toBeTruthy();
    expect(creates(fake)).toHaveLength(0);
  });

  it('refuses a different end user\'s tap on a conversation whose ticket is still open', async () => {
    const conversationId = await newConversation();
    const credentials = freshClient();
    const fake = zendesk({
      [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 42, status: 'new' } } }],
      '/api/v2/tickets/42': [{ status: 200, body: { ticket: { id: 42, status: 'open' } } }],
    });

    await handOffToTicket(tap(conversationId, fake, credentials));
    const other = await handOffToTicket(tap(conversationId, fake, credentials, { caller: { id: 'doc-999', name: 'Sam Other', email: 'sam@example.com' } })).catch((error: unknown) => error);

    expect(other).toMatchObject({ code: 'CALLER_MISMATCH' });
    expect(creates(fake)).toHaveLength(1);
  });
});

describe('conversationForTicket', () => {
  it('finds the conversation a ticket was opened for', async () => {
    const conversationId = await newConversation();
    const fake = zendesk({ [TICKETS]: [{ status: 200, body: { tickets: [] } }, { status: 201, body: { ticket: { id: 77, status: 'new' } } }] });

    await handOffToTicket(tap(conversationId, fake, freshClient()));

    expect(await conversationForTicket(ORG, 'zendesk', 77)).toBe(conversationId);
    expect(await conversationForTicket(ORG, 'zendesk', 78)).toBeNull();
  });
});
