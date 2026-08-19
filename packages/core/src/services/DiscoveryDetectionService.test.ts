import type { Classification } from '@/services/DiscoveryDetectionService';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// Deterministic classifier — the sweep test asserts exactly when it is (not) called.
const invokeMock = vi.fn();
vi.mock('@/libs/llm', () => ({
  buildChatModel: () => ({ invoke: invokeMock }),
}));

const { db } = await import('@/libs/DB');
const {
  knowledgeSourceSchema,
  knowledgeDocumentSchema,
  knowledgeChunkSchema,
  discoveryCandidateSchema,
  actionRunSchema,
} = await import('@/models/Schema');
const svc = await import('@/services/DiscoveryDetectionService');
const { runDiscoverySweepJob } = await import('@/services/jobs/discoverySweep');

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
  await db.delete(actionRunSchema);
  await db.delete(discoveryCandidateSchema);
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  invokeMock.mockReset();
});

afterAll(async () => {
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

// ── Stage orchestrator · the privacy proof end to end ────────────────────────

describe('runSweep', () => {
  const sweepOpts = {
    eligible: { ownerIds: ['chris'], lifecycleStages: ['marketingqualifiedlead'] },
    sellerDomain: 'metacto.com',
    sinceDays: 30,
    discoveryThreshold: 0.6,
    readyThreshold: 0.7,
    now: NOW,
  };

  it('reads and classifies only the matched call, and never touches the internal one', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.92,
      proposal_ready: true,
      proposal_ready_confidence: 0.85,
      reasoning: 'clear discovery + ready',
    });

    const hubspot = await seedSource('hubspot');
    await seedDoc(hubspot, {
      externalId: 'contacts:9',
      title: 'Acme buyer',
      metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
    });

    const zoom = await seedSource('zoom');
    // A — a real prospect discovery call.
    const docA = await seedDoc(zoom, {
      externalId: 'zoom:prospect',
      title: 'Acme <> Metacto discovery',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(docA, 'We have 40 stores and need help with proposals.');
    // B — an internal meeting whose transcript must never be read.
    const docB = await seedDoc(zoom, {
      externalId: 'zoom:internal',
      title: 'Metacto standup',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'andrew@metacto.com'] },
    });
    await seedChunk(docB, 'CONFIDENTIAL internal roadmap discussion.');

    const result = await svc.runSweep(ORG, sweepOpts);

    // Only the prospect call was matched, classified, and routed.
    expect(result.matched).toBe(1);
    expect(result.classified).toBe(1);
    expect(result.routed.generate).toBe(1);

    // The classifier ran exactly once — never on the internal call.
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // The internal call has no candidate row and its transcript is ungated → refused.
    await expect(svc.readMatchedTranscript(ORG, 'zoom:internal')).rejects.toBeInstanceOf(svc.ContentGateError);

    // The matched call is recorded and surfaced to the review queue (supervised).
    const candidates = await db.select().from(discoveryCandidateSchema);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ meetingExternalId: 'zoom:prospect', status: 'routed', route: 'generate' });

    const actions = await db.select().from(actionRunSchema);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionId: 'discovery.review_proposal', status: 'pending' });

    void docB;
  });

  it('borrows attendees from the calendar event that shares the Zoom meeting id', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.9,
      proposal_ready: false,
      proposal_ready_confidence: 0.4,
      reasoning: 'discovery, one more call needed',
    });

    const hubspot = await seedSource('hubspot');
    await seedDoc(hubspot, {
      externalId: 'contacts:9',
      metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
    });

    const cal = await seedSource('google-calendar');
    await seedDoc(cal, {
      externalId: 'gcal:primary:evt1',
      metadata: { kind: 'calendar-event', start: NOW.toISOString(), organizer: 'chris@metacto.com', attendees: ['chris@metacto.com', 'buyer@acme.com'], zoomMeetingId: '89590696148' },
    });

    const zoom = await seedSource('zoom');
    // Zoom recording carrying the same meeting id, host only, NO attendees stamped.
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:corr',
      title: 'Recorded call',
      metadata: { kind: 'zoom-recording', meetingId: '89590696148', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true },
    });
    await seedChunk(doc, 'transcript body');

    const result = await svc.runSweep(ORG, sweepOpts);

    expect(result.matched).toBe(1);
    expect(result.classified).toBe(1);
    expect(result.routed.confirm).toBe(1);
  });

  it('fails closed: a recording with no calendar event of the same id is never matched or read', async () => {
    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:orphan',
      title: 'Recorded call, no calendar match',
      metadata: { kind: 'zoom-recording', meetingId: '99999999999', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true },
    });
    await seedChunk(doc, 'CONFIDENTIAL — must never be read');

    const result = await svc.runSweep(ORG, sweepOpts);

    expect(result.matched).toBe(0);
    expect(result.classified).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
    await expect(svc.readMatchedTranscript(ORG, 'zoom:orphan')).rejects.toBeInstanceOf(svc.ContentGateError);
  });

  it('does not re-classify or re-enqueue a candidate already routed on a prior sweep', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.92,
      proposal_ready: true,
      proposal_ready_confidence: 0.85,
      reasoning: 'clear',
    });

    const hubspot = await seedSource('hubspot');
    await seedDoc(hubspot, {
      externalId: 'contacts:9',
      metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
    });

    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:once',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'transcript');

    await svc.runSweep(ORG, sweepOpts);
    await svc.runSweep(ORG, sweepOpts); // second sweep — a no-op for this candidate

    expect(invokeMock).toHaveBeenCalledTimes(1); // classified once, not twice

    const actions = await db.select().from(actionRunSchema);

    expect(actions).toHaveLength(1); // one review item, not a duplicate
  });

  it('records a match but does not classify a call whose transcript has not landed yet', async () => {
    const zoom = await seedSource('zoom');
    await seedDoc(zoom, {
      externalId: 'zoom:notranscript',
      title: 'Acme intro',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: false, attendees: ['chris@metacto.com', 'ceo@brandnew.io'] },
    });

    const result = await svc.runSweep(ORG, sweepOpts);

    expect(result.matched).toBe(1); // calendly-external
    expect(result.classified).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();

    const candidates = await db.select().from(discoveryCandidateSchema);

    expect(candidates[0]).toMatchObject({ meetingExternalId: 'zoom:notranscript', matchType: 'calendly-external', status: 'matched' });
  });

  /**
   * The regression that motivated windowing recordings only. A calendar event is
   * normally created BEFORE its call, so it is routinely ingested outside the
   * recording's window. Sharing one window meant the recording found no event,
   * kept zero attendees, failed closed, and then aged out permanently — an
   * unread prospect call caused by ingest ordering, not by the privacy rule.
   */
  it('joins a calendar event ingested long before the window it correlates into', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.9,
      proposal_ready: false,
      proposal_ready_confidence: 0.4,
      reasoning: 'discovery',
    });

    const hubspot = await seedSource('hubspot');
    await seedDoc(hubspot, {
      externalId: 'contacts:9',
      metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
    });

    const cal = await seedSource('google-calendar');
    // Invite synced 30 days before the sweep window opens.
    await seedDoc(cal, {
      externalId: 'gcal:primary:old-evt',
      metadata: { kind: 'calendar-event', organizer: 'chris@metacto.com', attendees: ['chris@metacto.com', 'buyer@acme.com'], zoomMeetingId: '77777777777' },
      ingestedAt: new Date(NOW.getTime() - 30 * 86_400_000),
    });

    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:late',
      title: 'Recorded call, invite synced weeks earlier',
      metadata: { kind: 'zoom-recording', meetingId: '77777777777', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true },
      ingestedAt: new Date(NOW.getTime() - 3_600_000),
    });
    await seedChunk(doc, 'transcript body');

    // A 3-day window — the same one production runs. The event is well outside it.
    const result = await svc.runSweep(ORG, { ...sweepOpts, sinceDays: 3 });

    expect(result.matched).toBe(1);
    expect(result.classified).toBe(1);
  });

  it('windows recordings by ingest time, so a replayed day excludes later ingests', async () => {
    const zoom = await seedSource('zoom');
    await seedDoc(zoom, {
      externalId: 'zoom:inside',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', hasTranscript: false, attendees: ['chris@metacto.com', 'ceo@brandnew.io'] },
      ingestedAt: new Date('2026-08-12T09:00:00.000Z'),
    });
    await seedDoc(zoom, {
      externalId: 'zoom:after',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', hasTranscript: false, attendees: ['chris@metacto.com', 'ceo@brandnew.io'] },
      ingestedAt: new Date('2026-08-16T09:00:00.000Z'),
    });

    // Replay just 2026-08-12: window is that day, upper bound included.
    const result = await svc.runSweep(ORG, {
      ...sweepOpts,
      sinceDays: 1,
      now: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(result.meetingsScanned).toBe(1);
    expect(result.window).toEqual({ since: '2026-08-12T00:00:00.000Z', until: '2026-08-13T00:00:00.000Z' });
  });

  it('dry run classifies and reports but enqueues nothing and routes nothing', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.92,
      proposal_ready: true,
      proposal_ready_confidence: 0.85,
      reasoning: 'clear discovery',
    });

    const hubspot = await seedSource('hubspot');
    await seedDoc(hubspot, {
      externalId: 'contacts:9',
      metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
    });

    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:dry',
      title: 'Acme discovery',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'transcript body');

    const result = await svc.runSweep(ORG, { ...sweepOpts, dryRun: true });

    // It did the work and can explain itself.
    expect(result.dryRun).toBe(true);
    expect(result.classified).toBe(1);
    expect(result.routed.generate).toBe(1);
    expect(result.meetings[0]).toMatchObject({ meetingExternalId: 'zoom:dry', route: 'generate' });
    expect(result.meetings[0]?.classification?.isDiscovery).toBe(true);

    // But nothing consequential was written: no review item, and the candidate
    // is still un-routed so the next real sweep still handles it.
    const actions = await db.select().from(actionRunSchema);

    expect(actions).toHaveLength(0);

    const candidates = await db.select().from(discoveryCandidateSchema);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ meetingExternalId: 'zoom:dry', status: 'matched', route: null });
  });

  it('dry run re-classifies an already-routed candidate (rehearsing a swept day is the point)', async () => {
    classifierReturns({
      is_discovery: true,
      is_discovery_confidence: 0.92,
      proposal_ready: true,
      proposal_ready_confidence: 0.85,
      reasoning: 'clear',
    });

    const hubspot = await seedSource('hubspot');
    await seedDoc(hubspot, {
      externalId: 'contacts:9',
      metadata: { objectType: 'contacts', hubspotId: '9', ownerId: 'chris', lifecycleStage: 'marketingqualifiedlead', primaryEmail: 'buyer@acme.com' },
    });

    const zoom = await seedSource('zoom');
    const doc = await seedDoc(zoom, {
      externalId: 'zoom:again',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: true, attendees: ['chris@metacto.com', 'buyer@acme.com'] },
    });
    await seedChunk(doc, 'transcript');

    await svc.runSweep(ORG, sweepOpts); // real sweep → routed
    const dry = await svc.runSweep(ORG, { ...sweepOpts, dryRun: true });

    expect(dry.classified).toBe(1); // NOT skipped as already-routed
    expect(invokeMock).toHaveBeenCalledTimes(2);

    // Still exactly one review item — the dry run added none.
    const actions = await db.select().from(actionRunSchema);

    expect(actions).toHaveLength(1);
  });

  it('reports why a matched meeting was not classified', async () => {
    const zoom = await seedSource('zoom');
    await seedDoc(zoom, {
      externalId: 'zoom:pending',
      title: 'Acme intro',
      metadata: { kind: 'zoom-recording', host: 'chris@metacto.com', start: NOW.toISOString(), hasTranscript: false, attendees: ['chris@metacto.com', 'ceo@brandnew.io'] },
    });

    const result = await svc.runSweep(ORG, sweepOpts);

    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0]).toMatchObject({
      meetingExternalId: 'zoom:pending',
      matchType: 'calendly-external',
      skipped: 'no-transcript',
    });
    expect(result.meetings[0]?.matchReason).toBeTruthy();
  });
});

// ── the automation job wiring (scheduled path) ───────────────────────────────

describe('runDiscoverySweepJob', () => {
  it('parses automation do.input and runs the sweep', async () => {
    const result = await runDiscoverySweepJob(ORG, {
      sellerDomain: 'metacto.com',
      eligible: { lifecycleStages: ['lead'] },
      sinceDays: 3,
      discoveryThreshold: 0.6,
      readyThreshold: 0.75,
      supervised: true,
    }) as { matched: number; classified: number };

    expect(result).toMatchObject({ matched: 0, classified: 0 });
  });

  it('rejects input missing the required sellerDomain', async () => {
    await expect(runDiscoverySweepJob(ORG, { eligible: {} })).rejects.toThrow();
  });

  it('replays a named day as a one-day window, overriding sinceDays', async () => {
    const result = await runDiscoverySweepJob(ORG, {
      sellerDomain: 'metacto.com',
      sinceDays: 30, // must lose to `day`
      day: '2026-08-12',
    }) as { window: { since: string; until: string } };

    expect(result.window).toEqual({
      since: '2026-08-12T00:00:00.000Z',
      until: '2026-08-13T00:00:00.000Z',
    });
  });

  it('rejects a malformed day', async () => {
    await expect(runDiscoverySweepJob(ORG, { sellerDomain: 'metacto.com', day: '12/08/2026' })).rejects.toThrow();
  });

  it('passes dryRun through to the sweep', async () => {
    const result = await runDiscoverySweepJob(ORG, {
      sellerDomain: 'metacto.com',
      dryRun: true,
    }) as { dryRun: boolean };

    expect(result.dryRun).toBe(true);
  });
});
