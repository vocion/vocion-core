/**
 * The saved call, and why resume does not have to guess.
 *
 * At the moment the stub fires, the model has already chosen the tool and the
 * arguments. These cases are about keeping that exact pair — and keeping it
 * for the one person who may replay it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { connectionIntentSchema } = await import('@/models/Schema');
const { claimIntent, pendingIntent, saveIntent } = await import('./connectionIntent');

const ORG = 'org_intent_test';
const JAMIE = 'user_jamie';
const DANA = 'user_dana';

/** The call step 05 had already decided: tomorrow's window, not a guess. */
const WINDOW = { timeMin: '2026-09-20T00:00', timeMax: '2026-09-20T23:59' };

beforeEach(async () => {
  await db.delete(connectionIntentSchema);
});

afterAll(async () => {
  await db.delete(connectionIntentSchema);
});

describe('connection intents', () => {
  it('keeps the exact call, so resume replays it rather than re-deciding it', async () => {
    await saveIntent({
      orgId: ORG,
      userId: JAMIE,
      conversationId: 42,
      connectorSlug: 'google-calendar',
      tool: 'list_events',
      args: WINDOW,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const found = await pendingIntent({ orgId: ORG, userId: JAMIE, conversationId: 42 });

    expect(found).toMatchObject({
      tool: 'list_events',
      args: WINDOW,
      connectorSlug: 'google-calendar',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
  });

  it('is one person\'s, even in a thread two people can see', async () => {
    await saveIntent({ orgId: ORG, userId: JAMIE, conversationId: 42, connectorSlug: 'gmail', tool: 'get_gmail_thread', args: {}, scopes: [] });

    // Replaying it would run a tool that resolves JAMIE's personal credential.
    await expect(pendingIntent({ orgId: ORG, userId: DANA, conversationId: 42 })).resolves.toBeNull();
  });

  it('is claimed once, so two tabs finishing one consent do not both replay', async () => {
    const id = await saveIntent({ orgId: ORG, userId: JAMIE, conversationId: 42, connectorSlug: 'gmail', tool: 'get_gmail_thread', args: {}, scopes: [] });

    await expect(claimIntent(id!)).resolves.toBe(true);
    await expect(claimIntent(id!)).resolves.toBe(false);
    await expect(pendingIntent({ orgId: ORG, userId: JAMIE, conversationId: 42 })).resolves.toBeNull();
  });

  it('answers with the newest when a turn left several', async () => {
    await saveIntent({ orgId: ORG, userId: JAMIE, conversationId: 42, connectorSlug: 'gmail', tool: 'get_gmail_thread', args: { id: 'old' }, scopes: [] });
    await saveIntent({ orgId: ORG, userId: JAMIE, conversationId: 42, connectorSlug: 'gmail', tool: 'get_gmail_thread', args: { id: 'new' }, scopes: [] });

    await expect(pendingIntent({ orgId: ORG, userId: JAMIE, conversationId: 42 })).resolves.toMatchObject({ args: { id: 'new' } });
  });

  it('does not resume an intent left in another thread', async () => {
    await saveIntent({ orgId: ORG, userId: JAMIE, conversationId: 42, connectorSlug: 'gmail', tool: 'get_gmail_thread', args: {}, scopes: [] });

    await expect(pendingIntent({ orgId: ORG, userId: JAMIE, conversationId: 99 })).resolves.toBeNull();
  });

  it('expires, because an intent is about a conversation in progress', async () => {
    const id = await saveIntent({ orgId: ORG, userId: JAMIE, conversationId: 42, connectorSlug: 'gmail', tool: 'get_gmail_thread', args: {}, scopes: [] });
    await db.update(connectionIntentSchema).set({ expiresAt: new Date(Date.now() - 1000) });

    await expect(pendingIntent({ orgId: ORG, userId: JAMIE, conversationId: 42 })).resolves.toBeNull();
    expect(id).toBeTypeOf('number');
  });
});
