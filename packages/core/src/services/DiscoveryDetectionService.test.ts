import type { Classification } from '@/services/DiscoveryDetectionService';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// Deterministic classifier — the sweep test asserts exactly when it is (not) called.
const invokeMock = vi.fn();
vi.mock('@/libs/llm', () => ({
  buildChatModel: () => ({ invoke: invokeMock }),
  resolvedModelId: (role: string) => `mock-${role}`,
}));

const { db } = await import('@/libs/DB');
const {
  knowledgeSourceSchema,
  knowledgeDocumentSchema,
  knowledgeChunkSchema,
  discoveryCandidateSchema,
  actionRunSchema,
  userActivityEventSchema,
} = await import('@/models/Schema');
const svc = await import('@/services/DiscoveryDetectionService');

const ORG = 'org_disc';
const NOW = new Date('2026-08-17T18:00:00.000Z');
const EMBED = Array.from({ length: 1536 }, () => 0);

function classifierReturns(obj: Record<string, unknown>) {
  invokeMock.mockResolvedValue({ content: JSON.stringify(obj) });
}

async function seedSource(slug = 'zoom'): Promise<number> {
  const [s] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin' })
    .returning({ id: knowledgeSourceSchema.id });
  return s!.id;
}

async function seedDoc(
  sourceId: number,
  opts: { externalId: string; title?: string; metadata: Record<string, unknown>; ingestedAt?: Date },
): Promise<number> {
  const [d] = await db
    .insert(knowledgeDocumentSchema)
    .values({
      orgId: ORG,
      sourceId,
      externalId: opts.externalId,
      title: opts.title ?? null,
      metadata: opts.metadata,
      contentHash: opts.externalId,
      ingestedAt: opts.ingestedAt ?? new Date(NOW.getTime() - 3_600_000),
    })
    .returning({ id: knowledgeDocumentSchema.id });
  return d!.id;
}

async function seedChunk(documentId: number, content: string): Promise<void> {
  await db.insert(knowledgeChunkSchema).values({
    documentId,
    orgId: ORG,
    chunkIdx: 0,
    content,
    contentTokens: 16,
    embedding: EMBED,
  });
}

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(actionRunSchema);
  await db.delete(discoveryCandidateSchema);
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  invokeMock.mockReset();
});

afterAll(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(actionRunSchema);
  await db.delete(discoveryCandidateSchema);
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

// ── Stage 0 · filterEligible (pure) ──────────────────────────────────────────

describe('filterEligible', () => {
  const contact = (over: Record<string, unknown> = {}) => ({
    docId: 1,
    externalId: 'contacts:9',
    metadata: {
      objectType: 'contacts',
      hubspotId: '9',
      ownerId: 'chris',
      lifecycleStage: 'marketingqualifiedlead',
      primaryEmail: 'buyer@acme.com',
      ...over,
    },
  });

  it('keeps an owned, in-stage contact and extracts email + domain', () => {
    const out = svc.filterEligible([contact()], {
      ownerIds: ['chris'],
      lifecycleStages: ['marketingqualifiedlead'],
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ref: 'contacts:9', type: 'hubspot-contact' });
    expect(out[0]!.emails).toContain('buyer@acme.com');
    expect(out[0]!.domains).toContain('acme.com');
  });

  it('drops records owned by someone else', () => {
    const out = svc.filterEligible([contact({ ownerId: 'someone-else' })], { ownerIds: ['chris'] });

    expect(out).toHaveLength(0);
  });

  it('drops contacts not in an allowed lifecycle stage', () => {
    const out = svc.filterEligible([contact({ lifecycleStage: 'customer' })], {
      lifecycleStages: ['lead', 'marketingqualifiedlead'],
    });

    expect(out).toHaveLength(0);
  });

  it('ignores rows that are not HubSpot records', () => {
    const out = svc.filterEligible([{ docId: 2, externalId: 'x', metadata: { kind: 'zoom-recording' } }], {});

    expect(out).toHaveLength(0);
  });

  it('never exposes a free-email domain as an eligible match-domain', () => {
    const out = svc.filterEligible([contact({ primaryEmail: 'founder@gmail.com' })], {});

    expect(out[0]!.emails).toContain('founder@gmail.com'); // exact match still works
    expect(out[0]!.domains).not.toContain('gmail.com'); // but gmail.com never domain-matches
  });

  it('takes a company domain when no email is present, typed hubspot-company', () => {
    const out = svc.filterEligible(
      [{ docId: 3, externalId: 'companies:5', metadata: { objectType: 'companies', hubspotId: '5', domain: 'Acme.com' } }],
      {},
    );

    expect(out[0]!.domains).toContain('acme.com');
    expect(out[0]!.type).toBe('hubspot-company'); // not 'hubspot-companie'
  });
});

// ── Stage 1 · matchMeeting (pure, metadata only) ─────────────────────────────

describe('matchMeeting', () => {
  const eligible = [{ ref: 'contacts:9', type: 'hubspot-contact' as const, emails: ['buyer@acme.com'], domains: ['acme.com'] }];
  const base = {
    docId: 10,
    externalId: 'zoom:abc',
    sourceSlug: 'zoom',
    title: 'Intro call',
    host: 'chris@metacto.com',
    start: NOW,
    hasTranscript: true,
  };

  it('matches on an exact attendee email', () => {
    const m = svc.matchMeeting({ ...base, attendees: ['chris@metacto.com', 'buyer@acme.com'] }, eligible, { sellerDomain: 'metacto.com' });

    expect(m).toMatchObject({ matchType: 'hubspot-contact', matchRef: 'contacts:9' });
  });

  it('matches on attendee company domain', () => {
    const m = svc.matchMeeting({ ...base, attendees: ['chris@metacto.com', 'other@acme.com'] }, eligible, { sellerDomain: 'metacto.com' });

    expect(m?.matchType).toBe('hubspot-contact');
    expect(m?.matchReason).toContain('acme.com');
  });

  it('falls back to calendly-external for a seller-hosted call with an unknown external guest', () => {
    const m = svc.matchMeeting({ ...base, attendees: ['chris@metacto.com', 'ceo@newprospect.io'] }, [], { sellerDomain: 'metacto.com' });

    expect(m).toMatchObject({ matchType: 'calendly-external', matchRef: 'newprospect.io' });
  });

  it('returns null for a fully-internal meeting (privacy: never read)', () => {
    const m = svc.matchMeeting({ ...base, attendees: ['chris@metacto.com', 'andrew@metacto.com'] }, eligible, { sellerDomain: 'metacto.com' });

    expect(m).toBeNull();
  });

  it('returns null when the seller is not the host and nobody eligible is present', () => {
    const m = svc.matchMeeting(
      { ...base, host: 'external@vendor.com', attendees: ['external@vendor.com', 'chris@metacto.com'] },
      eligible,
      { sellerDomain: 'metacto.com' },
    );

    expect(m).toBeNull();
  });

  it('never matches a fully-internal call, even if an employee is in the CRM (seller domain excluded)', () => {
    const internalParty = [{ ref: 'contacts:1', type: 'hubspot-contact' as const, emails: [], domains: ['metacto.com'] }];
    const m = svc.matchMeeting(
      { ...base, attendees: ['chris@metacto.com', 'andrew@metacto.com'] },
      internalParty,
      { sellerDomain: 'metacto.com' },
    );

    expect(m).toBeNull();
  });

  it('suppresses the calendly-external fallback when disabled', () => {
    const m = svc.matchMeeting(
      { ...base, attendees: ['chris@metacto.com', 'ceo@newprospect.io'] },
      [],
      { sellerDomain: 'metacto.com', allowCalendlyExternal: false },
    );

    expect(m).toBeNull();
  });
});

// ── Stage 3 · routeClassification (pure) ─────────────────────────────────────

describe('routeClassification', () => {
  const t = { discoveryThreshold: 0.6, readyThreshold: 0.7 };
  const c = (over: Partial<Classification>): Classification => ({
    isDiscovery: true,
    isDiscoveryConfidence: 0.9,
    proposalReady: true,
    proposalReadyConfidence: 0.9,
    reasoning: '',
    ...over,
  });

  it('generates for a confident discovery call that is ready', () => {
    expect(svc.routeClassification(c({}), t)).toBe('generate');
  });

  it('confirms a discovery call that is not confidently ready', () => {
    expect(svc.routeClassification(c({ proposalReady: false, proposalReadyConfidence: 0.2 }), t)).toBe('confirm');
  });

  it('drops when it is not a discovery call', () => {
    expect(svc.routeClassification(c({ isDiscovery: false }), t)).toBe('drop');
  });

  it('drops when discovery confidence is below threshold', () => {
    expect(svc.routeClassification(c({ isDiscoveryConfidence: 0.4 }), t)).toBe('drop');
  });
});

// ── Stage 2 · the content gate ───────────────────────────────────────────────

describe('readMatchedTranscript (content gate)', () => {
  it('refuses to read a transcript with no matching candidate on record', async () => {
    const src = await seedSource('zoom');
    const doc = await seedDoc(src, { externalId: 'zoom:unmatched', metadata: { kind: 'zoom-recording' } });
    await seedChunk(doc, 'CONFIDENTIAL internal strategy transcript');

    await expect(svc.readMatchedTranscript(ORG, 'zoom:unmatched')).rejects.toBeInstanceOf(svc.ContentGateError);
  });

  it('returns the transcript once a candidate row exists', async () => {
    const src = await seedSource('zoom');
    const doc = await seedDoc(src, { externalId: 'zoom:matched', metadata: { kind: 'zoom-recording' } });
    await seedChunk(doc, 'chunk one');
    await seedChunk(doc, 'chunk two');
    await db.insert(discoveryCandidateSchema).values({
      orgId: ORG,
      meetingExternalId: 'zoom:matched',
      meetingDocId: doc,
      matchType: 'hubspot-contact',
      status: 'matched',
    });

    const text = await svc.readMatchedTranscript(ORG, 'zoom:matched');

    expect(text).toContain('chunk one');
    expect(text).toContain('chunk two');
  });
});

// ── classifier fail-safe ─────────────────────────────────────────────────────

describe('classifyTranscript', () => {
  it('routes to review (low signal) when the model output cannot be parsed', async () => {
    invokeMock.mockResolvedValue({ content: 'not json at all' });
    const c = await svc.classifyTranscript('some transcript', { title: 'x' });

    expect(c.isDiscovery).toBe(false);
    expect(c.isDiscoveryConfidence).toBe(0);
    expect(c.reasoning).toMatch(/could not be parsed/);
  });

  it('maps a valid classifier response into the two-axis result', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.88,
      proposal_ready: false,
      proposal_ready_confidence: 0.3,
      reasoning: 'clear discovery, needs one more call',
    });
    const c = await svc.classifyTranscript('t', { title: 'x' });

    expect(c).toMatchObject({ isDiscovery: true, isDiscoveryConfidence: 0.88, proposalReady: false });
  });
});

// ── matchWindow · the ledger recorder (metadata only) ────────────────────────

const windowOpts = {
  eligible: { ownerIds: ['chris'], lifecycleStages: ['marketingqualifiedlead'] },
  sellerDomain: 'metacto.com',
  sinceDays: 30,
  now: NOW,
};

async function seedProspectContact() {
  const hubspot = await seedSource('hubspot');
  await seedDoc(hubspot, {
    externalId: 'contacts:9',
    title: 'Acme buyer',
    metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
  });
}

describe('matchWindow', () => {
  it('records only the matched call and never creates a row for the internal one', async () => {
    await seedProspectContact();
    const zoom = await seedSource('zoom');
    const docA = await seedDoc(zoom, {
      externalId: 'zoom:prospect',
      title: 'Acme <> Metacto discovery',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(docA, 'We have 40 stores and need help with proposals.');
    const docB = await seedDoc(zoom, {
      externalId: 'zoom:internal',
      title: 'Metacto standup',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'andrew@metacto.com'] },
    });
    await seedChunk(docB, 'CONFIDENTIAL internal roadmap discussion.');

    const result = await svc.matchWindow(ORG, windowOpts);

    expect(result.meetingsScanned).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      meetingExternalId: 'zoom:prospect',
      status: 'matched',
      hasTranscript: true,
      skippedReason: 'not-reached',
    });

    // No model call, ever — matching is metadata only.
    expect(invokeMock).not.toHaveBeenCalled();

    // The internal call has no candidate row, so its transcript stays ungated.
    await expect(svc.readMatchedTranscript(ORG, 'zoom:internal')).rejects.toBeInstanceOf(svc.ContentGateError);
  });

  it('stamps no-transcript on a matched call whose transcript has not landed', async () => {
    const zoom = await seedSource('zoom');
    await seedDoc(zoom, {
      externalId: 'zoom:notranscript',
      title: 'Acme intro',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: false, attendees: ['chris@metacto.com', 'ceo@brandnew.io'] },
    });

    const result = await svc.matchWindow(ORG, windowOpts);

    expect(result.candidates[0]).toMatchObject({
      meetingExternalId: 'zoom:notranscript',
      matchType: 'calendly-external',
      skippedReason: 'no-transcript',
    });
  });

  it('is idempotent: a second pass re-reports the same candidate, no duplicate rows', async () => {
    await seedProspectContact();
    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:once',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'transcript');

    const first = await svc.matchWindow(ORG, windowOpts);
    const second = await svc.matchWindow(ORG, windowOpts);

    expect(second.candidates[0]!.candidateId).toBe(first.candidates[0]!.candidateId);

    const rows = await db.select().from(discoveryCandidateSchema);

    expect(rows).toHaveLength(1);
  });

  it('fails closed: a recording with no calendar event of the same id is never matched — but is REPORTED as unmatchable', async () => {
    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:orphan',
      title: 'MetaCTO <> 30 min intro',
      metadata: { kind: 'zoom-recording', meetingId: '99999999999', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true },
    });
    await seedChunk(doc, 'CONFIDENTIAL — must never be read');

    const result = await svc.matchWindow(ORG, windowOpts);

    expect(result.candidates).toHaveLength(0);
    await expect(svc.readMatchedTranscript(ORG, 'zoom:orphan')).rejects.toBeInstanceOf(svc.ContentGateError);

    // Fail-closed is visible, not silent: the meeting is named as unmatchable
    // in both the match result and the coverage check.
    expect(result.unmatchableCount).toBe(1);
    expect(result.unmatchable[0]).toMatchObject({ meetingExternalId: 'zoom:orphan', title: 'MetaCTO <> 30 min intro', hasTranscript: true });

    const recon = await svc.reconcileWindow(ORG, windowOpts);

    expect(recon.gapCount).toBe(0);
    expect(recon.unmatchableCount).toBe(1);
    expect(recon.unmatchable[0]!.meetingExternalId).toBe('zoom:orphan');
  });

  it('borrows attendees from the calendar event sharing the Zoom meeting id, even one ingested long before the window', async () => {
    await seedProspectContact();
    const cal = await seedSource('google-calendar');
    await seedDoc(cal, {
      externalId: 'gcal:primary:old-evt',
      metadata: { kind: 'calendar-event', organizer: 'chris@metacto.com', attendees: ['chris@metacto.com', 'buyer@acme.com'], zoomMeetingId: '77777777777' },
      ingestedAt: new Date(NOW.getTime() - 30 * 86_400_000),
    });
    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:late',
      metadata: { kind: 'zoom-recording', meetingId: '77777777777', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true },
      ingestedAt: new Date(NOW.getTime() - 3_600_000),
    });
    await seedChunk(doc, 'transcript body');

    const result = await svc.matchWindow(ORG, { ...windowOpts, sinceDays: 3 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.meetingExternalId).toBe('zoom:late');
  });

  it('matches a Granola note — a call held off Zoom (Teams/Meet) still becomes a candidate', async () => {
    await seedProspectContact();
    const granola = await seedSource('granola');
    const doc = await seedDoc(granola, {
      externalId: 'granola:teams-call',
      title: 'Acme <> Metacto (Teams)',
      metadata: { kind: 'granola-note', owner: 'chris@metacto.com', when: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'Summary + transcript of the Teams call.');

    const result = await svc.matchWindow(ORG, windowOpts);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      meetingExternalId: 'granola:teams-call',
      status: 'matched',
      hasTranscript: true,
    });
  });

  it('dedupes a double capture: the Granola twin of a matched Zoom recording is dropped and reported', async () => {
    await seedProspectContact();
    const zoom = await seedSource('zoom');
    const zoomDoc = await seedDoc(zoom, {
      externalId: 'zoom:call',
      title: 'Acme discovery',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(zoomDoc, 'zoom transcript');
    const granola = await seedSource('granola');
    await seedDoc(granola, {
      externalId: 'granola:same-call',
      title: 'Acme discovery',
      // Granola stamps the scheduled start; the recording started 5 min later.
      metadata: { kind: 'granola-note', owner: 'chris@metacto.com', when: new Date(NOW.getTime() - 5 * 60_000).toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });

    const result = await svc.matchWindow(ORG, windowOpts);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.meetingExternalId).toBe('zoom:call');
    expect(result.doubleCapturesDropped).toHaveLength(1);
    expect(result.doubleCapturesDropped[0]).toMatchObject({
      meetingExternalId: 'granola:same-call',
      keptExternalId: 'zoom:call',
    });
    // The dropped twin never got a ledger row, so its content stays gated.
    await expect(svc.readMatchedTranscript(ORG, 'granola:same-call')).rejects.toBeInstanceOf(svc.ContentGateError);
  });

  it('keeps a Granola note whose Zoom twin failed to match — dedup never suppresses coverage', async () => {
    await seedProspectContact();
    const zoom = await seedSource('zoom');
    // Same call, but the recording has no attendees (no calendar event) so it
    // fails closed and never matches.
    await seedDoc(zoom, {
      externalId: 'zoom:orphan-twin',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true },
    });
    const granola = await seedSource('granola');
    const doc = await seedDoc(granola, {
      externalId: 'granola:survives',
      metadata: { kind: 'granola-note', owner: 'chris@metacto.com', when: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'granola transcript');

    const result = await svc.matchWindow(ORG, windowOpts);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.meetingExternalId).toBe('granola:survives');
    expect(result.doubleCapturesDropped).toHaveLength(0);
  });
});

// ── classifyCall · read + classify + persist, one function ──────────────────

const GOOD_VERDICT = {
  is_discovery: true,
  is_discovery_confidence: 0.92,
  proposal_ready: true,
  proposal_ready_confidence: 0.85,
  reasoning: 'clear discovery, scoped problem, buying intent',
};

async function seedMatchedProspect(externalId = 'zoom:prospect', transcript = 'We have 40 stores and need help with proposals.') {
  await seedProspectContact();
  const zoom = await seedSource('zoom');
  const doc = await seedDoc(zoom, {
    externalId,
    title: 'Acme <> Metacto discovery',
    metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
  });
  await seedChunk(doc, transcript);
  const { candidates } = await svc.matchWindow(ORG, windowOpts);
  return { candidateId: candidates[0]!.candidateId, docId: doc };
}

describe('classifyCall', () => {
  const assessedBy = { agentSlug: 'revenue-lead', missionRunId: 42, userId: 'automation:discovery-sweep' };

  it('persists the verdict with full provenance and returns only structured scores', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect();

    const result = await svc.classifyCall(ORG, candidateId, { assessedBy });

    expect(result).toMatchObject({
      candidateId,
      isDiscovery: true,
      route: 'generate',
      thresholds: { discovery: 0.6, ready: 0.75 },
      transcriptHash: 'zoom:prospect', // seedDoc sets contentHash = externalId
    });
    expect(result.classifierVersion).toMatch(/#discovery-v1$/);

    // The transcript body never appears in what the tool would hand the agent.
    expect(JSON.stringify(result)).not.toContain('40 stores');

    const [row] = await db.select().from(discoveryCandidateSchema);

    expect(row).toMatchObject({
      status: 'classified',
      route: 'generate',
      transcriptHash: 'zoom:prospect',
      thresholds: { discovery: 0.6, ready: 0.75 },
      assessedBy: { agentSlug: 'revenue-lead', missionRunId: 42, userId: 'automation:discovery-sweep' },
      skippedReason: null,
    });
    expect(row!.classification?.reasoning).toContain('clear discovery');
  });

  it('emits exactly one discovery.classified activity event deep-linking the ledger row', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect();

    await svc.classifyCall(ORG, candidateId, { assessedBy });

    const events = await db.select().from(userActivityEventSchema);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'discovery.classified',
      agentSlug: 'revenue-lead',
      resourceType: 'discovery_candidate',
      resourceId: String(candidateId),
      metadata: { route: 'generate', isDiscovery: true, proposalReady: true },
    });
  });

  it('refuses with a typed error when no candidate row exists — in the body, not a prompt', async () => {
    await expect(svc.classifyCall(ORG, 999_999, { assessedBy })).rejects.toMatchObject({
      name: 'ClassifyCallError',
      code: 'no_candidate',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('is cross-tenant safe: org B cannot assess org A candidates', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect();

    await expect(svc.classifyCall('org_other', candidateId, { assessedBy })).rejects.toMatchObject({
      code: 'no_candidate',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('refuses (typed) and stamps skipped_reason when the transcript has no content yet', async () => {
    await seedProspectContact();
    const zoom = await seedSource('zoom');
    await seedDoc(zoom, {
      externalId: 'zoom:empty',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    const { candidates } = await svc.matchWindow(ORG, windowOpts);

    await expect(svc.classifyCall(ORG, candidates[0]!.candidateId, { assessedBy })).rejects.toMatchObject({
      code: 'no_transcript',
    });

    const [row] = await db.select().from(discoveryCandidateSchema);

    expect(row!.skippedReason).toBe('no-transcript');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('re-assessing a changed transcript records the new hash — re-classification is distinguishable from a duplicate', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId, docId } = await seedMatchedProspect();

    const first = await svc.classifyCall(ORG, candidateId, { assessedBy });

    // The transcript is re-synced with new content: contentHash changes.
    await db.update(knowledgeDocumentSchema)
      .set({ contentHash: 'v2-hash' })
      .where(eq(knowledgeDocumentSchema.id, docId));

    const second = await svc.classifyCall(ORG, candidateId, { assessedBy });

    expect(first.transcriptHash).toBe('zoom:prospect');
    expect(second.transcriptHash).toBe('v2-hash');
  });

  it('keeps history: an old row keeps the thresholds it was decided under', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect('zoom:prospect');

    await svc.classifyCall(ORG, candidateId, { assessedBy, discoveryThreshold: 0.6, readyThreshold: 0.75 });

    // A different call assessed later under stricter thresholds.
    const zoom2 = await seedSource('zoom-b');
    const doc2 = await seedDoc(zoom2, {
      externalId: 'zoom:prospect2',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc2, 'another call');
    const { candidates } = await svc.matchWindow(ORG, windowOpts);
    const second = candidates.find(c => c.meetingExternalId === 'zoom:prospect2')!;
    await svc.classifyCall(ORG, second.candidateId, { assessedBy, discoveryThreshold: 0.8, readyThreshold: 0.9 });

    const rows = await db.select().from(discoveryCandidateSchema);
    const oldRow = rows.find(r => r.meetingExternalId === 'zoom:prospect')!;
    const newRow = rows.find(r => r.meetingExternalId === 'zoom:prospect2')!;

    expect(oldRow.thresholds).toEqual({ discovery: 0.6, ready: 0.75 });
    expect(newRow.thresholds).toEqual({ discovery: 0.8, ready: 0.9 });
    // Stricter thresholds route the same scores differently — derivable per row.
    expect(oldRow.route).toBe('generate');
    expect(newRow.route).toBe('confirm');
  });

  it('records a dropped call as a row with scores and reasoning, not an absence', async () => {
    classifierReturns({
      is_discovery: false,
      is_discovery_confidence: 0.9,
      proposal_ready: false,
      proposal_ready_confidence: 0.1,
      reasoning: 'status call with an existing client',
    });
    const { candidateId } = await seedMatchedProspect();

    const result = await svc.classifyCall(ORG, candidateId, { assessedBy });

    expect(result.route).toBe('drop');

    const [row] = await db.select().from(discoveryCandidateSchema);

    expect(row).toMatchObject({ status: 'classified', route: 'drop' });
    expect(row!.classification?.reasoning).toContain('status call');
  });
});

// ── reconcileWindow · the coverage check ─────────────────────────────────────

describe('reconcileWindow', () => {
  it('surfaces a seeded gap (matched, classifiable, never assessed) and clears once assessed', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect();

    const before = await svc.reconcileWindow(ORG, windowOpts);

    expect(before.matchedNow).toBe(1);
    expect(before.assessed).toBe(0);
    expect(before.gaps).toHaveLength(1);
    expect(before.gaps[0]).toMatchObject({ meetingExternalId: 'zoom:prospect', kind: 'not-reached' });

    await svc.classifyCall(ORG, candidateId, { assessedBy: { agentSlug: 'revenue-lead' } });

    const after = await svc.reconcileWindow(ORG, windowOpts);

    expect(after.assessed).toBe(1);
    expect(after.gaps).toHaveLength(0);
  });

  it('reports a matched meeting with no ledger row as unvisited (mis-scoped window)', async () => {
    await seedProspectContact();
    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:missed',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'transcript');

    // matchWindow never ran — the agent mis-scoped its window.
    const result = await svc.reconcileWindow(ORG, windowOpts);

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ meetingExternalId: 'zoom:missed', kind: 'unvisited' });
    expect(invokeMock).not.toHaveBeenCalled(); // reconciliation never spends on the model
  });
});

// ── proposing the review item (agent path) — canonical dedup + back-link ─────

describe('discovery.review_proposal via proposeAction (agent path)', () => {
  const agentPrincipal = {
    kind: 'agent' as const,
    id: 'agent:revenue-lead',
    scope: { orgId: ORG },
    grants: ['*'],
    autonomy: 2 as const,
  };

  async function propose(candidateId: number) {
    const { proposeAction } = await import('@/services/ActionService');
    return proposeAction({
      orgId: ORG,
      actionId: 'discovery.review_proposal',
      principal: agentPrincipal,
      invokedBy: 'agent:revenue-lead',
      input: {
        candidateId,
        meetingExternalId: 'zoom:prospect',
        company: 'contacts:9',
        route: 'generate',
        isDiscovery: true,
        proposalReady: true,
      },
      proposal: { confidence: 0.92, rationale: 'clear discovery' },
    });
  }

  it('re-proposing the same meeting updates the pending item — no duplicate queue items', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect();
    await svc.classifyCall(ORG, candidateId, { assessedBy: { agentSlug: 'revenue-lead' } });

    const first = await propose(candidateId);
    const second = await propose(candidateId);

    expect(first.status).toBe('pending');
    expect(second.runId).toBe(first.runId);

    const actions = await db.select().from(actionRunSchema);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionId: 'discovery.review_proposal', status: 'pending' });
    expect(actions[0]!.dedupKey).toBe('discovery.review_proposal:zoom:prospect');
  });

  it('back-links the queue item onto the ledger row (status routed, reviewActionRunId set)', async () => {
    classifierReturns(GOOD_VERDICT);
    const { candidateId } = await seedMatchedProspect();
    await svc.classifyCall(ORG, candidateId, { assessedBy: { agentSlug: 'revenue-lead' } });

    const res = await propose(candidateId);

    const [row] = await db.select().from(discoveryCandidateSchema);

    expect(row).toMatchObject({ status: 'routed', reviewActionRunId: res.runId });
  });
});
