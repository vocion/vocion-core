/**
 * The SEO audit's checks, in code: what one run's reads make into findings,
 * how a finding's status moves, what a later run carries forward, the order
 * the client's profile puts them in, and the report. Every site is fictional.
 */
import type { AuditFinding, AuditRead } from './audit';
import type { InventoryRow } from '@/libs/tools/site/inventory';
import { describe, expect, it } from 'vitest';
import { auditCounts, auditFindings, carryForward, nextFindingStatus, nextSteps, renderAuditReport, robotsBlockedAgents, schemaPositioningGap, workOrder } from './audit';
import { homepageSchema } from './profilePrefill';

const SITE = 'https://northwind-home.example';
const row = (path: string, over: Partial<InventoryRow> = {}): InventoryRow => ({ url: `${SITE}${path}`, status: 200, title: `Page ${path}`, metaDescription: `About ${path}`, h1: `Heading ${path}`, h1Count: 1, canonical: null, noindex: false, wordCount: 900, schemaTypes: [], ...over });

const ROWS = [
  row('/'),
  row('/furnace-repair', { title: 'Repairs | Northwind', h1: 'Repairs' }),
  row('/ac-repair', { title: 'Repairs | Northwind', h1: 'Repairs' }),
  row('/old', { status: 404, title: null, metaDescription: null, h1: null, h1Count: 0, error: 'HTTP 404' }),
  row('/thanks', { noindex: true, wordCount: 40 }),
  row('/about', { metaDescription: null, wordCount: 120 }),
];

const read = (over: Partial<AuditRead> = {}): AuditRead => ({
  checkedAt: '2026-10-29T10:00:00.000Z',
  inventory: { site: SITE, from: 'sitemap', rows: ROWS, listed: ROWS.length },
  schema: { orgTypes: ['Organization'], orgDescription: 'Heating oil delivery since 1952', orgName: 'Northwind', sameAs: 0, telephone: null, hasAddress: false },
  robots: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n',
  brand: { query: 'Northwind Home Services', position: 4, isGoogleRanking: true, checkedAt: '2026-10-29T10:00:00.000Z' },
  profile: { clientType: 'local_services', goals: ['google_business_profile', 'ai_answers'], industry: 'HVAC (heating and cooling)', offering: 'Furnace and air conditioning repair', locations: ['Springfield, IL', 'Shelbyville'] },
  clientName: 'Northwind Home Services',
  ...over,
});

const byCheck = (fs: AuditFinding[]) => Object.fromEntries(fs.map(f => [f.key, f]));

describe('the checks', () => {
  it('turn one run\'s reads into findings, each with category, severity, evidence, pages and when', () => {
    const f = byCheck(auditFindings(read()));

    expect(f.not_loaded).toMatchObject({ category: 'technical', severity: 'high', url: `${SITE}/old`, checkedAt: '2026-10-29T10:00:00.000Z', status: 'open' });
    expect(f.noindex).toMatchObject({ severity: 'medium', url: `${SITE}/thanks` });
    expect(f.brand_not_first).toMatchObject({ severity: 'high', evidence: expect.stringContaining('#4 on Google for "Northwind Home Services"') });
    expect(f['duplicate_title:repairs | northwind']).toMatchObject({ category: 'content', urls: [`${SITE}/furnace-repair`, `${SITE}/ac-repair`] });
    expect(f['duplicate_h1:repairs']).toBeDefined();
    expect(f.missing_meta).toMatchObject({ url: `${SITE}/about` });
    // A noindex page is not counted thin; a short indexable one is.
    expect(f.thin).toMatchObject({ url: `${SITE}/about` });
    expect(f.org_description_stale).toMatchObject({ category: 'ai_visibility', evidence: expect.stringContaining('Heating oil delivery since 1952') });
    expect(f.org_no_sameas).toBeDefined();
    expect(f.ai_crawlers_blocked).toMatchObject({ severity: 'high', evidence: 'robots.txt disallows the whole site to GPTBot' });
    expect(f.no_local_schema).toMatchObject({ category: 'local', severity: 'high' });
    expect(f['no_location_page:springfield']).toMatchObject({ suggestPage: { keyword: 'hvac springfield', pageType: 'location', location: 'Springfield' } });
    expect(f['no_location_page:shelbyville']).toBeDefined();
  });

  it('say nothing about what was not read, and run the local checks only for a local client', () => {
    const f = byCheck(auditFindings(read({ schema: undefined, robots: undefined, brand: null, profile: { clientType: 'b2b_saas', goals: ['organic_leads'] } })));

    expect(Object.keys(f).filter(k => /org_|no_local|location|ai_crawlers|brand/.test(k))).toEqual([]);
  });

  it('read the home page\'s Organization schema, and robots.txt groups', () => {
    const s = homepageSchema(`<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"HVACBusiness","name":"Northwind","description":"Furnace repair","telephone":"+1 555 0100","address":{"streetAddress":"1 Main St"},"sameAs":["https://social.example/northwind"]}]}</script>`);

    expect(s).toEqual({ orgTypes: ['HVACBusiness'], orgDescription: 'Furnace repair', orgName: 'Northwind', knowsAbout: [], sameAs: 1, telephone: '+1 555 0100', hasAddress: true });
    expect(robotsBlockedAgents('User-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /\nUser-agent: *\nDisallow: /admin\n')).toEqual(['ClaudeBot', 'CCBot']);
    expect(byCheck(auditFindings(read({ robots: 'User-agent: *\nDisallow: /' }))).robots_blocks_all).toMatchObject({ severity: 'high' });
  });
});

describe('the Organization schema against what the business says now', () => {
  // A firm that moved from building apps to AI consulting: its page copy says
  // so, its JSON-LD still describes the app studio (a real session, 2026-10-29).
  const STALE = `<script type="application/ld+json">{"@type":"Organization","name":"Harborline","description":"AI-enabled mobile app development company providing design, strategy, and development from concept to launch, and beyond.","knowsAbout":["Mobile App Development","AI","React Native","iOS Development","Android Development","Product Strategy"],"sameAs":["https://social.example/harborline"]}</script>`;
  const home = (over: Partial<InventoryRow> = {}) => [row('/', { title: 'Harborline | AI Acceleration Partner for Mid-Market Companies', metaDescription: 'Harborline is the AI acceleration partner for mid-market companies. Senior engineers find where AI pays off, build it, and run it.', ...over })];

  it('flags a description and knowsAbout that describe the business it used to be, with the words that tell, with or without a profile', () => {
    const schema = homepageSchema(STALE);

    expect(schema.knowsAbout).toEqual(['Mobile App Development', 'AI', 'React Native', 'iOS Development', 'Android Development', 'Product Strategy']);

    for (const profile of [undefined, { offering: 'AI consulting and engineering for mid-market operations teams' }]) {
      const f = byCheck(auditFindings(read({ inventory: { site: SITE, from: 'sitemap', rows: home(), listed: 1 }, schema, profile, robots: undefined, brand: null })));

      expect(f.org_description_stale).toMatchObject({ category: 'ai_visibility', severity: 'high', url: `${SITE}/` });
      expect(f.org_description_stale!.evidence).toMatch(/^Its description "AI-enabled mobile app development company.*" and knowsAbout \(Mobile App Development, AI, React Native/);
      expect(f.org_description_stale!.evidence).toMatch(/speak of .*mobile.*app.*development/);
      expect(f.org_description_stale!.evidence).toMatch(/the home page's meta description "Harborline is the AI acceleration partner/);
    }
  });

  it('stays quiet when the schema says what the page says', () => {
    const fresh = homepageSchema('<script type="application/ld+json">{"@type":"Organization","description":"The AI acceleration partner for mid-market companies: senior engineers who find where AI pays off, build it and run it.","knowsAbout":["AI acceleration","AI engineering"],"sameAs":["https://social.example/h"]}</script>');

    expect(byCheck(auditFindings(read({ inventory: { site: SITE, from: 'sitemap', rows: home(), listed: 1 }, schema: fresh, profile: undefined, robots: undefined, brand: null }))).org_description_stale).toBeUndefined();
    expect(schemaPositioningGap({ orgDescription: 'Repairs', knowsAbout: [] }, [{ text: 'Plumbing repairs in Fairview', from: 'x' }])).toBeNull();
  });
});

describe('a finding\'s status', () => {
  it('moves open → fixed or dismissed, and back only by reopening', () => {
    expect(nextFindingStatus('open', { kind: 'dismiss' })).toBe('dismissed');
    expect(nextFindingStatus('open', { kind: 'mark_fixed' })).toBe('fixed');
    expect(nextFindingStatus('open', { kind: 'not_found' })).toBe('fixed');
    expect(nextFindingStatus('dismissed', { kind: 'not_found' })).toBe('dismissed');
    expect(nextFindingStatus('fixed', { kind: 'found_again' })).toBe('open');
    expect(nextFindingStatus('fixed', { kind: 'dismiss' })).toEqual({ refused: 'it is fixed; reopen it first' });
    expect(nextFindingStatus('dismissed', { kind: 'mark_fixed' })).toEqual({ refused: 'it is dismissed; reopen it first' });
    expect(nextFindingStatus('dismissed', { kind: 'reopen' })).toBe('open');
  });

  it('carries a person\'s verdict and a fix to the next run, and resolves what the next run no longer finds', () => {
    const first = auditFindings(read()).map(f => (f.key === 'thin' ? { ...f, status: 'dismissed' as const, statusNote: 'landing pages are short on purpose', statusBy: 'usr-mara' } : f.key === 'not_loaded' ? { ...f, fix: { kind: 'task' as const, id: 9, href: '/dashboard/inbox/9', at: 'x' } } : f));
    const second = auditFindings(read({ robots: 'User-agent: *\nAllow: /', checkedAt: '2026-11-05T10:00:00.000Z' }));
    const { findings, resolved } = carryForward(first, second);
    const f = byCheck(findings);

    expect(f.thin).toMatchObject({ status: 'dismissed', statusNote: 'landing pages are short on purpose', checkedAt: '2026-11-05T10:00:00.000Z' });
    expect(f.not_loaded!.fix).toMatchObject({ kind: 'task', id: 9 });
    expect(resolved).toEqual(['ai_crawlers_blocked']);
  });
});

describe('the order of work and the report', () => {
  it('puts high first, then what the client\'s goals put first', () => {
    const order = workOrder(auditFindings(read()), read().profile).map(f => f.key);

    expect(order.slice(0, 3)).toEqual(['no_local_schema', 'org_description_stale', 'ai_crawlers_blocked']);
    expect(nextSteps(auditFindings(read()), read().profile)[0]).toBe('No LocalBusiness schema — / (high, local and google business profile)');
  });

  it('reports the counts, the next steps and each finding with its Fix it, or what fixed it', () => {
    const findings = auditFindings(read()).map(f => (f.key === 'not_loaded' ? { ...f, fix: { kind: 'task' as const, id: 9, href: '/dashboard/inbox/9', at: 'x' } } : f));
    const md = renderAuditReport({ auditId: 42, projectName: 'Northwind Home Services', site: SITE, checkedAt: '2026-10-29T10:00:00.000Z', findings, profile: read().profile, pagesRead: 6, listed: 6, inventoryArtifactId: 7 });
    const c = auditCounts(findings);

    expect(md).toContain('# SEO audit · Northwind Home Services · 2026-10-29');
    expect(md).toContain(`**${c.open} open finding groups, ${c.high} high priority.**`);
    expect(md).toContain('## Recommended next steps');
    expect(md).toContain('[task linked; finding still open](/dashboard/inbox/9)');
    expect(md).toMatch(/\[Fix it\]\(\/dashboard\/chat\?ask=Fix%20this%20audit%20finding.*audit%20%2342/);
    expect(md).toContain('[site inventory](/dashboard/artifacts/7)');
  });
});
