/**
 * The three artifacts, and the decision that pins them.
 * `docs/specs/personalization-v2.md`, P1.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { leadArtifacts, pinDecisionArtifacts, recommendationMarkdown, sequenceSpecFor, syncLeadArtifacts } = await import('./artifacts');
const { listArtifactVersions } = await import('@/services/ArtifactService');
const { computeConfidenceDimensions } = await import('./confidence');
const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_lead_artifacts';
const AGENT = { kind: 'agent' as const, id: 'agent:revenue-lead' };

const lead = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  contactName: 'Dana Reyes',
  contactTitle: 'Director of Operations',
  companyName: 'Kestrel Capital',
  sections: [
    { heading: 'Prospect', body: 'Director of Operations at Kestrel Capital.' },
    { heading: 'Recommended Angle', body: 'Ask an honest question about reporting.' },
  ],
  claims: [{ text: 'Director of Operations.', kind: 'company', source: 'hubspot:contacts/88301' }],
  missing: ['The company website could not be retrieved.'],
  dimensions: computeConfidenceDimensions({
    contactName: 'Dana Reyes',
    contactTitle: 'Director of Operations',
    companyName: 'Kestrel Capital',
    entranceSource: 'PAID_SOCIAL',
    utmCampaign: 'ops-ebook',
    mqlAt: '2026-09-01T00:00:00.000Z',
    claims: [{ kind: 'company', source: 'hubspot:contacts/88301' }],
  }),
  draftSequence: [
    { step: 1, day: 0, subject: 'A question', body: 'How are you handling reporting today?' },
    { step: 2, day: 4, subject: 'Following up', body: 'Circling back once.' },
  ],
  recommendedSequence: { id: 'seq-nurture', name: 'Personalized Nurture', reason: 'Low-pressure curiosity.' },
  currentSequence: { id: 'seq-auto', name: 'MQL Auto-Nurture', status: 'active', kind: 'automated' },
  ...over,
});

describe('syncLeadArtifacts', () => {
  it('writes three artifacts on one record — brief, recommendation, draft sequence', async () => {
    const synced = await syncLeadArtifacts(ORG, lead(901), { author: AGENT, changeSummary: 'First pass' });

    expect(synced.map(s => s.role)).toEqual(['brief', 'recommendation', 'sequence']);
    expect(synced.map(s => s.kind)).toEqual(['markdown', 'markdown', 'sequence']);
    expect(synced.every(s => s.created)).toBe(true);

    const refs = await leadArtifacts(ORG, 901);

    expect(refs.map(r => r.role)).toEqual(['brief', 'recommendation', 'sequence']);
    expect(refs[0]!.ref).toMatchObject({ type: 'artifact', href: `/dashboard/artifacts/${refs[0]!.id}` });
  });

  it('a sync that changes nothing writes no version — the menu is not filled with non-changes', async () => {
    await syncLeadArtifacts(ORG, lead(902), { author: AGENT });
    const again = await syncLeadArtifacts(ORG, lead(902), { author: AGENT });

    expect(again.every(s => s.unchanged)).toBe(true);

    const [brief] = await leadArtifacts(ORG, 902);

    expect(brief!.version).toBe(1);
  });

  it('regeneration is a NEW VERSION with the instruction as its change summary, never a silent overwrite', async () => {
    await syncLeadArtifacts(ORG, lead(903), { author: AGENT, changeSummary: 'First pass' });
    const note = 'the angle leans on an industry pattern rather than anything about this company';
    const after = await syncLeadArtifacts(
      ORG,
      lead(903, { sections: [{ heading: 'Recommended Angle', body: 'Name the reporting problem they described.' }] }),
      { author: AGENT, changeSummary: `Regenerated: ${note}` },
      ['brief'],
    );

    expect(after).toHaveLength(1);
    expect(after[0]!.version).toBe(2);

    const versions = await listArtifactVersions({ orgId: ORG, artifactId: after[0]!.id });

    expect(versions.map(v => v.version)).toEqual([2, 1]);
    expect(versions[0]!.changeSummary).toContain(note);
    // v1 is still readable — the overwrite that was never silent.
    expect(JSON.stringify(versions[1]!.spec)).toContain('honest question');
  });

  it('one artifact per (record, role) — a second sync never forks the brief', async () => {
    await syncLeadArtifacts(ORG, lead(904), { author: AGENT });
    await syncLeadArtifacts(ORG, lead(904, { contactName: 'Dana Reyes' }), { author: AGENT, changeSummary: 'again' });
    const refs = await leadArtifacts(ORG, 904);

    expect(refs.filter(r => r.role === 'brief')).toHaveLength(1);
  });
});

describe('the recommendation artifact', () => {
  it('states the transaction — what approving will do — not just what is recommended', () => {
    const md = recommendationMarkdown(lead(905));

    expect(md).toContain('## Approving will');
    expect(md).toContain('Unenroll from MQL Auto-Nurture and enroll in Personalized Nurture.');
    expect(md).toContain('## Current state');
  });

  it('says it is held, and why, when the sequence state cannot be resolved', () => {
    const md = recommendationMarkdown(lead(906, { currentSequence: { name: 'Inbound Follow-up', status: 'active', kind: 'manual' } }));

    expect(md).toContain('Nothing — held.');
    expect(md).toContain('replaces it or runs alongside it');
  });

  it('carries the posture the dimensions justify, so the brief and the recommendation cannot disagree', () => {
    expect(recommendationMarkdown(lead(907))).toContain('fabricate personalization');
  });
});

describe('sequenceSpecFor', () => {
  it('is typed, not prose — the sends keep their step, cadence, subject and body', () => {
    const spec = sequenceSpecFor(lead(908));

    expect(spec.sequenceName).toBe('Personalized Nurture');
    expect(spec.sends).toHaveLength(2);
    expect(spec.sends[1]).toEqual({ step: 2, day: 4, subject: 'Following up', body: 'Circling back once.' });
  });
});

describe('pinDecisionArtifacts', () => {
  it('records the exact versions the human approved, and a later regeneration does not move them', async () => {
    await syncLeadArtifacts(ORG, lead(909), { author: AGENT });
    const [run] = await db.insert(actionRunSchema).values({
      orgId: ORG,
      actionId: 'personalization.enroll',
      status: 'pending',
      input: {},
    }).returning({ id: actionRunSchema.id });

    const pinned = await pinDecisionArtifacts(ORG, run!.id, await leadArtifacts(ORG, 909));

    expect(pinned.map(p => [p.role, p.version])).toEqual([['brief', 1], ['recommendation', 1], ['sequence', 1]]);

    // The brief moves on. The pin does not.
    await syncLeadArtifacts(
      ORG,
      lead(909, { sections: [{ heading: 'Recommended Angle', body: 'Something else entirely.' }] }),
      { author: AGENT, changeSummary: 'Regenerated' },
      ['brief'],
    );

    const [after] = await db
      .select({ pinnedArtifacts: actionRunSchema.pinnedArtifacts })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.id, run!.id)));

    expect(after!.pinnedArtifacts!.find(p => p.role === 'brief')!.version).toBe(1);
    expect((await leadArtifacts(ORG, 909)).find(r => r.role === 'brief')!.version).toBe(2);
  });
});
