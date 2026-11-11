/**
 * A STALE PROPOSAL IS TAKEN BACK, AGAINST THE REAL ROWS (2026-11-11): an ask the thread has moved
 * past is not run by a later "approve", and stops waiting in any queue. Against PGlite; every name
 * is invented.
 */
import type { ChatInbound } from '@/libs/surfaces/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { approvalFromThread, defaultThreadApprovalDeps } = await import('./slackApproval');
const { eq } = await import('drizzle-orm');

const ORG = 'org_stale_ask';
const CONVERSATION = 474;
const inbound: ChatInbound = { surface: 'slack', teamId: 'T1', channelId: 'C7', threadRef: '1.001', messageRef: '1.009', externalUserId: 'U9', text: 'then approve the billing and export tickets', isDirect: false };

describe('a proposal the thread has moved past', () => {
  it('is read with when it was filed, by whom and from where, and named by its summary', async () => {
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'mcp.act', status: 'pending', input: { sourceSlug: 'tickets', tool: 'answer', input: {}, summary: 'Pass on the yes to build the export ticket, with a condition.' }, invokedBy: 'agent:factory-desk', proposal: { origin: { conversationId: CONVERSATION } } } as never).returning();
    const [card] = await defaultThreadApprovalDeps.pending(ORG, CONVERSATION);

    expect(card).toMatchObject({ runId: run!.id, title: 'Pass on the yes to build the export ticket, with a condition', filedHere: true, filedBy: 'agent:factory-desk' });
    expect(card!.createdAt).toBeInstanceOf(Date);
  });

  it('is withdrawn rather than run by a later reply, with a plain reason, and no consent is read', async () => {
    const [card] = await defaultThreadApprovalDeps.pending(ORG, CONVERSATION);
    const consent = vi.fn(async () => ({ said: true, quote: 'approve' }));
    const decide = vi.fn(async () => ({ ok: true, what: 'It ran; Undo is in Vocion.' }));
    // Since it was filed, the agent asked, then said something else: the ask is no longer its latest message.
    const later = (minutes: number) => new Date(card!.createdAt!.getTime() + minutes * 60_000);
    const out = await approvalFromThread(ORG, inbound, CONVERSATION, { ...defaultThreadApprovalDeps, consent, decide }, null, [{ role: 'assistant', createdAt: later(1) }, { role: 'assistant', createdAt: later(30) }]);

    expect(out).toMatchObject({ decided: false, reply: null, withdrawn: [{ runId: card!.runId }] });
    expect(consent).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, card!.runId));

    expect(row!.status).toBe('rejected');
    expect(row!.error).toContain('Withdrawn by factory-desk: the thread moved on before it was decided');
    expect(await defaultThreadApprovalDeps.pending(ORG, CONVERSATION)).toEqual([]);
  });
});
