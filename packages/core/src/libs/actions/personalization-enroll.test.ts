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

// The action-type → skill mapping is workspace config; null (the default in
// these tests) means no fast path, so the pre-existing fallback tests keep
// exercising the reset + event path unchanged.
vi.mock('./regenerateSkill', () => ({
  regenerateSkillFor: vi.fn(async () => null),
}));

// The scoped turn itself is skillTurn.test.ts's contract; here only how the
// tiered handler routes on its output.
vi.mock('@/services/agents/skillTurn', () => ({
  runSkillTurn: vi.fn(),
}));

// The workflow bridge has its own unit tests (unenrollBridge.test.ts); here
// only how execute routes on its answers. Default: not enrolled, so the
// pre-existing enroll tests run unchanged.
vi.mock('@/libs/hubspot/unenrollBridge', () => ({
  readSequenceEnrollmentState: vi.fn(async () => ({ ok: true, data: { enrolled: false, latestSequenceId: null } })),
  requestUnenroll: vi.fn(async () => ({ ok: true, data: { unenrolled: true, waitedMs: 100 } })),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, eventLogSchema, leadBriefSchema, trustRuleSchema } = await import('@/models/Schema');
const { executeAction, proposeAction, rejectAction } = await import('@/services/ActionService');
const { regenerateSkillFor } = await import('./regenerateSkill');
const { readSequenceEnrollmentState, requestUnenroll } = await import('@/libs/hubspot/unenrollBridge');
const { runSkillTurn } = await import('@/services/agents/skillTurn');
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
  vi.mocked(regenerateSkillFor).mockResolvedValue(null);
  vi.mocked(runSkillTurn).mockReset();
  vi.mocked(readSequenceEnrollmentState).mockReset().mockResolvedValue({ ok: true, data: { enrolled: false, latestSequenceId: null } });
  vi.mocked(requestUnenroll).mockReset().mockResolvedValue({ ok: true, data: { unenrolled: true, waitedMs: 100 } });
  await db.delete(actionRunSchema);
  await db.delete(leadBriefSchema);
  await db.delete(trustRuleSchema);
  await db.delete(eventLogSchema);
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
      proposal: { confidence: 0.84, rationale: 'existing nurture fits', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded enrolment proposal for this test.' },
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
      proposal: { confidence: 0.9, rationale: 'rewritten', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded enrolment proposal for this test.' },
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
      proposal: { confidence: 0.99, rationale: 'very confident', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded enrolment proposal for this test.' },
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
      proposal: { confidence: 0.84, suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded enrolment proposal for this test.' },
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
    expect(executed.error).toContain('403');

    const [lead] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, CONTACT));

    expect(lead?.status).toBe('ready_for_review');
  });

  it('a contact already in a sequence is unenrolled FIRST, then enrolled, and the result names what was replaced', async () => {
    await seedLead();
    vi.mocked(readSequenceEnrollmentState).mockResolvedValue({ ok: true, data: { enrolled: true, latestSequenceId: '307395867' } });
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if (String(url).includes('/enrollments/contact/')) {
        return res({ id: 'enr-old', sequenceId: '307395867', sequenceName: 'New Operational AI Inbound Sequence' });
      }
      if (String(url).includes('/enrollments')) {
        return res({ id: 'enr-2' });
      }
      return res({ id: 'note-1' });
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput() });
    const executed = await executeAction(proposed.runId!, ORG, { reviewedBy: 'user_jamie' });

    expect(executed.status).toBe('done');
    expect(executed.result).toMatchObject({
      enrolled: true,
      replacedSequence: { sequenceId: '307395867', sequenceName: 'New Operational AI Inbound Sequence' },
    });
    expect(vi.mocked(requestUnenroll)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contactId: '9412' }));
  });

  it('an unenroll that does not complete stops the enrollment: run failed, nothing enrolled', async () => {
    await seedLead();
    vi.mocked(readSequenceEnrollmentState).mockResolvedValue({ ok: true, data: { enrolled: true, latestSequenceId: '307395867' } });
    vi.mocked(requestUnenroll).mockResolvedValue({ ok: false, error: 'hubspot_error', status: 408, message: 'still enrolled after 180s' });
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posts.push(String(url));
      }
      if (String(url).includes('/enrollments/contact/')) {
        return res({ sequenceId: '307395867', sequenceName: 'New Operational AI Inbound Sequence' });
      }
      return res({});
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput() });
    const executed = await executeAction(proposed.runId!, ORG);

    expect(executed.status).toBe('failed');
    expect(executed.error).toContain('New Operational AI Inbound Sequence');
    expect(posts.filter(u => u.includes('/enrollments') && !u.includes('/enrollments/contact/'))).toHaveLength(0);

    const [lead] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, CONTACT));

    expect(lead?.status).toBe('ready_for_review');
  });
});

describe('Enroll into a Personalized Nurture rung', () => {
  const RUNG = { sequenceId: 'seq-pn3', sequenceName: 'Personalized Nurture · 3 Steady' };
  const FOUR_SENDS = [1, 2, 3, 4].map(n => ({ step: n, subject: `Subject ${n}`, body: `Body ${n}` }));

  it('writes the approved sends into the contact\'s slots BEFORE enrolling, and says so in the result', async () => {
    await seedLead();
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      return res({ id: String(url).includes('/enrollments') ? 'enr-9' : 'ok' });
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput({ ...RUNG, sends: FOUR_SENDS }) });
    const executed = await executeAction(proposed.runId!, ORG, { reviewedBy: 'user_andrew' });

    expect(executed.status).toBe('done');
    expect(executed.result).toMatchObject({ enrolled: true, nurtureSlotsWritten: 4 });

    const patchIdx = calls.findIndex(c => c.method === 'PATCH' && c.url.includes('/crm/v3/objects/contacts/9412'));
    const enrollIdx = calls.findIndex(c => c.url.includes('/enrollments'));

    expect(patchIdx).toBeGreaterThanOrEqual(0);
    expect(patchIdx).toBeLessThan(enrollIdx);

    const props = calls[patchIdx]!.body.properties as Record<string, string>;

    expect(props).toMatchObject({ pn_email_1_subject: 'Subject 1', pn_email_1_body: '<p>Body 1</p>', pn_email_4_subject: 'Subject 4', pn_email_4_body: '<p>Body 4</p>' });
    expect(props.pn_generated_at).toMatch(/^\d{13}$/);
  });

  it('a failed slot write stops the enrollment: no enrollment call, the run fails, the lane stays', async () => {
    await seedLead();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'PATCH') {
        return res({ message: 'property pn_email_1_subject does not exist' }, false, 400);
      }
      return res({ id: 'x' });
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput({ ...RUNG, sends: FOUR_SENDS }) });
    const executed = await executeAction(proposed.runId!, ORG);

    expect(executed.status).toBe('failed');
    expect(calls.some(c => c.includes('/enrollments'))).toBe(false);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(run?.error).toContain('would send empty emails');

    const [lead] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, CONTACT));

    expect(lead?.status).toBe('ready_for_review');
  });

  it('a general sequence writes no slots', async () => {
    await seedLead();
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string }) => {
      methods.push(init?.method ?? 'GET');
      return res({ id: 'x' });
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput() });
    const executed = await executeAction(proposed.runId!, ORG);

    expect(executed.status).toBe('done');
    expect(executed.result).toMatchObject({ nurtureSlotsWritten: 0 });
    expect(methods).not.toContain('PATCH');
  });

  it('the card says the sends go onto the slots at Enroll for a rung, and nothing for a general sequence', async () => {
    await seedLead();
    const rung = await personalizationEnrollAction.reviewCard!({ orgId: ORG }, enrollInput({ ...RUNG, sends: FOUR_SENDS }) as never);
    const general = await personalizationEnrollAction.reviewCard!({ orgId: ORG }, enrollInput() as never);

    expect(rung.fields).toEqual([{ label: 'On Enroll', value: expect.stringContaining('4 sends are written to the contact\'s nurture slots') }]);
    expect(general.fields).toEqual([]);
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

describe('Regenerate', () => {
  it('sends the linked brief back to queued with the feedback as its instruction, run left pending', async () => {
    await seedLead();

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });

    await personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      proposed.runId!,
      'lead with the compliance angle',
    );

    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, ORG), eq(leadBriefSchema.contactRef, CONTACT)));

    // Back in line for the next pass, carrying the instruction; the run link
    // is KEPT — the run is mid-regeneration, not gone, so the lead page keeps
    // its card and the redraft updates the same pending item in place.
    expect(lead?.status).toBe('queued');
    expect(lead?.regenerateNote).toBe('lead with the compliance angle');
    expect(lead?.reviewActionRunId).toBe(proposed.runId);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(run?.status).toBe('pending');
  });

  it('refuses a run no brief is linked to, so a stray card cannot reset another lead', async () => {
    await seedLead();

    await expect(personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      424242,
      'anything',
    )).rejects.toThrow(/no lead brief is linked/);
  });
});

describe('Regenerate, tiered (the fast path)', () => {
  const mapped = () => vi.mocked(regenerateSkillFor).mockResolvedValue('regenerate-sequence-copy');

  it('content feedback: the scoped turn\'s sends save through the same path, brief untouched, same run refreshed', async () => {
    await seedLead();
    mapped();
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    // Mid-regeneration, as the route leaves the row before dispatching.
    await db
      .update(actionRunSchema)
      .set({ regeneratingSince: new Date(), regenerateNote: 'send 2 is too pushy' })
      .where(eq(actionRunSchema.id, proposed.runId!));
    vi.mocked(runSkillTurn).mockResolvedValue({
      output: {
        needsResearch: false,
        reason: 'kept the rung, softened send 2',
        sends: [
          { day: 0, subject: 'Your platform hires', body: 'Dana, saw the hires.' },
          { day: 4, subject: 'A softer step', body: 'No rush on this.' },
        ],
        recommendedSequence: { id: 'seq-311', name: 'AI-Readiness Nurture', reason: 'kept' },
        senderEmail: 'chris@metacto.com',
        hubspotUserId: '77',
      },
      toolCalls: 0,
      durationMs: 900,
    });

    await personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      proposed.runId!,
      'send 2 is too pushy',
    );

    // The brief survives: sections, confidence, lane and the back-link all
    // exactly as they were — only the drafts moved.
    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, ORG), eq(leadBriefSchema.contactRef, CONTACT)));

    expect(lead?.status).toBe('ready_for_review');
    expect(lead?.sections).toEqual([{ heading: 'Prospect', body: 'Dana runs platform engineering.' }]);
    expect(lead?.confidence).toBe(0.84);
    expect(lead?.reviewActionRunId).toBe(proposed.runId);
    expect(lead?.draftSequence.map(s => s.subject)).toEqual(['Your platform hires', 'A softer step']);

    // The SAME run carries the new sends and the stamp is cleared — the
    // completion edge the card's poll re-enables on. No second card.
    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe(proposed.runId);
    expect(runs[0]!.status).toBe('pending');
    expect(runs[0]!.regeneratingSince).toBeNull();
    expect((runs[0]!.input as { sends: Array<{ subject: string }> }).sends.map(s => s.subject)).toEqual(['Your platform hires', 'A softer step']);

    // The fast path never touches the research pipeline: no reset, no event.
    expect(await db.select().from(eventLogSchema)).toHaveLength(0);
  });

  it('research feedback: needsResearch falls back to the reset + event path, keeping the back-link', async () => {
    await seedLead();
    mapped();
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    vi.mocked(runSkillTurn).mockResolvedValue({
      output: { needsResearch: true, reason: 'the note contradicts the brief\'s hiring claim' },
      toolCalls: 1,
      durationMs: 1200,
    });

    await personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      proposed.runId!,
      'they are not hiring engineers, that is wrong',
    );

    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, ORG), eq(leadBriefSchema.contactRef, CONTACT)));

    expect(lead?.status).toBe('queued');
    expect(lead?.sections).toEqual([]);
    expect(lead?.regenerateNote).toContain('they are not hiring engineers');
    expect(lead?.regenerateNote).toContain('contradicts the brief');
    expect(lead?.reviewActionRunId).toBe(proposed.runId);

    const events = await db.select().from(eventLogSchema).where(eq(eventLogSchema.orgId, ORG));

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('personalization.brief_regenerate_requested');
  });

  it('a fast-path failure propagates, so the route clears the stamp and the card re-enables', async () => {
    await seedLead();
    mapped();
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    vi.mocked(runSkillTurn).mockRejectedValue(new Error('model timeout'));

    await expect(personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      proposed.runId!,
      'shorter',
    )).rejects.toThrow('model timeout');

    // No half-work: the brief stayed intact and nothing was reset or emitted.
    const [lead] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, ORG), eq(leadBriefSchema.contactRef, CONTACT)));

    expect(lead?.status).toBe('ready_for_review');
    expect(await db.select().from(eventLogSchema)).toHaveLength(0);
  });
});

/**
 * The voice gate. `runSkillTurn`'s schema covers the regenerate path, but
 * that is one of several doors into the queue — the hourly drafting pass, the
 * write API and a replay all arrive through `proposeAction`. These cover the
 * door they share.
 */
describe('personalization.enroll voice gate', () => {
  /** The complaint, fixture-ised: register announcements, no real prospect. */
  const OFFENDING = 'Quick one on the build. Curious about something on the technical side. No pitch, just curious how that works day to day.';

  it('refuses a proposal whose sends carry a banned construction, and names each one', async () => {
    await seedLead();

    await expect(proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      input: enrollInput({
        sends: [
          { step: 1, day: 0, subject: 'Your platform hires', body: 'Dana, saw the hires.' },
          { step: 2, day: 4, subject: 'One level deeper', body: OFFENDING },
        ],
      }),
      principal: agent(),
      invokedBy: 'agent:revenue-lead',
    })).rejects.toThrow(/body of send 2: "Curious about" is banned/);
  });

  it('writes nothing when it refuses', async () => {
    await seedLead();

    await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      input: enrollInput({ sends: [{ step: 1, day: 0, subject: 'A', body: OFFENDING }] }),
      principal: agent(),
      invokedBy: 'agent:revenue-lead',
    }).catch(() => {});

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(runs).toHaveLength(0);
  });

  it('gates the subject as well as the body', async () => {
    await seedLead();

    await expect(proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      input: enrollInput({ sends: [{ step: 1, day: 0, subject: 'Quick question', body: 'Dana, saw the hires.' }] }),
      principal: agent(),
      invokedBy: 'agent:revenue-lead',
    })).rejects.toThrow(/subject of send 1: "Quick question" is banned/);
  });

  it('lets clean copy through', async () => {
    await seedLead();

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      input: enrollInput(),
      principal: agent(),
      invokedBy: 'agent:revenue-lead',
    });

    expect(proposed.status).toBe('pending');
  });
});
