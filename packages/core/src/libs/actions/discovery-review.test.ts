/**
 * discovery.review_proposal — the seam between detection (011) and the
 * follow-up mission, plus the safety invariant that no trust rule can cross
 * that seam without a human.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const startMissionMock = vi.fn(async () => ({ id: 4242, status: 'completed' }));
const getMissionMock = vi.fn(async () => ({ slug: 'discovery-followup', name: 'Discovery Follow-Up' }));
vi.mock('@/services/MissionService', () => ({
  startMission: startMissionMock,
  getMission: getMissionMock,
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, discoveryCandidateSchema, knowledgeDocumentSchema, knowledgeSourceSchema, trustRuleSchema } = await import('@/models/Schema');
const { discoveryReviewProposalAction } = await import('./discovery-review');
const { proposeAction, executeAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_disc_review';

/** Autonomy 1 → the proposal is gated into the review queue. */
function detector(): Principal {
  return { kind: 'agent', id: 'agent:discovery-detector', grants: ['review_proposal'], autonomy: 1, scope: { orgId: ORG } };
}

function proposalInput(over: Record<string, unknown> = {}) {
  return {
    candidateId: 7,
    meetingExternalId: 'zoom:abc',
    company: 'Acme',
    route: 'generate' as const,
    isDiscovery: true,
    proposalReady: true,
    ...over,
  };
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(discoveryCandidateSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(trustRuleSchema);
  startMissionMock.mockClear();
  getMissionMock.mockClear();
  getMissionMock.mockResolvedValue({ slug: 'discovery-followup', name: 'Discovery Follow-Up' } as never);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

describe('discovery.review_proposal handoff', () => {
  it('starts the follow-up mission naming the skills and the gated read on approval', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput(),
      proposal: { confidence: 0.92, rationale: 'clear discovery', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded discovery proposal for this test.' },
    });

    expect(proposed.status).toBe('pending');
    expect(startMissionMock).not.toHaveBeenCalled(); // nothing runs before a human

    const executedRun = await executeAction(proposed.runId!, ORG);

    expect(executedRun.status).toBe('done');
    expect(startMissionMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      missionSlug: 'discovery-followup',
      mode: 'check',
    }));

    const brief = (startMissionMock.mock.calls[0] as unknown as [{ brief: string }])[0].brief;

    // The brief carries the gated read + both skills by name.
    expect(brief).toContain('read_discovery_transcript');
    expect(brief).toContain('candidate_id 7');
    expect(brief).toContain('discovery-summary');
    expect(brief).toContain('draft-followup-email');

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.result).toMatchObject({ handoff: 'discovery-followup', missionRunId: 4242 });
  });

  it('a dropped candidate records the correction and starts nothing', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput({ route: 'drop', isDiscovery: false, proposalReady: false }),
      proposal: { confidence: 0.2, rationale: 'internal sync', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded discovery proposal for this test.' },
    });
    await executeAction(proposed.runId!, ORG);

    expect(startMissionMock).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.result).toMatchObject({ handoff: 'dropped' });
  });

  it('a missing mission fails the run rather than reading as a successful handoff', async () => {
    getMissionMock.mockResolvedValue(null as never);

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput(),
      proposal: { confidence: 0.9, rationale: 'clear', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded discovery proposal for this test.' },
    });
    const executedRun = await executeAction(proposed.runId!, ORG);

    expect(executedRun.status).toBe('failed');
    expect(startMissionMock).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.status).toBe('failed');
    expect(row?.error).toMatch(/discovery-followup/);
    // The human's decision is still on the row — the calibration signal survives.
    expect(row?.input).toMatchObject({ route: 'generate', isDiscovery: true });
  });

  /**
   * The invariant that used to be only a comment: approving this action now
   * starts real downstream work (a drafted email in the seller's voice), so an
   * enabled trust rule must NOT be able to release it. Supervised v1 also needs
   * the human decision as calibration data for 020.
   */
  it('is never auto-approved, even by an enabled trust rule above the threshold', async () => {
    await db.insert(trustRuleSchema).values({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      threshold: 0.5,
      enabled: 'true',
    });

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput(),
      proposal: { confidence: 0.99, rationale: 'very confident', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded discovery proposal for this test.' },
    });

    expect(proposed.status).toBe('pending');
    expect(startMissionMock).not.toHaveBeenCalled();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId!));

    expect(row?.status).toBe('pending');
  });
});

// ── The card a person decides on ────────────────────────────────────────────

/**
 * Seed one assessed candidate. `crm` null means CRM resolution produced
 * nothing — the case the card must NOT dress up as a company.
 * @param over - Candidate overrides.
 * @param crm - Metadata for the matched CRM document, or null for no document.
 */
async function seedCandidate(over: Record<string, unknown> = {}, crm: Record<string, unknown> | null = { company: 'Northwind Health', name: 'Project Ranger' }) {
  const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'zoom', kind: 'plugin' }).returning({ id: knowledgeSourceSchema.id });
  const [meeting] = await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId: source!.id,
    externalId: 'zoom:abc',
    title: 'Project Ranger – Follow Up',
    contentHash: 'h1',
    metadata: { kind: 'zoom-recording', attendees: ['dreyes@kestrelcapital.example', 'lead@acme.example'] },
  }).returning({ id: knowledgeDocumentSchema.id });
  if (crm) {
    await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      sourceId: source!.id,
      externalId: 'deals:1201',
      title: 'Project Ranger',
      contentHash: 'h2',
      metadata: { hubspotId: '1201', ...crm },
    });
  }
  const [candidate] = await db.insert(discoveryCandidateSchema).values({
    orgId: ORG,
    meetingExternalId: 'zoom:abc',
    meetingDocId: meeting!.id,
    meetingTitle: 'Project Ranger – Follow Up',
    meetingStart: new Date('2026-09-14T11:30:00.000Z'),
    matchType: 'hubspot-deal',
    matchRef: 'deals:1201',
    matchReason: 'Attendee matches HubSpot deal deals:1201',
    status: 'classified',
    route: 'drop',
    confidenceSemantics: 'stated-class',
    reasonCode: 'existing-opportunity',
    classification: {
      confidenceSemantics: 'stated-class',
      classification: 'not-discovery',
      classificationConfidence: 0.95,
      proposalReadiness: 'proposal-ready',
      proposalReadinessConfidence: 0.82,
      reasonCode: 'existing-opportunity',
      reasonCodeFallback: false,
      reasonSummary: 'Existing opportunity; diligence and bid preparation already underway.',
      reasoning: 'The bid is due tomorrow and technical diligence is underway.',
    },
    ...over,
  }).returning({ id: discoveryCandidateSchema.id });
  return candidate!.id;
}

const ctx = { orgId: ORG, invokedBy: 'test' } as never;

describe('the card names the object, not the run', () => {
  it('makes the meeting the H1, with what kind of record it is under it', async () => {
    const candidateId = await seedCandidate();

    const card = await discoveryReviewProposalAction.reviewCard!(ctx, proposalInput({ candidateId, route: 'drop' }) as never);

    // Was "Discovery call detected: <generated meeting-name string>" — an
    // internal identifier where the page's name belongs.
    expect(card.title).toBe('Project Ranger – Follow Up');
    expect(card.object).toEqual({
      title: 'Project Ranger – Follow Up',
      subtitle: 'Discovery assessment · Sep 14, 11:30 AM',
      section: 'Discovery',
    });
  });

  it('shows the several entities a meeting involves, not one field called Company', async () => {
    const candidateId = await seedCandidate();

    const card = await discoveryReviewProposalAction.reviewCard!(ctx, proposalInput({ candidateId, route: 'drop' }) as never);
    const labels = card.fields.map(f => f.label);

    expect(labels).toContain('Opportunity');
    expect(labels).toContain('Account');
    expect(labels).toContain('Attendees');
    expect(card.fields.find(f => f.label === 'Account')!.value).toBe('Northwind Health');
  });

  it('says the account is not resolved rather than labelling an email address "Company"', async () => {
    // The matched CRM document carries an email and no company name.
    const candidateId = await seedCandidate({}, { primaryEmail: 'dreyes@kestrelcapital.example' });

    const card = await discoveryReviewProposalAction.reviewCard!(ctx, proposalInput({ candidateId, route: 'drop' }) as never);
    const account = card.fields.find(f => f.label === 'Account')!;

    expect(account.value).toBe('Not resolved — dreyes@kestrelcapital.example');
    expect(labelsOf(card)).not.toContain('Company');
  });
});

/**
 * @param card - The card under test.
 * @param card.fields
 */
function labelsOf(card: { fields: Array<{ label: string }> }) {
  return card.fields.map(f => f.label);
}

describe('"Approving will" states the effect, not the scores', () => {
  it('names the transaction for a drop and mentions no percentage', async () => {
    const candidateId = await seedCandidate();

    const card = await discoveryReviewProposalAction.reviewCard!(ctx, proposalInput({ candidateId, route: 'drop' }) as never);

    expect(card.nextAction).toBe('Mark this assessment correct. No downstream workflow runs — Vocion classified this as existing opportunity.');
    expect(card.nextAction).not.toMatch(/%|0\.\d/);
  });

  it('names what gets created for a generate, and says nothing is sent', async () => {
    const candidateId = await seedCandidate({ route: 'generate' });

    const card = await discoveryReviewProposalAction.reviewCard!(ctx, proposalInput({ candidateId }) as never);

    expect(card.nextAction).toBe('Create a draft proposal from this meeting and add it to the review queue for your review. Nothing is sent.');
    expect(card.nextAction).not.toMatch(/%|0\.\d/);
  });

  it('gives the confidence meter the class it belongs to, so no bare score renders', async () => {
    const candidateId = await seedCandidate();

    const card = await discoveryReviewProposalAction.reviewCard!(ctx, proposalInput({ candidateId, route: 'drop' }) as never);

    expect(card.confidenceSubject).toBe('Not discovery');
  });
});

// An existing client's proposal review (2026-10-23): the classifier said `drop`, a person
// approved the item with route `generate`, and the ledger kept `drop`, so the
// gate refused the transcript. A person's approval is the route.
describe('a person\'s approval is the route', () => {
  async function seedDroppedCandidate() {
    const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'zoom', kind: 'plugin' }).returning({ id: knowledgeSourceSchema.id });
    const [meeting] = await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      sourceId: source!.id,
      externalId: 'zoom:abc',
      title: 'Northwind proposal review',
      contentHash: 'h1',
      metadata: { kind: 'zoom-recording', host: 'seller@vocion.example', hasTranscript: true },
    }).returning({ id: knowledgeDocumentSchema.id });
    const [candidate] = await db.insert(discoveryCandidateSchema).values({
      orgId: ORG,
      meetingExternalId: 'zoom:abc',
      meetingDocId: meeting!.id,
      meetingTitle: 'Northwind proposal review',
      matchType: 'hubspot-deal',
      status: 'classified',
      route: 'drop',
    }).returning({ id: discoveryCandidateSchema.id });
    return candidate!.id;
  }

  it('writes the approved route on the ledger, over the classifier\'s drop', async () => {
    const candidateId = await seedDroppedCandidate();
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput({ candidateId, route: 'generate' }),
      proposal: { confidence: 0.4, rationale: 'existing client', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded for this test.' },
    });
    await executeAction(proposed.runId!, ORG);
    const [row] = await db.select().from(discoveryCandidateSchema).where(eq(discoveryCandidateSchema.id, candidateId));

    expect(row?.route).toBe('generate');
    expect(row?.reviewActionRunId).toBe(proposed.runId);
  });

  it('releases the transcript to read_discovery_transcript once approved, and while the approval is still running', async () => {
    const candidateId = await seedDroppedCandidate();
    const { readDiscoveryTranscriptTool, transcriptReleased } = await import('@/services/agents/tools/discovery');
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: detector(),
      input: proposalInput({ candidateId, route: 'generate' }),
      proposal: { confidence: 0.4, rationale: 'existing client', suggestedDecision: 'approve', suggestedDecisionReason: 'Seeded for this test.' },
    });
    const read = readDiscoveryTranscriptTool({ orgId: ORG } as never);

    expect(JSON.parse(await read.invoke({ candidate_id: candidateId }) as string).error).toBe('not_approved');

    await executeAction(proposed.runId!, ORG);

    expect(JSON.parse(await read.invoke({ candidate_id: candidateId }) as string)).toMatchObject({ candidateId, transcript: '' });
    // The approval's own run reads `executing` while the follow-up it started asks for the transcript.
    expect(transcriptReleased({ route: 'drop', reviewStatus: 'executing', reviewRoute: 'generate' })).toBe(true);
    // The approved item's route wins over the ledger's, either way.
    expect(transcriptReleased({ route: 'generate', reviewStatus: 'done', reviewRoute: 'drop' })).toBe(false);
    expect(transcriptReleased({ route: 'confirm', reviewStatus: 'done', reviewRoute: null })).toBe(true);
    expect(transcriptReleased({ route: 'generate', reviewStatus: 'pending', reviewRoute: 'generate' })).toBe(false);
  });
});
