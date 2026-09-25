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
const { actionRunSchema, eventLogSchema, knowledgeSourceSchema, leadBriefSchema, trustRuleSchema } = await import('@/models/Schema');
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

describe('the voice gate judges only the sends that changed', () => {
  const BANNED = 'I wanted to reach out about the hires.';

  async function pendingCardWith(sends: Array<{ step: number; day: number; subject: string; body: string }>): Promise<number> {
    // Written straight to the table: this is a card that got in before the
    // gate existed, which is exactly the card the gate must not hold hostage.
    const [row] = await db
      .insert(actionRunSchema)
      .values({
        orgId: ORG,
        actionId: 'personalization.enroll',
        status: 'pending',
        invokedBy: 'agent:revenue-lead',
        dedupKey: `personalization.enroll:${CONTACT}`,
        input: enrollInput({ sends }),
        proposal: {},
      })
      .returning({ id: actionRunSchema.id });
    return row!.id;
  }

  it('refuses a brand-new card that carries a banned phrase in any send', async () => {
    await seedLead();

    await expect(proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput({ sends: [
        { step: 1, day: 0, subject: 'Your platform hires', body: BANNED },
        { step: 2, day: 4, subject: 'One level deeper', body: 'The switching-costs section.' },
      ] }),
    })).rejects.toThrow(/body of send 1/);
  });

  it('lets a clean rewrite of one send through when the untouched sends still carry old violations', async () => {
    await seedLead();
    const runId = await pendingCardWith([
      { step: 1, day: 0, subject: 'Your platform hires', body: BANNED },
      { step: 2, day: 4, subject: 'One level deeper', body: 'The switching-costs section.' },
    ]);

    // The scoped regenerate's save: send 1 verbatim, send 2 rewritten clean.
    const refreshed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput({ sends: [
        { step: 1, day: 0, subject: 'Your platform hires', body: BANNED },
        { step: 2, day: 4, subject: 'One level deeper', body: 'The switching-costs section, with the number.' },
      ] }),
    });

    expect(refreshed).toMatchObject({ runId, status: 'pending', outcome: 'refreshed' });
  });

  it('still refuses the send that changed when the change itself violates, and names only that send', async () => {
    await seedLead();
    await pendingCardWith([
      { step: 1, day: 0, subject: 'Your platform hires', body: BANNED },
      { step: 2, day: 4, subject: 'One level deeper', body: 'The switching-costs section.' },
    ]);

    const attempt = proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput({ sends: [
        { step: 1, day: 0, subject: 'Your platform hires', body: BANNED },
        { step: 2, day: 4, subject: 'One level deeper', body: `${BANNED} Again.` },
      ] }),
    });

    await expect(attempt).rejects.toThrow(/body of send 2/);
    await expect(attempt).rejects.not.toThrow(/send 1/);
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

    // The fast path never touches the research pipeline: no reset, no
    // personalization event. (An `artifact.saved` announcement for the brief
    // artifact is not the pipeline — it is the artifact log's own signal.)
    expect((await db.select().from(eventLogSchema)).filter(e => !e.type.startsWith('artifact.'))).toHaveLength(0);
  });

  it('a scoped regenerate rewrites the named send and leaves the others byte-identical', async () => {
    // The live defect (Chris, 2026-09-20): "I approved emails 1-3 and then
    // regenerated the 4th one and it regenerated all emails." A check is a
    // hash of the copy it was given for, so rewriting a send a reviewer
    // already approved silently takes that approval back.
    await seedLead();
    mapped();
    const four = enrollInput({
      sends: [
        { step: 1, day: 0, subject: 'Your platform hires', body: 'Dana, saw the hires.' },
        { step: 2, day: 4, subject: 'One level deeper', body: 'The switching-costs section.' },
        { step: 3, day: 8, subject: 'A short note', body: 'Apologies for the nudge.' },
        { step: 4, day: 12, subject: 'Closing the loop', body: 'Last one from me.' },
      ],
    });
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: four,
    });
    // The scoped turn can only answer with ONE send — the shape carries no
    // room for the others, which is what makes this structural.
    vi.mocked(runSkillTurn).mockResolvedValue({
      output: { needsResearch: false, reason: 'dropped the apology', send: { subject: 'Closing the loop', body: 'Worth twenty minutes next week?' } },
      toolCalls: 0,
      durationMs: 700,
    });

    await personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      four as never,
      proposed.runId!,
      'drop the apology and ask for the meeting',
      { contentId: 'send-4' },
    );

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const sends = (runs[0]!.input as { sends: Array<{ step: number; day?: number; subject: string; body: string }> }).sends;

    // Send 4 carries the redraft.
    expect(sends[3]).toMatchObject({ step: 4, day: 12, subject: 'Closing the loop', body: 'Worth twenty minutes next week?' });
    // And 1 through 3 are exactly what they were — the same objects a
    // reviewer's checks were computed over, so the checks still stand.
    expect(sends.slice(0, 3)).toEqual(four.sends.slice(0, 3));

    // Said the way the screen says it, because "byte-identical" is only the
    // mechanism: a check is a hash of the copy it was given for, so this is
    // the assertion that the three approvals a reviewer earned survived the
    // fourth send being redrafted.
    const { contentHash } = await import('@/libs/actions/contentHash');
    const stillChecked = four.sends.slice(0, 3).every(
      before => sends.some(after => contentHash(after.subject, after.body) === contentHash(before.subject, before.body)),
    );

    expect(stillChecked).toBe(true);
    // And send 4's check is gone, which is correct: its copy changed.
    expect(contentHash(sends[3]!.subject, sends[3]!.body)).not.toBe(contentHash(four.sends[3]!.subject, four.sends[3]!.body));
  });

  it('a scoped regenerate is never offered the sequence library, because it cannot change the sequence', async () => {
    await seedLead();
    mapped();
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    vi.mocked(runSkillTurn).mockResolvedValue({
      output: { needsResearch: false, send: { subject: 'One level deeper', body: 'Shorter.' } },
      toolCalls: 0,
      durationMs: 400,
    });

    await personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      proposed.runId!,
      'shorter',
      { contentId: 'send-2' },
    );

    // A tool whose answer has nowhere to land is a HubSpot round trip for
    // nothing, and an invitation to change something this turn must not.
    expect(vi.mocked(runSkillTurn).mock.calls[0]![0].toolAllowlist).toEqual(['get_lead_brief']);

    // The recommendation and sender ride through from the input untouched.
    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(runs[0]!.input).toMatchObject({ sequenceId: 'seq-311', sequenceName: 'AI-Readiness Nurture', senderEmail: 'chris@metacto.com' });
  });

  it('a contentId naming no send falls back to the whole draft rather than doing nothing', async () => {
    // A stale card, an unknown id: redrafting everything is the old behaviour
    // and it is safe. Silently skipping the regeneration would not be.
    await seedLead();
    mapped();
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'personalization.enroll',
      principal: agent(),
      input: enrollInput(),
    });
    vi.mocked(runSkillTurn).mockResolvedValue({
      output: {
        needsResearch: false,
        reason: 'redrafted',
        sends: [
          { day: 0, subject: 'Rewritten one', body: 'One.' },
          { day: 4, subject: 'Rewritten two', body: 'Two.' },
        ],
        recommendedSequence: { id: 'seq-311', name: 'AI-Readiness Nurture' },
        senderEmail: 'chris@metacto.com',
        hubspotUserId: '77',
      },
      toolCalls: 0,
      durationMs: 800,
    });

    await personalizationEnrollAction.regenerate!(
      { orgId: ORG, reviewedBy: 'user_jamie' },
      enrollInput() as never,
      proposed.runId!,
      'redo it',
      { contentId: 'send-99' },
    );

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect((runs[0]!.input as { sends: Array<{ subject: string }> }).sends.map(s => s.subject)).toEqual(['Rewritten one', 'Rewritten two']);
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

    // `artifact.*` is filtered out the way the draft test above already
    // does it: an artifact save from an earlier case emits without being
    // awaited, so whether it has landed by now is a matter of scheduling and
    // not of this behaviour.
    const events = (await db.select().from(eventLogSchema).where(eq(eventLogSchema.orgId, ORG)))
      .filter(e => !e.type.startsWith('artifact.'));

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

describe('the sender is workspace config, not a model output', () => {
  const OWNERS = { results: [{ id: '159535048', userId: '159535048', email: 'andrew@metacto.com' }] };

  async function nameTheSender(defaultSender: string) {
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot-contacts', kind: 'plugin', configJson: { _connector: 'hubspot', defaultSender } });
  }

  afterEach(async () => {
    await db.delete(knowledgeSourceSchema);
  });

  it('enrolls as the configured sender even when the card carries someone else, and says whose card it was', async () => {
    await seedLead();
    await nameTheSender('andrew@metacto.com');
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      if (String(url).includes('/crm/v3/owners')) {
        return res(OWNERS);
      }
      return res({ id: String(url).includes('/enrollments') ? 'enr-2' : 'note-2' });
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput({ senderEmail: 'chris@metacto.com', hubspotUserId: '66571096' }) });
    const executed = await executeAction(proposed.runId!, ORG, { reviewedBy: 'user_jamie' });

    expect(executed.status).toBe('done');
    expect(executed.result).toMatchObject({ enrolled: true, senderEmail: 'andrew@metacto.com', cardSenderEmail: 'chris@metacto.com' });

    const enrollCall = calls.find(c => c.url.includes('/enrollments'));

    expect(enrollCall?.url).toContain('userId=159535048');
    expect(enrollCall?.body).toMatchObject({ senderEmail: 'andrew@metacto.com' });
  });

  it('a configured sender the portal cannot resolve stops the enrollment; the card\'s sender is never used instead', async () => {
    await seedLead();
    await nameTheSender('nobody@metacto.com');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/crm/v3/owners')) {
        return res({ results: [] });
      }
      return res({ id: 'enr-3' });
    }));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput() });
    const executed = await executeAction(proposed.runId!, ORG, { reviewedBy: 'user_jamie' });

    expect(executed.status).toBe('failed');
    expect(String(executed.error)).toContain('nobody@metacto.com');
    expect(calls.some(u => u.includes('/enrollments'))).toBe(false);
  });

  it('the card shows the sender the emails go out as, and names the card\'s own when it differs', async () => {
    await seedLead();
    await nameTheSender('andrew@metacto.com');
    const card = await personalizationEnrollAction.reviewCard!({ orgId: ORG }, enrollInput({ senderEmail: 'chris@metacto.com' }) as never);

    expect(card.provenance).toContainEqual({ label: 'Sender', value: 'andrew@metacto.com (the card named chris@metacto.com)' });
  });

  it('with no configured sender the card\'s sender still enrolls, as before', async () => {
    await seedLead();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => res({ id: String(url).includes('/enrollments') ? 'enr-4' : 'note-4' })));

    const proposed = await proposeAction({ orgId: ORG, actionId: 'personalization.enroll', principal: agent(), input: enrollInput() });
    const executed = await executeAction(proposed.runId!, ORG, { reviewedBy: 'user_jamie' });

    expect(executed.result).toMatchObject({ enrolled: true, senderEmail: 'chris@metacto.com', cardSenderEmail: null });
  });
});
