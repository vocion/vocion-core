/**
 * The team-report module on PGlite — every provenance kind read against
 * seeded rows (HubSpot-shaped synced documents, action_runs with decisions,
 * asks, worker_runs), human load, evidence chains, outcome lineage, and the
 * composed report. Spec: docs/specs/team-report-v2.md.
 */
import { generateKeyPairSync } from 'node:crypto';
import process from 'node:process';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, actionRunSchema, agentBudgetSchema, agentSchema, askSchema, decisionAlignmentSchema, knowledgeDocumentSchema, knowledgeSourceSchema, projectSchema, teamSchema, tenantAccountSchema, trustRuleSchema, userSchema, workerRunSchema } = await import('@/models/Schema');
const { readMeasure, readTeamMeasures } = await import('./provenance');
const { readHumanLoad } = await import('./humanLoad');
const { readOutcomeChains } = await import('./evidence');
const { trace } = await import('./lineage');
const { teamReport, memberReport, controlSummary, inboxHrefFor } = await import('@/services/TeamReportService');
const { resetWebAnalyticsTokenCache } = await import('@/libs/analytics/ga4');

/** A throwaway RSA key so the service-account JWT can be signed without a real credential. */
const TEST_SERVICE_ACCOUNT_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

const WEB_ANALYTICS_MEASURE = {
  key: 'qualified_traffic',
  label: 'Qualified sessions',
  dimension: 'outcome' as const,
  target: 500,
  unit: 'sessions',
  window: '7d' as const,
  direction: 'higher' as const,
  source: { kind: 'verified' as const, connector: 'web-analytics' as const, query: { metric: 'sessions' as const, filter: { pathPrefix: '/docs' } } },
};

/** Put a deployment-level analytics credential in place for the duration of one test. */
function configureAnalytics() {
  process.env.GOOGLE_ANALYTICS_PROPERTY_ID = '100000001';
  process.env.GOOGLE_ANALYTICS_CLIENT_EMAIL = 'reader@example-org.iam.gserviceaccount.com';
  process.env.GOOGLE_ANALYTICS_PRIVATE_KEY = TEST_SERVICE_ACCOUNT_KEY;
}

function unconfigureAnalytics() {
  delete process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
  delete process.env.GOOGLE_ANALYTICS_CLIENT_EMAIL;
  delete process.env.GOOGLE_ANALYTICS_PRIVATE_KEY;
}

/**
 * Mint a token, then answer runReport with `report`.
 * @param report - What GA4 should answer runReport with.
 * @param report.status - HTTP status; 200 when omitted.
 * @param report.body - The JSON body.
 */
function analyticsTransport(report: { status?: number; body?: unknown }) {
  return vi.fn(async (url: string) => {
    if (url.includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'stub-token', expires_in: 3600 }) };
    }
    const status = report.status ?? 200;
    return { ok: status < 400, status, json: async () => report.body ?? {}, text: async () => '' };
  });
}

const ORG = 'proj_tr_v2';
const OTHER_ORG = 'proj_tr_v2_other';
const NOW = new Date('2026-09-15T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const iso = (ms: number) => ago(ms).toISOString();

const CHRIS = { id: 'usr-tr2-chris', name: 'Chris Fitkin', email: 'chris@example.com' };
const LILI = { id: 'usr-tr2-lili', name: 'Lili Chen', email: 'lili@example.com' };
/** A third member, joined in the window before — the prior reading the signups trend compares against. */
const PRIOR = { id: 'usr-tr2-prior', name: 'Earlier Joiner', email: 'earlier@example.com' };
/** The mirror's freshness is judged against the REAL clock inside CrmRecordsService, so the sync time is relative to it. */
const SYNCED_AT = new Date(Date.now() - 30 * 60_000);

type Measure = typeof teamSchema.$inferInsert['measures'];

const GTM_MEASURES: Measure = [
  { key: 'referrals', label: 'Qualified referrals', dimension: 'outcome', target: 4, unit: 'referrals', window: '7d', direction: 'higher', source: { kind: 'human-confirmed', actions: ['gmail.send'] }, contributesTo: 'workspace-goal', weight: 0.5 },
  { key: 'accepted', label: 'Accepted without edit', dimension: 'quality', target: 0.9, unit: '%', window: '7d', direction: 'higher', source: { kind: 'observed', actions: ['gmail.send'] } },
];
const MARKETING_MEASURES: Measure = [
  { key: 'mqls', label: 'MQLs', dimension: 'outcome', target: 4, window: '7d', direction: 'higher', source: { kind: 'verified', connector: 'hubspot', query: { object: 'contacts', filter: { lifecycleStages: ['marketingqualifiedlead'] }, aggregate: 'count' } }, contributesTo: 'workspace-goal', weight: 0.5 },
];
const DEAL_DESK_MEASURES: Measure = [
  { key: 'pitches', label: 'Pitches', dimension: 'outcome', target: 12, window: '7d', direction: 'higher', source: { kind: 'agent-reported', counts: 'pitches' } },
  { key: 'pipeline', label: 'Proposal-stage pipeline', dimension: 'economics', target: 100_000, unit: '$', window: '7d', direction: 'higher', source: { kind: 'verified', connector: 'hubspot', query: { object: 'deals', filter: { dealStages: ['Proposal'] }, aggregate: 'sum(amount)' } } },
  { key: 'runs_with_pitches', label: 'Runs that pitched', dimension: 'velocity', target: 2, window: '7d', direction: 'higher', source: { kind: 'observed', counts: 'pitches' } },
];

async function wipe() {
  await db.delete(accountMembershipSchema);
  await db.delete(decisionAlignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(workerRunSchema);
  await db.delete(agentBudgetSchema);
  await db.delete(trustRuleSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(agentSchema);
  await db.delete(teamSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
}

async function seed() {
  await wipe();
  await db.insert(userSchema).values([CHRIS, LILI, PRIOR]);
  await db.insert(tenantAccountSchema).values({ id: 'acct-tr2', name: 'MetaCTO', slug: 'metacto-tr2' });
  // Signups, as Vocion can honestly observe them: rows in `account_membership`
  // for the account that owns the workspace. Two this week, one the week before.
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-tr2', userId: CHRIS.id, role: 'admin', createdAt: ago(2 * DAY) },
    { accountId: 'acct-tr2', userId: LILI.id, role: 'member', createdAt: ago(5 * DAY) },
    { accountId: 'acct-tr2', userId: PRIOR.id, role: 'member', createdAt: ago(9 * DAY) },
  ]);
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct-tr2', slug: 'revenue', name: 'Revenue Team', leadAgentSlug: 'ceo', accountableUserId: CHRIS.id, goal: 'Create $1.5M of qualified pipeline this quarter.' },
    { id: OTHER_ORG, accountId: 'acct-tr2', slug: 'empty', name: 'Empty' },
  ]);
  await db.insert(teamSchema).values([
    { orgId: ORG, slug: 'founder-gtm', name: 'Founder GTM', leadAgentSlug: 'gtm-lead', goal: 'Turn the founder network into qualified introductions.', accountableUserId: LILI.id, measures: GTM_MEASURES },
    { orgId: ORG, slug: 'marketing', name: 'Marketing', leadAgentSlug: 'mkt-lead', goal: 'Marketing-sourced qualified pipeline.', measures: MARKETING_MEASURES },
    { orgId: ORG, slug: 'deal-desk', name: 'Deal Desk', leadAgentSlug: 'deal-lead', description: 'Proposals, fast.', measures: DEAL_DESK_MEASURES },
    // A row applied before migration 0100 — legacy kpis only.
    { orgId: ORG, slug: 'revops', name: 'RevOps', leadAgentSlug: 'revops-lead', measures: [], kpis: [{ key: 'calls', label: 'Discovery calls', target: 5, source: 'counts.calls', window: '7d' }] },
    { orgId: ORG, slug: 'board', name: 'Board', leadAgentSlug: 'board', measures: [] },
  ]);
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'ceo', name: 'CEO', systemPrompt: 'x', teamSlug: null },
    { orgId: ORG, slug: 'gtm-lead', name: 'Founder GTM Lead', systemPrompt: 'x', teamSlug: 'founder-gtm', accent: 'teal', approvalPolicy: { 'hubspot.update': 'auto' } },
    { orgId: ORG, slug: 'outreach', name: 'Outreach Drafter', systemPrompt: 'x', teamSlug: 'founder-gtm' },
    { orgId: ORG, slug: 'mkt-lead', name: 'Marketing Lead', systemPrompt: 'x', teamSlug: 'marketing' },
    { orgId: ORG, slug: 'deal-lead', name: 'Deal Desk Lead', systemPrompt: 'x', teamSlug: 'deal-desk' },
    { orgId: ORG, slug: 'revops-lead', name: 'RevOps Lead', systemPrompt: 'x', teamSlug: 'revops' },
    { orgId: ORG, slug: 'board', name: 'Board', systemPrompt: 'x', teamSlug: 'board' },
  ]);
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'hubspot.update', threshold: 0.9, enabled: 'true' });
  await db.insert(agentBudgetSchema).values({ orgId: ORG, agentSlug: 'deal-lead', period: 'daily', currentMicroCents: 1_234_000_000, currentTokens: 9000, hardCentsLimit: 5000 });

  // --- HubSpot mirror: one hourly source, synced 30 minutes ago -----------
  const [src] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot', schedule: '0 * * * *' }, lastSyncedAt: SYNCED_AT }).returning({ id: knowledgeSourceSchema.id });
  const doc = (externalId: string, title: string, metadata: Record<string, unknown>) => ({ orgId: ORG, sourceId: src!.id, externalId, title, contentHash: `h-${externalId}`, metadata });
  await db.insert(knowledgeDocumentSchema).values([
    // 3 MQLs this week, 1 last week, 1 lead this week (not an MQL)
    doc('contacts:1', 'Ada', { objectType: 'contacts', hubspotId: '1', lifecycleStage: 'marketingqualifiedlead', createdAt: iso(1 * DAY) }),
    doc('contacts:2', 'Bo', { objectType: 'contacts', hubspotId: '2', lifecycleStage: 'marketingqualifiedlead', createdAt: iso(2 * DAY) }),
    doc('contacts:3', 'Cy', { objectType: 'contacts', hubspotId: '3', lifecycleStage: 'marketingqualifiedlead', createdAt: iso(3 * DAY) }),
    doc('contacts:4', 'Di', { objectType: 'contacts', hubspotId: '4', lifecycleStage: 'marketingqualifiedlead', createdAt: iso(9 * DAY) }),
    doc('contacts:5', 'Ed', { objectType: 'contacts', hubspotId: '5', lifecycleStage: 'lead', createdAt: iso(1 * DAY) }),
    // Proposal-stage deals: 60k + 50k this week; one last week; one at another stage
    doc('deals:901', 'Acme expansion', { objectType: 'deals', hubspotId: '901', dealStageLabel: 'Proposal', dealClosed: 'false', amount: 60_000, createdAt: iso(2 * DAY) }),
    doc('deals:902', 'Globex renewal', { objectType: 'deals', hubspotId: '902', dealStageLabel: 'Proposal', dealClosed: 'false', amount: 50_000, createdAt: iso(4 * DAY) }),
    doc('deals:903', 'Initech pilot', { objectType: 'deals', hubspotId: '903', dealStageLabel: 'Proposal', dealClosed: 'false', amount: 20_000, createdAt: iso(10 * DAY) }),
    doc('deals:904', 'Umbrella', { objectType: 'deals', hubspotId: '904', dealStageLabel: 'Qualified', dealClosed: 'false', amount: 999_999, createdAt: iso(1 * DAY) }),
  ]);

  // --- Proposals + decisions ----------------------------------------------
  const action = (id: number, actionId: string, agent: string, status: string, createdMs: number, extra: Partial<typeof actionRunSchema.$inferInsert> = {}) => ({
    id,
    orgId: ORG,
    actionId,
    input: { to: `p${id}@example.com`, subject: `Intro ${id}` },
    status,
    invokedBy: `agent:${agent}`,
    createdAt: ago(createdMs),
    ...extra,
  });
  await db.insert(actionRunSchema).values([
    // this week — founder-gtm
    action(1, 'gmail.send', 'outreach', 'done', 3 * DAY, { decidedAt: ago(3 * DAY - 10 * 60_000), decidedBy: CHRIS.id, executedAt: ago(3 * DAY - 10 * 60_000), result: { id: 'msg-1' } }),
    action(2, 'gmail.send', 'outreach', 'done', 2 * DAY, { decidedAt: ago(2 * DAY - 20 * 60_000), decidedBy: CHRIS.id, executedAt: ago(2 * DAY - 20 * 60_000) }),
    action(3, 'gmail.send', 'outreach', 'done', 2 * DAY, { decidedAt: ago(2 * DAY - 30 * 60_000), decidedBy: LILI.id, executedAt: ago(2 * DAY - 30 * 60_000) }),
    action(4, 'gmail.send', 'outreach', 'done', 1 * DAY, { decidedAt: ago(1 * DAY - 15 * 60_000), decidedBy: LILI.id, executedAt: ago(1 * DAY - 15 * 60_000) }), // edited
    action(5, 'gmail.send', 'outreach', 'rejected', 1 * DAY, { decidedAt: ago(1 * DAY - 5 * 60_000), decidedBy: CHRIS.id, executedAt: ago(1 * DAY - 5 * 60_000) }),
    action(6, 'gmail.send', 'outreach', 'pending', 2 * HOUR),
    action(7, 'hubspot.update', 'gtm-lead', 'done', 6 * HOUR, { input: { objectType: 'deals', objectId: '901', properties: { dealstage: 'proposal' } }, proposal: { autoApproved: true, autoApprovedThreshold: 0.9, confidence: 0.95, agentSlug: 'gtm-lead' }, executedAt: ago(6 * HOUR - 60_000) }),
    // last week — founder-gtm, 2 approved
    action(8, 'gmail.send', 'outreach', 'done', 9 * DAY, { decidedAt: ago(9 * DAY - 60_000), decidedBy: CHRIS.id, executedAt: ago(9 * DAY - 60_000) }),
    action(9, 'gmail.send', 'outreach', 'done', 10 * DAY, { decidedAt: ago(10 * DAY - 60_000), decidedBy: CHRIS.id, executedAt: ago(10 * DAY - 60_000) }),
    // deal-desk: one proposal approved this week, via proposal.agentSlug rather than invokedBy
    action(10, 'gmail.send', 'nobody', 'done', 1 * DAY, { invokedBy: 'token:abc', proposal: { agentSlug: 'deal-lead', confidence: 0.8 }, decidedAt: ago(1 * DAY - 40 * 60_000), decidedBy: CHRIS.id, executedAt: ago(1 * DAY - 40 * 60_000) }),
  ]);
  const decision = (subjectId: number, subjectKey: string, agentSlug: string, decision: string, decidedAt: Date, decidedBy = CHRIS.id) => ({ orgId: ORG, subjectKind: 'action', subjectKey, subjectId, agentSlug, decision, recommended: 'approve', implicit: true, agreed: decision !== 'rejected', decidedAt, decidedBy });
  await db.insert(decisionAlignmentSchema).values([
    decision(1, 'gmail.send', 'outreach', 'approved', ago(3 * DAY - 10 * 60_000)),
    decision(2, 'gmail.send', 'outreach', 'approved', ago(2 * DAY - 20 * 60_000)),
    decision(3, 'gmail.send', 'outreach', 'approved', ago(2 * DAY - 30 * 60_000), LILI.id),
    decision(4, 'gmail.send', 'outreach', 'edited', ago(1 * DAY - 15 * 60_000), LILI.id),
    decision(5, 'gmail.send', 'outreach', 'rejected', ago(1 * DAY - 5 * 60_000)),
    decision(8, 'gmail.send', 'outreach', 'approved', ago(9 * DAY - 60_000)),
    decision(9, 'gmail.send', 'outreach', 'approved', ago(10 * DAY - 60_000)),
    decision(10, 'gmail.send', 'deal-lead', 'approved', ago(1 * DAY - 40 * 60_000)),
  ]);

  // --- Asks ----------------------------------------------------------------
  await db.insert(askSchema).values([
    { orgId: ORG, kind: 'ruling', title: 'Use the short intro?', agentSlug: 'outreach', status: 'approved', decision: 'approve', createdAt: ago(2 * DAY), decidedAt: ago(2 * DAY - 45 * 60_000), decidedBy: CHRIS.id },
    { orgId: ORG, kind: 'approval', title: 'Send the Acme proposal', teamSlug: 'deal-desk', status: 'open', createdAt: ago(3 * HOUR) },
  ]);

  // --- Worker runs ---------------------------------------------------------
  const run = (agentSlug: string, kind: string, cents: number, tokens: number, createdMs: number, extra: Partial<typeof workerRunSchema.$inferInsert> = {}) => ({
    orgId: ORG,
    agentSlug,
    kind,
    cents,
    tokens,
    status: 'completed',
    createdAt: ago(createdMs),
    claimedAt: ago(createdMs),
    completedAt: ago(createdMs - 12 * 60_000),
    ...extra,
  });
  await db.insert(workerRunSchema).values([
    run('outreach', 'worker', 1200, 30_000, 3 * DAY, { model: 'claude-sonnet-5', summary: 'Drafted 3 intros.' }),
    run('outreach', 'worker', 1000, 25_000, 1 * DAY, { model: 'claude-sonnet-5' }),
    run('gtm-lead', 'lead', 900, 20_000, 2 * DAY, { model: 'claude-opus-5' }),
    run('mkt-lead', 'worker', 700, 15_000, 2 * DAY),
    run('deal-lead', 'worker', 1500, 40_000, 4 * DAY, { counts: { pitches: 6 } }),
    run('deal-lead', 'worker', 1300, 35_000, 1 * DAY, { counts: { pitches: 4 } }),
    run('deal-lead', 'worker', 2000, 50_000, 9 * DAY, { counts: { pitches: 8 } }), // prior window
    run('deal-lead', 'worker', 0, 0, 30 * 60_000, { status: 'paused', completedAt: null }),
    run('revops-lead', 'worker', 400, 8_000, 2 * DAY, { counts: { calls: 3 } }),
    run('board', 'board', 2000, 50_000, 3 * DAY),
    run('ceo', 'lead', 4000, 100_000, 2 * DAY),
  ]);
}

describe('team-report module (PGlite)', () => {
  beforeAll(seed);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    unconfigureAnalytics();
    resetWebAnalyticsTokenCache();
  });

  afterAll(wipe);

  const gtm = { teamSlug: 'founder-gtm', agentSlugs: ['gtm-lead', 'outreach'] };
  const dealDesk = { teamSlug: 'deal-desk', agentSlugs: ['deal-lead'] };

  describe('provenance', () => {
    it('human-confirmed: approve + edit decisions on the named actions, in the window, with the prior window for trend', async () => {
      const r = await readMeasure(ORG, GTM_MEASURES![0]!, gtm, NOW);

      expect(r).toMatchObject({ value: 4, previous: 2, provenance: 'human-confirmed', sourceLabel: 'review decisions', attainment: 1, met: true, delta: 2, trend: 'up', improving: true });
      expect(r.freshness.stale).toBe(false);
    });

    it('human-confirmed asks: decided with anything but a reject, filed by the team or its agents', async () => {
      const r = await readMeasure(ORG, { key: 'rulings', label: 'Rulings', dimension: 'outcome', target: 1, window: '7d', direction: 'higher', source: { kind: 'human-confirmed', askKinds: ['ruling'] } }, gtm, NOW);

      expect(r.value).toBe(1);
    });

    it('observed: executed actions (approved and auto alike) and completed runs carrying a counts key', async () => {
      const executed = await readMeasure(ORG, GTM_MEASURES![1]!, gtm, NOW);

      // 1–4 executed this week; 5 rejected, 6 pending; 7 is hubspot.update, not gmail.send
      expect(executed).toMatchObject({ value: 4, previous: 2, provenance: 'observed', sourceLabel: 'executed actions' });

      const runs = await readMeasure(ORG, DEAL_DESK_MEASURES![2]!, dealDesk, NOW);

      expect(runs).toMatchObject({ value: 2, previous: 1, sourceLabel: 'completed runs', met: true });
    });

    it('agent-reported: Σ counts.<key> — the weakest kind, labelled as the worker\'s own report', async () => {
      const r = await readMeasure(ORG, DEAL_DESK_MEASURES![0]!, dealDesk, NOW);

      expect(r).toMatchObject({ value: 10, previous: 8, provenance: 'agent-reported', sourceLabel: 'worker reports', met: false, delta: 2 });
      expect(r.attainment).toBeCloseTo(10 / 12, 5);
    });

    it('verified: a count and a sum against the HubSpot mirror, created in the window, carrying the mirror\'s freshness', async () => {
      const mqls = await readMeasure(ORG, MARKETING_MEASURES![0]!, { teamSlug: 'marketing', agentSlugs: ['mkt-lead'] }, NOW);

      expect(mqls).toMatchObject({ value: 3, previous: 1, provenance: 'verified', sourceLabel: 'HubSpot', met: false });
      expect(mqls.attainment).toBe(0.75);
      expect(mqls.freshness.stale).toBe(false);
      expect(mqls.asOf?.toISOString()).toBe(SYNCED_AT.toISOString());

      const pipeline = await readMeasure(ORG, DEAL_DESK_MEASURES![1]!, dealDesk, NOW);

      expect(pipeline).toMatchObject({ value: 110_000, previous: 20_000, met: true });
    });

    it('verified: says so when the mirror cannot answer — no source, or a filter value the CRM does not have', async () => {
      const none = await readMeasure(OTHER_ORG, MARKETING_MEASURES![0]!, { teamSlug: 'marketing', agentSlugs: [] }, NOW);

      expect(none.value).toBeNull();
      expect(none.unavailableReason).toMatch(/No HubSpot source/);
      expect(none.attainment).toBeNull();

      const typo = await readMeasure(ORG, { ...MARKETING_MEASURES![0]!, source: { kind: 'verified', connector: 'hubspot', query: { object: 'contacts', filter: { lifecycleStages: ['MQL'] }, aggregate: 'count' } } }, { teamSlug: 'marketing', agentSlugs: [] }, NOW);

      expect(typo.value).toBeNull();
      expect(typo.unavailableReason).toMatch(/lifecycleStage value.*MQL/);
    });

    it('web-analytics: an unconfigured workspace reads as NOT CONNECTED, never as 0', async () => {
      // The whole point of the provenance model. A workspace that has not
      // connected analytics has not been told its traffic is zero — nobody
      // asked. A 0 here would put a measured-looking number on an executive
      // report that no system of record ever produced.
      unconfigureAnalytics();

      const r = await readMeasure(ORG, WEB_ANALYTICS_MEASURE, gtm, NOW);

      expect(r.value).toBeNull();
      expect(r.value).not.toBe(0);
      expect(r.unavailableKind).toBe('unconfigured');
      expect(r.unavailableReason).toMatch(/No web analytics property is connected/);
      expect(r.attainment).toBeNull();
      expect(r.met).toBe(false);
      expect(r.sourceLabel).toBe('Google Analytics');
    });

    it('web-analytics: a configured property reads the figure GA4 returns, with the day-boundary caveat attached', async () => {
      configureAnalytics();
      vi.stubGlobal('fetch', analyticsTransport({ body: { rows: [{ metricValues: [{ value: '412' }] }] } }));

      const r = await readMeasure(ORG, WEB_ANALYTICS_MEASURE, gtm, NOW);

      expect(r).toMatchObject({ value: 412, previous: 412, provenance: 'verified', sourceLabel: 'Google Analytics', unavailableKind: null });
      expect(r.freshness.stale).toBe(false);
      expect(r.freshness.note).toMatch(/whole days in the property's own timezone/);
      expect(r.attainment).toBeCloseTo(412 / 500, 5);
    });

    it('web-analytics: a zero GA4 actually measured is shown as a zero', async () => {
      configureAnalytics();
      vi.stubGlobal('fetch', analyticsTransport({ body: { rows: [] } }));

      const r = await readMeasure(ORG, WEB_ANALYTICS_MEASURE, gtm, NOW);

      expect(r.value).toBe(0);
      expect(r.unavailableKind).toBeNull();
    });

    it('web-analytics: a failed request reads as an ERROR state, never as 0', async () => {
      configureAnalytics();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal('fetch', analyticsTransport({ status: 403 }));

      const r = await readMeasure(ORG, WEB_ANALYTICS_MEASURE, gtm, NOW);

      expect(r.value).toBeNull();
      expect(r.value).not.toBe(0);
      expect(r.unavailableKind).toBe('error');
      expect(r.unavailableReason).toMatch(/Viewer role on the property/);
      expect(r.attainment).toBeNull();
    });

    it('observed rows: people who joined this workspace in the window, scoped through the project\'s account', async () => {
      const measure = { key: 'signups', label: 'Signups', dimension: 'outcome' as const, target: 4, window: '7d' as const, direction: 'higher' as const, source: { kind: 'observed' as const, rows: 'workspace-members' as const } };

      const r = await readMeasure(ORG, measure, gtm, NOW);

      expect(r).toMatchObject({ value: 2, previous: 1, provenance: 'observed', sourceLabel: 'workspace members', unavailableKind: null });
    });

    it('reads every team\'s measures in one pass, keyed team/key', async () => {
      const all = await readTeamMeasures(ORG, [{ ...gtm, measures: GTM_MEASURES! }, { ...dealDesk, measures: DEAL_DESK_MEASURES! }], NOW);

      expect([...all.keys()].sort()).toEqual(['deal-desk/pipeline', 'deal-desk/pitches', 'deal-desk/runs_with_pitches', 'founder-gtm/accepted', 'founder-gtm/referrals']);
    });
  });

  describe('human load', () => {
    it('counts interventions, latency, what needed a person and what is open, per team', async () => {
      const load = await readHumanLoad(ORG, [{ slug: 'founder-gtm', agentSlugs: gtm.agentSlugs }, { slug: 'deal-desk', agentSlugs: dealDesk.agentSlugs }], { since: ago(7 * DAY), until: NOW }, NOW);
      const g = load.get('founder-gtm')!;

      // 7 proposals + 1 ask + 3 runs
      expect(g.workItems).toBe(11);
      expect(g.interventions).toBe(6); // 3 approved + 1 edited + 1 rejected + 1 ask
      expect(g.approvedClean).toBe(3);
      expect(g.approvedEdited).toBe(1);
      expect(g.rejected).toBe(1);
      expect(g.qualityRate).toBe(3 / 5);
      expect(g.decisionLatencyMs).toBe((10 + 20 + 30 + 15 + 5 + 45) * 60_000);
      expect(g.executed).toBe(5);
      expect(g.autoExecuted).toBe(1);
      expect(g.autonomousCompletionRate).toBe(1 / 5);
      // 6 non-auto proposals + the ask
      expect(g.needingDecision).toBe(7);
      expect(g.interventionRate).toBe(7 / 11);
      expect(g.open).toMatchObject({ count: 1, oldestAt: ago(2 * HOUR) });

      const d = load.get('deal-desk')!;

      // 1 proposal (via proposal.agentSlug) + 1 ask (team_slug) + 3 runs in window (2 completed, 1 paused)
      expect(d.workItems).toBe(5);
      expect(d.escalations).toBe(2);
      expect(d.open.count).toBe(2);
      expect(d.turnaroundMedianMs).toBe(12 * 60_000);
    });
  });

  describe('evidence chains', () => {
    it('one line per executed action: what, who decided, what the CRM shows now, and that cost is not attributed', async () => {
      const chains = await readOutcomeChains(ORG, [{ slug: 'founder-gtm', agentSlugs: gtm.agentSlugs }], { since: ago(7 * DAY), until: NOW });
      const g = chains.get('founder-gtm')!;

      expect(g.map(c => c.actionRunId)).toEqual([7, 4, 3, 2, 1]);

      const auto = g[0]!;

      expect(auto.decision.kind).toBe('auto-executed');
      expect(auto.record?.hubspotId).toBe('901');
      expect(auto.externalEvent).toMatchObject({ summary: 'Deal now at Proposal' });
      expect(auto.costCents).toBeNull();

      // Deciders resolve to people, never ids.
      expect(g[1]!.decision).toMatchObject({ kind: 'edited', by: LILI.name });
      expect(g[4]!.decision).toMatchObject({ kind: 'approved', by: CHRIS.name });
      expect(g[4]!.externalEvent).toBeNull();
    });
  });

  describe('outcome lineage', () => {
    it('traces a human-confirmed outcome down to the runs, cost and human minutes, naming the links it cannot make', async () => {
      const f = await trace(ORG, 'founder-gtm', 'referrals', NOW);

      expect(f).not.toBeNull();
      expect(f!.reading.value).toBe(4);

      const by = Object.fromEntries(f!.nodes.map(n => [n.id, n]));

      expect(by.outcomes!.value).toBe(4);
      expect(by.outcomes!.items.map(i => i.id).sort()).toEqual(['action:1', 'action:2', 'action:3', 'action:4']);
      expect(by.approved!.value).toBe(5); // 4 proposals + 1 ask
      expect(by.approved!.items.some(i => i.id.startsWith('ask:'))).toBe(true);
      expect(by.recommendations!.value).toBe(7);
      expect(by.runs!.value).toBe(3);
      expect(by.cost!.value).toBe(1200 + 1000 + 900);
      expect(by.cost!.display).toBe('$31.00');
      expect(by.human!.value).toBe((10 + 20 + 30 + 15 + 5 + 45) * 60_000);
      expect(f!.missing.some(m => /not linked to the run/.test(m))).toBe(true);
    });

    it('an agent-reported outcome lists the runs that reported it and says nothing confirms them', async () => {
      const f = await trace(ORG, 'deal-desk', 'pitches', NOW);
      const outcomes = f!.nodes[0]!;

      expect(outcomes.value).toBe(10);
      expect(outcomes.items).toHaveLength(2);
      expect(outcomes.items[0]!.detail).toMatch(/reported pitches/);
      expect(f!.missing[0]).toMatch(/worker's own claim/);
    });

    it('a verified outcome lists the CRM records behind the count', async () => {
      const f = await trace(ORG, 'marketing', 'mqls', NOW);
      const outcomes = f!.nodes[0]!;

      expect(outcomes.value).toBe(3);
      expect(outcomes.items.map(i => i.title).sort()).toEqual(['Ada', 'Bo', 'Cy']);
      expect(outcomes.items[0]!.href).toMatch(/^\/gtm\/lead\//);
    });

    it('is null for an unknown team or measure', async () => {
      expect(await trace(ORG, 'founder-gtm', 'nope', NOW)).toBeNull();
      expect(await trace(ORG, 'nope', 'referrals', NOW)).toBeNull();
    });
  });

  describe('teamReport (composed)', () => {
    it('is an operating report, not setup, and leads with the headline row', async () => {
      const r = await teamReport(ORG, '7d', NOW);

      expect(r.setup.needed).toBe(false);
      expect(r.workspace).toMatchObject({ name: 'Revenue Team', goal: 'Create $1.5M of qualified pipeline this quarter.' });
      // founder-gtm met (4/4), deal-desk not (10/12), marketing not (3/4); revops legacy 3/5 not; board unmeasured
      expect(r.headline.teamsOnTarget).toEqual({ onTarget: 1, measured: 4 });
      // referrals (w .5, 1.0) + mqls (w .5, .75)
      expect(r.headline.goalProgress).toEqual({ progress: 0.875, measures: 2 });
      expect(r.headline.cents).toBe(1200 + 1000 + 900 + 700 + 1500 + 1300 + 0 + 400 + 2000 + 4000);
      expect(r.headline.needsAttention).toBe(3); // pending action, open ask, paused run
      expect(r.headline.needsAttentionOldestAt).toEqual(ago(3 * HOUR));
      expect(r.headline.humanReviewMs).toBeGreaterThan(0);
      expect(r.headline.autoCompletedRate).not.toBeNull();
    });

    it('each team leads with its primary outcome, then the four dimensions, roster, control and needs-you', async () => {
      const r = await teamReport(ORG, '7d', NOW);
      const g = r.teams.find(t => t.slug === 'founder-gtm')!;

      expect(g.mission).toBe('Turn the founder network into qualified introductions.');
      expect(g.primary).toMatchObject({ measure: { key: 'referrals' }, value: 4, met: true, provenance: 'human-confirmed' });
      expect(g.quality.measure?.measure.key).toBe('accepted');
      expect(g.quality.rate).toBe(3 / 5);
      expect(g.velocity.medianMs).not.toBeNull();
      expect(g.economics.cents).toBe(1200 + 1000 + 900);
      expect(g.economics.costPerOutcomeCents).toBe(3100 / 4);
      expect(g.humanLoad.interventions).toBe(6);
      expect(g.contract.owner).toMatchObject({ email: LILI.email, source: 'team' });
      expect(g.members.map(m => m.slug)).toEqual(['gtm-lead', 'outreach']);
      expect(g.members[0]!.isLead).toBe(true);
      // gmail.send decided (execute-with-approval) + hubspot.update permitted and trusted (execute-within-bounds)
      expect(g.control).toEqual({ actionTypes: 2, autoExecute: 1, approvalRequired: true, topRung: 'execute-within-bounds' });
      expect(g.needsYou).toEqual({ count: 1, oldestAt: ago(2 * HOUR), href: '/dashboard/inbox?agents=gtm-lead%2Coutreach' });
      expect(g.evidence.chains.map(c => c.actionRunId)).toEqual([7, 4, 3, 2, 1]);
      expect(g.evidence.workItems).toBe(11);
    });

    it('reads a legacy kpis-only row as agent-reported measures, and budgets roll up into economics', async () => {
      const r = await teamReport(ORG, '7d', NOW);
      const revops = r.teams.find(t => t.slug === 'revops')!;

      expect(revops.primary).toMatchObject({ measure: { key: 'calls', window: '7d' }, value: 3, provenance: 'agent-reported' });

      const dd = r.teams.find(t => t.slug === 'deal-desk')!;

      expect(dd.primary?.measure.key).toBe('pitches');
      expect(dd.economics.measure?.measure.key).toBe('pipeline');
      expect(dd.economics.budget).toEqual({ spentCents: 1234, limitCents: 5000, variance: 1234 / 5000 - 1 });
      expect(dd.velocity.measure?.measure.key).toBe('runs_with_pitches');

      const board = r.teams.find(t => t.slug === 'board')!;

      expect(board.primary).toBeNull();
      expect(board.contract.attainment).toBeNull();
      expect(board.control).toEqual({ actionTypes: 0, autoExecute: 0, approvalRequired: true, topRung: null });
    });

    it('keeps unassigned agents visible, and flips to setup for a workspace with nothing', async () => {
      const r = await teamReport(ORG, '7d', NOW);

      expect(r.ungrouped.map(m => m.slug)).toEqual(['ceo']);
      expect(r.setup.items.find(i => i.key === 'unassigned')).toMatchObject({ detail: '1' });

      const empty = await teamReport(OTHER_ORG, '7d', NOW);

      expect(empty.setup.needed).toBe(true);
      expect(empty.setup.reasons).toEqual(['no-goal', 'no-measures', 'no-work']);
      expect(empty.teams).toEqual([]);
    });

    it('member detail lists runs newest first with summed counts', async () => {
      const d = await memberReport(ORG, 'deal-lead', { window: '7d', now: NOW });

      expect(d!.team).toMatchObject({ slug: 'deal-desk', mission: 'Proposals, fast.' });
      expect(d!.runs.map(r => r.cents)).toEqual([0, 1300, 1500]);
      expect(d!.counts).toEqual({ pitches: 10 });
      expect(await memberReport(ORG, 'nobody', { now: NOW })).toBeNull();
    });
  });

  describe('helpers', () => {
    it('controlSummary and inboxHrefFor', () => {
      expect(controlSummary([], [], new Map())).toEqual({ actionTypes: 0, autoExecute: 0, approvalRequired: true, topRung: null });
      expect(controlSummary([{ actionId: 'a', rung: 'autonomous', riskTier: 'low', agreementRate: 1, n: 3 }], ['a'], new Map())).toEqual({ actionTypes: 1, autoExecute: 1, approvalRequired: false, topRung: 'autonomous' });
      expect(inboxHrefFor([])).toBe('/dashboard/inbox');
    });
  });
});
