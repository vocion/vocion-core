/**
 * Personalization tool suite — the phase-1 promises, proven structurally:
 *
 *   - A queued row is a PROJECTION of the CRM mirror. The caller supplies
 *     refs and nothing else, so no name, company or entrance path can be
 *     invented, and claims / missing / draftSequence / confidence stay empty.
 *   - A re-fire is a no-op, guaranteed by `lead_brief_org_contact_idx` rather
 *     than by de-duplication logic, and it never overwrites a researched row.
 *   - `reconcile_mql_window` names every unqueued arrival, and REFUSES a
 *     lifecycle stage the CRM does not hold rather than reporting zero gaps.
 *   - Counts come first, and they are real COUNT(*)s, not page lengths.
 *   - Cross-tenant: org B never sees org A's queue.
 *   - The tools are GRANTED, not default: absent without harness.grantTools.
 */
import type { RuntimeContext } from '../types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, knowledgeDocumentSchema, leadBriefSchema } = await import('@/models/Schema');
const { buildDomainTools } = await import('./registry');
const { personalizationTools, PERSONALIZATION_TOOL_NAMES } = await import('./personalization');

const ORG = 'org_personalization';
const OTHER = 'org_other';
const NOW = new Date('2026-08-26T12:00:00.000Z');

/** One clock reading for the whole file, so a seeded date is stable to the ms. */
const STARTED_AT = Date.now();

/**
 * Arrival dates are relative to the real clock, because the window under test
 * is resolved against the SERVER clock. A fixed date would make these pass
 * only until it fell out of the window.
 * @param days
 */
function daysAgo(days: number): string {
  return new Date(STARTED_AT - days * 86_400_000).toISOString();
}

const RECENT = daysAgo(2);

function ctxFor(orgId: string, grants: string[] = [...PERSONALIZATION_TOOL_NAMES]): RuntimeContext {
  return {
    orgId,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    missionRunId: 12,
    connectorSources: ['hubspot'],
    objectTypeSlugs: [],
    searchConfig: {},
    operationSlugs: [],
    harnessConfig: { grantTools: grants },
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

/** The langchain tool union's overloads defeat direct .invoke() typing. */
type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(orgId: string, grants?: string[]) {
  const list = personalizationTools(ctxFor(orgId, grants)) as unknown as Invokable[];
  return new Map(list.map(t => [t.name, t]));
}

async function call<T>(tool: Invokable | undefined, args: Record<string, unknown> = {}): Promise<T> {
  return JSON.parse(await tool!.invoke(args)) as T;
}

type QueueResult = {
  requested: number;
  queued: number;
  alreadyQueued: number;
  notInMirror: string[];
  queueTotal: number;
  leads: Array<{ contactRef: string; contactName: string; companyName: string | null; entranceSource: string | null; arrivedAt: string | null }>;
};

type LedgerResult = {
  count: number;
  total: number;
  leads: Array<{ contactRef: string; contactName: string; status: string; confidence: number | null; claimCount: number; briefVersion: string | null }>;
};

type ReconcileResult = {
  arrivals: number;
  queued: number;
  gapCount: number;
  gaps: Array<{ contactRef: string; contactName: string | null; kind: string; detail: string }>;
  lifecycleStages: string[];
  note: string;
  error?: string;
  not_found?: string[];
  available_values?: Record<string, number>;
};

/**
 * A HubSpot mirror with MQLs, one lead, and one MQL that arrived before the
 * window — the shape a window query has to get right.
 * @param orgId
 */
async function seedMirror(orgId = ORG) {
  const [source] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug: 'hubspot-contacts',
    kind: 'plugin',
    configJson: { _connector: 'hubspot' },
    lastSyncedAt: NOW,
  }).returning({ id: knowledgeSourceSchema.id });

  async function contact(id: number, over: Record<string, unknown> = {}) {
    await db.insert(knowledgeDocumentSchema).values({
      orgId,
      sourceId: source!.id,
      externalId: `contacts:${id}`,
      title: `Person ${id}`,
      contentHash: `contacts:${id}`,
      ingestedAt: NOW,
      metadata: {
        objectType: 'contacts',
        hubspotId: String(id),
        lifecycleStage: 'marketingqualifiedlead',
        primaryEmail: `person${id}@acme.com`,
        company: 'Acme',
        jobTitle: 'Ops Lead',
        createdAt: RECENT,
        originalSource: 'PAID_SEARCH',
        originalSourceDetail: 'ai-construction',
        emailDelivered: 3,
        emailOpened: 2,
        ...over,
      },
    });
  }

  await contact(1);
  await contact(2);
  await contact(3);
  // In the window but not an MQL.
  await contact(4, { lifecycleStage: 'lead' });
  // An MQL that arrived long before the window opened.
  await contact(5, { createdAt: daysAgo(200) });
}

/** The shape the automation uses: a stage read off the facets, a trailing window. */
const WINDOW = { lifecycle_stages: ['marketingqualifiedlead'], since_days: 7 };

beforeEach(async () => {
  await db.delete(leadBriefSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(leadBriefSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('grant gating', () => {
  it('builds nothing for an agent without the grant', () => {
    expect(personalizationTools(ctxFor(ORG, []))).toHaveLength(0);
    expect(buildDomainTools(ctxFor(ORG, [])).map(t => t.name)).not.toContain('queue_lead');
  });

  it('builds only the tools the harness names', () => {
    const names = personalizationTools(ctxFor(ORG, ['get_lead_ledger'])).map(t => t.name);

    expect(names).toStrictEqual(['get_lead_ledger']);
  });

  it('reaches the registry when granted', () => {
    const names = buildDomainTools(ctxFor(ORG)).map(t => t.name);

    for (const name of PERSONALIZATION_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });
});

describe('queue_lead', () => {
  it('projects the mirror record onto the row instead of taking it from the caller', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);

    const out = await call<QueueResult>(tools.get('queue_lead'), { contact_refs: ['contacts:1'] });

    expect(out.queued).toBe(1);
    expect(out.leads[0]).toMatchObject({
      contactRef: 'contacts:1',
      contactName: 'Person 1',
      companyName: 'Acme',
      entranceSource: 'PAID_SEARCH',
      arrivedAt: RECENT,
    });

    const [row] = await db.select().from(leadBriefSchema);

    expect(row).toMatchObject({
      contactTitle: 'Ops Lead',
      utmCampaign: 'ai-construction',
      engagementSent: 3,
      engagementOpened: 2,
      triggerType: 'new',
      status: 'queued',
    });
    expect(row!.briefedAt).toBeInstanceOf(Date);
    expect(row!.briefedBy).toMatchObject({ agentSlug: 'revenue-lead', missionRunId: 12 });
    expect(row!.briefVersion).toContain('queue-only');
  });

  it('records no research: claims, missing, sequence empty and confidence null', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);

    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:2'] });
    const rows = await db.select().from(leadBriefSchema);

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.claims).toStrictEqual([]);
      expect(row.missing).toStrictEqual([]);
      expect(row.draftSequence).toStrictEqual([]);
      expect(row.confidence).toBeNull();
    }
  });

  it('makes a re-fire a no-op — the unique index, not de-dup logic', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);
    const refs = ['contacts:1', 'contacts:2', 'contacts:3'];

    const first = await call<QueueResult>(tools.get('queue_lead'), { contact_refs: refs });
    const second = await call<QueueResult>(tools.get('queue_lead'), { contact_refs: refs });

    expect(first.queued).toBe(3);
    expect(second.queued).toBe(0);
    expect(second.alreadyQueued).toBe(3);
    expect(second.queueTotal).toBe(3);
    await expect(db.select().from(leadBriefSchema)).resolves.toHaveLength(3);
  });

  it('never overwrites a row a later slice has researched', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);
    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1'] });
    await db.update(leadBriefSchema).set({
      confidence: 0.9,
      status: 'ready_for_review',
      claims: [{ text: 'Runs a 14-person MSP.', kind: 'company', source: 'acme.com' }],
    });

    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1'] });
    const [row] = await db.select().from(leadBriefSchema);

    expect(row!.confidence).toBeCloseTo(0.9);
    expect(row!.status).toBe('ready_for_review');
    expect(row!.claims).toHaveLength(1);
  });

  it('names refs the mirror does not carry instead of inventing a row', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);

    const out = await call<QueueResult>(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:999'] });

    expect(out.queued).toBe(1);
    expect(out.notInMirror).toStrictEqual(['contacts:999']);
  });

  it('cannot reach another org\'s mirror', async () => {
    await seedMirror(ORG);
    const tools = toolsByName(OTHER);

    const out = await call<QueueResult>(tools.get('queue_lead'), { contact_refs: ['contacts:1'] });

    expect(out.queued).toBe(0);
    expect(out.notInMirror).toStrictEqual(['contacts:1']);
    await expect(db.select().from(leadBriefSchema)).resolves.toHaveLength(0);
  });
});

describe('get_lead_ledger', () => {
  it('leads with a real total, not the page length', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);
    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:2', 'contacts:3'] });

    const out = await call<LedgerResult>(tools.get('get_lead_ledger'), { limit: 1 });

    expect(out.total).toBe(3);
    expect(out.count).toBe(1);
    expect(out.leads[0]!.status).toBe('queued');
    expect(out.leads[0]!.claimCount).toBe(0);
  });

  it('narrows to one lane', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);
    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:2'] });

    const queued = await call<LedgerResult>(tools.get('get_lead_ledger'), { status: 'queued' });
    const review = await call<LedgerResult>(tools.get('get_lead_ledger'), { status: 'ready_for_review' });

    expect(queued.total).toBe(2);
    expect(review.total).toBe(0);
  });

  it('shows nothing from another org', async () => {
    await seedMirror(ORG);
    await call(toolsByName(ORG).get('queue_lead'), { contact_refs: ['contacts:1'] });

    const out = await call<LedgerResult>(toolsByName(OTHER).get('get_lead_ledger'));

    expect(out.total).toBe(0);
  });
});

describe('reconcile_mql_window', () => {
  it('reports full coverage once every arrival is queued', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);
    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:2', 'contacts:3'] });

    const out = await call<ReconcileResult>(tools.get('reconcile_mql_window'), WINDOW);

    // 4 is a lead, 5 arrived before the window — neither is an arrival here.
    expect(out.arrivals).toBe(3);
    expect(out.queued).toBe(3);
    expect(out.gapCount).toBe(0);
  });

  it('names the lead behind a hole punched in the queue', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);
    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:2', 'contacts:3'] });
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:2'));

    const out = await call<ReconcileResult>(tools.get('reconcile_mql_window'), WINDOW);

    expect(out.gapCount).toBe(1);
    expect(out.gaps[0]).toMatchObject({ contactRef: 'contacts:2', contactName: 'Person 2', kind: 'unqueued' });
  });

  it('refuses a stage the CRM does not hold rather than reporting zero gaps', async () => {
    await seedMirror();
    const tools = toolsByName(ORG);

    const out = await call<ReconcileResult>(tools.get('reconcile_mql_window'), {
      ...WINDOW,
      lifecycle_stages: ['MQL'],
    });

    expect(out.error).toBe('unknown_lifecycle_stage');
    expect(out.gapCount).toBeUndefined();
    expect(out.not_found).toStrictEqual(['MQL']);
    expect(out.available_values).toHaveProperty('marketingqualifiedlead');
  });

  it('says the window is a create-date window, not a stage-entry window', async () => {
    await seedMirror();

    const out = await call<ReconcileResult>(toolsByName(ORG).get('reconcile_mql_window'), WINDOW);

    expect(out.note).toContain('not the same as contacts that ENTERED');
  });

  it('resolves the window on the server, so the caller never supplies a date', async () => {
    // The failure this prevents: an agent that thinks today is a week later
    // passes a created_after a week too late and silently reconciles a
    // narrowed window as full coverage.
    await seedMirror();
    const tools = toolsByName(ORG);
    await call(tools.get('queue_lead'), { contact_refs: ['contacts:1', 'contacts:2', 'contacts:3'] });

    const out = await call<ReconcileResult & { window: { since: string | null } }>(
      tools.get('reconcile_mql_window'),
      { lifecycle_stages: ['marketingqualifiedlead'], since_days: 365 },
    );

    // 5 arrived years ago, so a 10-year window sees it and reports it unqueued.
    // Widening the window to a year pulls in the 200-day-old MQL, and the
    // default 7-day window above did not: the bound really is being applied.
    expect(out.arrivals).toBe(4);
    expect(out.gaps.map(g => g.contactRef)).toStrictEqual(['contacts:5']);
    expect(out.window.since).not.toBeNull();
  });

  it('refuses an unparseable date instead of matching everything', async () => {
    await seedMirror();

    const out = await call<{ error?: string }>(toolsByName(ORG).get('reconcile_mql_window'), {
      lifecycle_stages: ['marketingqualifiedlead'],
      created_after: 'last tuesday',
    });

    expect(out.error).toBe('bad_argument');
  });
});

/* ------------------------------------------------------------------ */
/* Brief generation                                                    */
/* ------------------------------------------------------------------ */

type ClaimOut = {
  lead: {
    contactRef: string;
    contactName: string;
    attempt: number;
    attemptsRemaining: number;
    regenerateNote: string | null;
  } | null;
  surfaced: string[];
  waiting: number;
};

type SaveOut = {
  saved?: boolean;
  error?: string;
  status?: string;
  sectionCount?: number;
  claimCount?: number;
  missingCount?: number;
  confidence?: number | null;
  briefVersion?: string | null;
  identity?: { contactName: string; companyName: string | null; entranceSource: string | null; engagementSent: number };
};

type FailureOut = {
  recorded: boolean;
  reason?: string;
  attemptsUsed?: number;
  attemptsRemaining?: number;
  surfacesNext?: boolean;
};

const SECTIONS = [
  { heading: 'Prospect', body: 'Person 1, Ops Lead at Acme.' },
  { heading: 'Recommended Angle', body: 'Ask how estimates get re-keyed.' },
];

const CLAIMS = [
  { text: 'Acme runs 40 crews.', kind: 'Fact', source: 'https://acme.com/about', date: '2026-08-20' },
];

const MISSING = ['Sequence state, replies, calls and meetings are not reachable by this workflow.'];

function saveArgs(contactRef: string, over: Record<string, unknown> = {}) {
  return {
    contact_ref: contactRef,
    sections: SECTIONS,
    claims: CLAIMS,
    missing: MISSING,
    confidence: 0.72,
    skill_version: 1,
    ...over,
  };
}

/**
 * Queue every seeded MQL, which is where a brief always starts from.
 * @param orgId
 */
async function seedQueue(orgId = ORG) {
  await seedMirror(orgId);
  await call(toolsByName(orgId).get('queue_lead'), {
    contact_refs: ['contacts:1', 'contacts:2', 'contacts:3'],
  });
}

/**
 * Move a lead's last attempt back so the retry floor stops blocking it.
 * @param contactRef
 */
async function ageLastAttempt(contactRef: string) {
  await db
    .update(leadBriefSchema)
    .set({ lastAttemptAt: new Date(Date.now() - 3 * 3_600_000) })
    .where(eq(leadBriefSchema.contactRef, contactRef));
}

describe('next_lead_to_brief', () => {
  it('hands out one lead at a time and counts the try in the same breath', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);

    const first = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    expect(first.lead).not.toBeNull();
    expect(first.lead!.attempt).toBe(1);
    expect(first.lead!.attemptsRemaining).toBe(2);
    expect(first.waiting).toBe(2);

    // The count is on the row, not in the agent's head: it moved without the
    // agent reporting anything back.
    const [row] = await db
      .select()
      .from(leadBriefSchema)
      .where(eq(leadBriefSchema.contactRef, first.lead!.contactRef));

    expect(row!.briefAttempts).toBe(1);
    expect(row!.lastAttemptAt).not.toBeNull();
  });

  it('does not hand the same lead out twice inside one run', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);

    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const out = await call<ClaimOut>(tools.get('next_lead_to_brief'));
      seen.add(out.lead!.contactRef);
    }
    const exhausted = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    expect(seen.size).toBe(3);
    // Every lead has spent exactly one try, and none is eligible again yet.
    expect(exhausted.lead).toBeNull();
    expect(exhausted.waiting).toBe(3);
  });

  it('gives a lead three tries and no more', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:2'));
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:3'));

    const attempts: number[] = [];
    for (let run = 0; run < 4; run++) {
      const out = await call<ClaimOut>(tools.get('next_lead_to_brief'));
      if (out.lead) {
        attempts.push(out.lead.attempt);
      }
      await ageLastAttempt('contacts:1');
    }

    expect(attempts).toStrictEqual([1, 2, 3]);
  });

  it('keeps a lead mid-retry off the review screen, then surfaces it with its error', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:2'));
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:3'));

    for (let run = 0; run < 3; run++) {
      await call<ClaimOut>(tools.get('next_lead_to_brief'));
      await call<FailureOut>(tools.get('record_brief_failure'), {
        contact_ref: 'contacts:1',
        error: 'web_search returned "unconfigured" on every query.',
      });

      // Two tries spent is still not a reason to interrupt anyone.
      const [mid] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:1'));

      expect(mid!.status).toBe('queued');

      await ageLastAttempt('contacts:1');
    }

    const final = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    expect(final.surfaced).toStrictEqual(['contacts:1']);
    expect(final.lead).toBeNull();

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:1'));

    expect(row!.status).toBe('ready_for_review');
    expect(row!.briefAttempts).toBe(3);
    expect(row!.skippedReason).toBe('brief-failed');
    expect(row!.briefError).toContain('unconfigured');
    // The retries are over: it is out of the queued lane and never claimed again.
    expect(row!.sections).toStrictEqual([]);
  });

  it('says so plainly when a run that lost the lead reported no error', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:2'));
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:3'));

    for (let run = 0; run < 3; run++) {
      await call<ClaimOut>(tools.get('next_lead_to_brief'));
      await ageLastAttempt('contacts:1');
    }
    await call<ClaimOut>(tools.get('next_lead_to_brief'));

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:1'));

    expect(row!.status).toBe('ready_for_review');
    expect(row!.briefError).toContain('without reporting an error');
  });

  it('never hands out a lead that already carries a brief', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));
    await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(claimed.lead!.contactRef));

    await ageLastAttempt(claimed.lead!.contactRef);
    const refs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const out = await call<ClaimOut>(tools.get('next_lead_to_brief'));
      if (out.lead) {
        refs.push(out.lead.contactRef);
      }
    }

    expect(refs).not.toContain(claimed.lead!.contactRef);
  });

  it('is empty when nothing needs a brief, which is the normal run', async () => {
    const out = await call<ClaimOut>(toolsByName(ORG).get('next_lead_to_brief'));

    expect(out).toMatchObject({ lead: null, waiting: 0, surfaced: [] });
  });

  it('never reaches another org queue', async () => {
    await seedQueue(ORG);

    const out = await call<ClaimOut>(toolsByName(OTHER).get('next_lead_to_brief'));

    expect(out.lead).toBeNull();
    expect(out.waiting).toBe(0);
  });
});

describe('save_lead_brief', () => {
  it('writes the brief and moves the lead to review', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    const out = await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(claimed.lead!.contactRef));

    expect(out).toMatchObject({
      saved: true,
      status: 'ready_for_review',
      sectionCount: 2,
      claimCount: 1,
      missingCount: 1,
      confidence: 0.72,
    });

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, claimed.lead!.contactRef));

    expect(row!.sections).toStrictEqual(SECTIONS);
    expect(row!.claims).toStrictEqual(CLAIMS);
    expect(row!.missing).toStrictEqual(MISSING);
    expect(row!.briefedAt).not.toBeNull();
  });

  it('stamps the row with the skill version behind it', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    const out = await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(claimed.lead!.contactRef, { skill_version: 3 }));

    expect(out.briefVersion).toContain('write-lead-brief-v3');
    // No longer the queue-only stamp: a research pass is behind this row.
    expect(out.briefVersion).not.toContain('queue-only');
  });

  it('cannot change who the lead is, however the brief describes them', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));
    const ref = claimed.lead!.contactRef;

    const out = await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(ref, {
      // Identity is not in the schema, so these are simply not writable.
      contact_name: 'Someone Else',
      company_name: 'A Different Company',
      entrance_source: 'ORGANIC_SEARCH',
      engagement_sent: 99,
    }));

    expect(out.identity).toMatchObject({
      contactName: claimed.lead!.contactName,
      companyName: 'Acme',
      entranceSource: 'PAID_SEARCH',
      engagementSent: 3,
    });

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, ref));

    expect(row!.contactName).toBe(claimed.lead!.contactName);
    expect(row!.companyName).toBe('Acme');
    expect(row!.entranceSource).toBe('PAID_SEARCH');
    expect(row!.engagementSent).toBe(3);
  });

  it('clears a stored error when a later try succeeds', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));
    const ref = claimed.lead!.contactRef;
    await call<FailureOut>(tools.get('record_brief_failure'), { contact_ref: ref, error: 'fetch_url timed out' });

    await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(ref));

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, ref));

    expect(row!.briefError).toBeNull();
    expect(row!.skippedReason).toBeNull();
  });

  it('refuses a ref that is not on the queue rather than writing nothing quietly', async () => {
    await seedQueue();

    const out = await call<SaveOut>(toolsByName(ORG).get('save_lead_brief'), saveArgs('contacts:9999'));

    expect(out.error).toBe('not_on_queue');
    expect(out.saved).toBeUndefined();
  });

  it('never writes into another org queue', async () => {
    await seedQueue(ORG);

    const out = await call<SaveOut>(toolsByName(OTHER).get('save_lead_brief'), saveArgs('contacts:1'));

    expect(out.error).toBe('not_on_queue');

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:1'));

    expect(row!.status).toBe('queued');
  });
});

describe('record_brief_failure', () => {
  it('stores the text without spending a try', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    const out = await call<FailureOut>(tools.get('record_brief_failure'), {
      contact_ref: claimed.lead!.contactRef,
      error: 'crawl_site returned 403 for acme.com',
    });

    expect(out).toMatchObject({ recorded: true, attemptsUsed: 1, attemptsRemaining: 2, surfacesNext: false });

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, claimed.lead!.contactRef));

    expect(row!.briefAttempts).toBe(1);
    expect(row!.briefError).toContain('403');
  });

  it('will not overwrite a written brief with an error', async () => {
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));
    const ref = claimed.lead!.contactRef;
    await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(ref));

    const out = await call<FailureOut>(tools.get('record_brief_failure'), { contact_ref: ref, error: 'too late' });

    expect(out).toMatchObject({ recorded: false, reason: 'not_on_queue' });

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, ref));

    expect(row!.briefError).toBeNull();
    expect(row!.sections).toStrictEqual(SECTIONS);
  });
});

describe('regeneration', () => {
  it('clears the brief, keeps the note, resets the tries and puts the lead back in line', async () => {
    const { regenerateBrief } = await import('@/services/PersonalizationQueueService');
    await seedQueue();
    const tools = toolsByName(ORG);
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));
    const ref = claimed.lead!.contactRef;
    await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(ref));

    const [before] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, ref));
    const result = await regenerateBrief(ORG, { id: before!.id, note: 'The angle is generic. Find something specific.' });

    expect(result.regenerated).toBe(true);

    const [row] = await db.select().from(leadBriefSchema).where(eq(leadBriefSchema.contactRef, ref));

    expect(row!.sections).toStrictEqual([]);
    expect(row!.claims).toStrictEqual([]);
    expect(row!.confidence).toBeNull();
    expect(row!.status).toBe('queued');
    expect(row!.briefAttempts).toBe(0);
    expect(row!.regenerateNote).toContain('Find something specific');
    // Identity survives a rewrite, the same as it survives a re-run.
    expect(row!.contactName).toBe(claimed.lead!.contactName);
    expect(row!.companyName).toBe('Acme');
  });

  it('hands the reviewer instruction to the next pass', async () => {
    const { regenerateBrief } = await import('@/services/PersonalizationQueueService');
    await seedQueue();
    const tools = toolsByName(ORG);
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:2'));
    await db.delete(leadBriefSchema).where(eq(leadBriefSchema.contactRef, 'contacts:3'));
    const claimed = await call<ClaimOut>(tools.get('next_lead_to_brief'));
    await call<SaveOut>(tools.get('save_lead_brief'), saveArgs(claimed.lead!.contactRef));

    const [row] = await db.select().from(leadBriefSchema);
    await regenerateBrief(ORG, { id: row!.id, note: 'Lead with the re-keying angle.' });

    const next = await call<ClaimOut>(tools.get('next_lead_to_brief'));

    expect(next.lead!.contactRef).toBe(claimed.lead!.contactRef);
    expect(next.lead!.attempt).toBe(1);
    expect(next.lead!.regenerateNote).toBe('Lead with the re-keying angle.');
  });

  it('refuses an id from another org queue', async () => {
    const { regenerateBrief } = await import('@/services/PersonalizationQueueService');
    await seedQueue(ORG);
    const [row] = await db.select().from(leadBriefSchema);

    const result = await regenerateBrief(OTHER, { id: row!.id, note: 'not yours' });

    expect(result).toMatchObject({ regenerated: false, reason: 'not_found' });
  });
});
