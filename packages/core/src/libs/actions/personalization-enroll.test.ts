/**
 * personalization.enroll — the MQL review object's mechanics: dedup on the
 * contact, the lead back-link, edit-then-approve on the sends, Decline →
 * held, Enroll → the existing sequence + staged copy + handed_off, and the
 * never-auto invariant: no trust rule releases an enrollment without a human.
 */
import type { Principal } from '@/services/authz';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(async () => ({ token: 'pat-1' })),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, leadBriefSchema, trustRuleSchema } = await import('@/models/Schema');
const { executeAction, proposeAction, rejectAction } = await import('@/services/ActionService');
const { personalizationEnrollAction } = await import('./personalization-enroll');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_enroll';
const CONTACT = 'contacts:9412';

function agent(): Principal {
  return { kind: 'agent', id: 'agent:revenue-lead', grants: ['*'], autonomy: 2, scope: { orgId: ORG } };
}

function enrollInput(over: Record<string, unknown> = {}) {
  return {
    leadBriefId: 1,
    contactRef: CONTACT,
    contactName: 'Dana Whitfield',
    companyName: 'Northbeam Health',
    sequenceId: 'seq-311',
    sequenceName: 'AI-Readiness Nurture',
    senderEmail: 'chris@metacto.com',
    hubspotUserId: '77',
    sends: [
      { step: 1, day: 0, subject: 'Your platform hires', body: 'Dana, saw the hires.' },
      { step: 2, day: 4, subject: 'One level deeper', body: 'The switching-costs section.' },
    ],
    ...over,
  };
}

async function seedLead() {
  await db.insert(leadBriefSchema).values({
    orgId: ORG,
    contactRef: CONTACT,
    contactName: 'Dana Whitfield',
    companyName: 'Northbeam Health',
    triggerType: 'new',
    status: 'ready_for_review',
    sections: [{ heading: 'Prospect', body: 'Dana runs platform engineering.' }],
    confidence: 0.84,
  });
}

function res(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(leadBriefSchema);
  await db.delete(trustRuleSchema);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(leadBriefSchema);
  await db.delete(trustRuleSchema);
});

describe('personalization.enroll proposal', () => {
  it('back-links the pending run onto the lead, and dedups on the contact', async () => {
    await seedLead();

    const first = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
      proposal: { confidence: 0.84, rationale: 'existing nurture fits' },
    });

    expect(first.status).toBe('pending');

    const [lead] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, CONTACT));

    expect(lead?.reviewActionRunId).toBe(first.runId);

    // A re-fired sweep proposing the same contact UPDATES the pending item.
    const second = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput({ sends: [{ step: 1, subject: 'Rewritten', body: 'New angle.' }] }),
      proposal: { confidence: 0.9, rationale: 'rewritten' },
    });

    expect(second.runId).toBe(first.runId);

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(runs).toHaveLength(1);
    expect(runs[0]?.input).toMatchObject({ sends: [{ step: 1, subject: 'Rewritten', body: 'New angle.' }] });
  });

  it('is never auto-approved, even by an enabled trust rule above the threshold', async () => {
    await seedLead();
    await db.insert(trustRuleSchema).values({
      orgId: ORG,
      actionId: 'personalization.enroll',
      threshold: 0.5,
      enabled: 'true',
    });

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
      proposal: { confidence: 0.99, rationale: 'very confident' },
    });

    expect(proposed.status).toBe('pending');

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.status).toBe('pending');
  });
});

describe('edit-then-approve on the sends', () => {
  it('maps content edits onto the matching send and leaves the rest alone', () => {
    const input = personalizationEnrollAction.inputSchema.parse(enrollInput());

    const edited = personalizationEnrollAction.applyContentEdits!(input, [
      { id: 'send-2', body: 'Edited by the reviewer.' },
      { id: 'send-9', body: 'No such send.' },
    ]);

    expect(edited.sends[0]).toMatchObject({ subject: 'Your platform hires', body: 'Dana, saw the hires.' });
    expect(edited.sends[1]).toMatchObject({ subject: 'One level deeper', body: 'Edited by the reviewer.', day: 4 });
  });
});

describe('Enroll (approve → execute)', () => {
  it('enrolls into the existing sequence, stages the approved copy, and moves the lane to handed_off', async () => {
    await seedLead();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      if (String(url).includes('/enrollments')) {
        return res({ id: 'enr-1' });
      }
      return res({ id: 'note-1' });
    }));

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
      proposal: { confidence: 0.84 },
    });

    expect(proposed.status).toBe('pending');

    const executed = await executeAction(proposed.runId!, ORG, { reviewedBy: 'user_jamie' });

    expect(executed.status).toBe('done');
    expect(executed.result).toMatchObject({ enrolled: true, enrollmentId: 'enr-1', sendsStagedAsNote: true, noteId: 'note-1' });

    // The enrollment call carried ONLY the existing sequence + contact + sender.
    const enrollCall = calls.find(c => c.url.includes('/enrollments'));

    expect(enrollCall?.body).toEqual({ sequenceId: 'seq-311', contactId: '9412', senderEmail: 'chris@metacto.com' });

    // The staged note carries the approved sends for the sender.
    const noteCall = calls.find(c => c.url.includes('/objects/notes'));

    expect(String((noteCall?.body.properties as { hs_note_body?: string })?.hs_note_body)).toContain('Dana, saw the hires.');

    const [lead] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, CONTACT));

    expect(lead?.status).toBe('handed_off');
    expect(lead?.decidedBy).toBe('user_jamie');
    expect(lead?.draftSequence).toHaveLength(2);
  });

  it('a failed enrollment fails the run and never moves the lane', async () => {
    await seedLead();
    vi.stubGlobal('fetch', vi.fn(async () => res({ message: 'no seat' }, false, 403)));

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    const executed = await executeAction(proposed.runId!, ORG);

    expect(executed.status).toBe('failed');

    const [lead] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, CONTACT));

    expect(lead?.status).toBe('ready_for_review');
  });
});

describe('Decline (reject)', () => {
  it('moves the lane to held and stamps who declined', async () => {
    await seedLead();

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    await rejectAction(proposed.runId!, ORG, 'wrong angle for this lead', { reviewedBy: 'user_jamie' });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(run?.status).toBe('rejected');
    expect(run?.error).toBe('wrong angle for this lead');

    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, ORG), eq(leadBriefSchema.contactRef, CONTACT)));

    expect(lead?.status).toBe('held');
    expect(lead?.decidedBy).toBe('user_jamie');
  });
});
