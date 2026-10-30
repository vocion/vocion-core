/**
 * A CLIENT'S SEO AUDIT — what is wrong with their site, read in code, each
 * finding with its evidence, the page it is on and when it was checked.
 *
 * The agency lead's words (2026-10-29): "audit and report, then recommended
 * next steps." A run reads the whole site (the site inventory), the home
 * page's structured data, robots.txt and Google's results for the client's
 * own name, and these checks turn what was read into findings:
 *
 *   technical      pages that did not load, noindex, canonicals pointing
 *                  elsewhere, no sitemap, robots.txt shutting search out,
 *                  not first on Google for its own name
 *   content        missing or duplicate titles, H1s and meta descriptions,
 *                  more than one H1, thin pages
 *   ai_visibility  no Organization schema, one that does not say what the
 *                  business is now (its offering), no sameAs profiles, AI
 *                  answer engines' crawlers blocked
 *   local          (local clients, or a Google Business Profile goal) no
 *                  LocalBusiness schema, no phone or address in it, a place
 *                  served with no page of its own
 *
 * Every run is its own `seo_audit` record (`audits.ts`). A finding is keyed
 * by its check and page (`key`), so a later run carries a person's verdict
 * forward: a dismissed finding stays dismissed, and one a run no longer finds
 * is fixed on the run that found it. Pure: no I/O.
 */

import type { SeoProfile } from './profile';
import type { InventoryRow, SiteInventory } from '@/libs/tools/site/inventory';
import { inventoryIssues } from '@/libs/tools/site/inventory';

export const AUDIT_CATEGORIES = ['technical', 'content', 'ai_visibility', 'local'] as const;
export type AuditCategory = typeof AUDIT_CATEGORIES[number];
export const CATEGORY_LABEL: Record<AuditCategory, string> = { technical: 'Technical', content: 'Content', ai_visibility: 'AI visibility', local: 'Local and Google Business Profile' };

export const AUDIT_SEVERITIES = ['high', 'medium', 'low'] as const;
export type AuditSeverity = typeof AUDIT_SEVERITIES[number];

export const FINDING_STATUSES = ['open', 'fixed', 'dismissed'] as const;
export type FindingStatus = typeof FINDING_STATUSES[number];

/** What a finding's "Fix it" made: a page planned in a batch, or a task on the project. */
export type FindingFix = { kind: 'page' | 'task'; id: number; href: string; at: string };

export type AuditFinding = {
  /** The check and the page: the same finding on every run. */
  key: string;
  check: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  /** What was read that shows it, in words. */
  evidence: string;
  /** The page it is on, when it is one page. */
  url?: string;
  /** The pages it is on, when it is several (at most `URLS_KEPT`). */
  urls?: string[];
  /** When it was read. */
  checkedAt: string;
  status: FindingStatus;
  /** When the status last moved, by whom, and why. */
  statusAt?: string;
  statusBy?: string;
  statusNote?: string;
  /** What "Fix it" made. */
  fix?: FindingFix;
  /** For a page fix: the page this finding suggests. */
  suggestPage?: { keyword: string; pageType: 'location' | 'service' | 'landing' | 'blog'; location?: string };
};

/** Pages named on one finding; the report says how many more. */
export const URLS_KEPT = 25;
/** Words under which a page reads as thin. */
export const THIN_WORDS = 300;

/** Everything one run read. */
export type AuditRead = {
  checkedAt: string;
  inventory: Pick<SiteInventory, 'site' | 'from' | 'rows' | 'listed' | 'cappedAt'>;
  /** The home page's Organization schema (`homepageSchema`), when the home page was read. */
  schema?: { orgTypes: string[]; orgDescription: string | null; orgName: string | null; knowsAbout?: string[]; sameAs: number; telephone: string | null; hasAddress: boolean } | null;
  /** robots.txt as served; null when the site has none; undefined when not read. */
  robots?: string | null;
  /** Google's results for the client's own name. */
  brand?: { query: string; position: number | null; isGoogleRanking: boolean; checkedAt: string } | null;
  profile?: SeoProfile;
  /** The project's name, for the brand search. */
  clientName: string;
};

/** Crawlers of the AI answer engines, by the user agent robots.txt names. */
export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

/**
 * The user agents a robots.txt shuts out of the whole site (`Disallow: /`). Pure.
 * @param robots - The file.
 */
export function robotsBlockedAgents(robots: string): string[] {
  const blocked = new Set<string>();
  let agents: string[] = [];
  let inRules = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value);
    } else if (field === 'disallow' || field === 'allow') {
      inRules = true;
      if (field === 'disallow' && value === '/') {
        agents.forEach(a => blocked.add(a));
      }
    }
  }
  return [...blocked];
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * The site's origin, from the pages it served (an inventory names its site
 * by host). Pure.
 * @param inv - The inventory.
 * @param inv.site
 * @param inv.rows
 */
export function siteOriginOf(inv: { site: string; rows: readonly { url: string }[] }): string {
  for (const r of inv.rows) {
    try {
      return new URL(r.url).origin;
    } catch {}
  }
  return /^https?:\/\//.test(inv.site) ? inv.site.replace(/\/$/, '') : `https://${inv.site}`;
}

/** Words that say nothing about what a business does. */
const FILLER = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'our', 'you', 'are', 'all', 'any', 'into', 'its', 'who', 'what', 'where', 'how', 'company', 'companies', 'business', 'businesses', 'firm', 'service', 'services', 'solution', 'solutions', 'provider', 'providing', 'provides', 'leading', 'best', 'top', 'team', 'beyond', 'help', 'helps', 'we', 'us', 'inc', 'llc', 'ltd', 'one', 'more', 'new', 'and', 'end', 'make', 'makes']);

/**
 * The words that say what a business does, plural endings folded. Pure.
 * @param text - What was written.
 */
export function businessTerms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => (w.length > 2 || w === 'ai') && !FILLER.has(w) && !/^\d+$/.test(w)).map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));
}

/**
 * Whether the Organization schema's description and knowsAbout still say
 * what the business says it is now — its SEO profile's offering and
 * industry, and its home page's title and meta description — and, when they
 * do not, the words that tell. Null when there is too little to compare.
 * A business that changed what it does keeps its old self in its schema long
 * after the page copy moved on, and AI answers read the schema. Pure.
 * @param schema - The Organization schema's description and knowsAbout.
 * @param schema.orgDescription
 * @param schema.knowsAbout
 * @param positioning - What the business says now, each with where it is said.
 */
export function schemaPositioningGap(schema: { orgDescription: string | null; knowsAbout?: string[] }, positioning: ReadonlyArray<{ text: string; from: string }>): { coverage: number; stale: string[]; said: string } | null {
  const own = businessTerms([schema.orgDescription ?? '', ...(schema.knowsAbout ?? [])].join(' '));
  const now = businessTerms(positioning.map(p => p.text).join(' '));
  if (own.size < 3 || now.size < 3) {
    return null;
  }
  const shared = [...own].filter(w => now.has(w));
  const coverage = shared.length / own.size;
  if (coverage >= 0.35) {
    return null;
  }
  const said = positioning.map(p => `${p.from} "${p.text.slice(0, 140)}"`).join('; ');
  return { coverage, stale: [...own].filter(w => !now.has(w)).slice(0, 8), said };
}

const listed = (rows: readonly InventoryRow[]) => rows.map(r => r.url);

/**
 * One finding per check, its pages listed. Pure helper.
 * @param f - The finding without its bookkeeping.
 * @param rows - The pages it is on.
 * @param at - When it was read.
 */
function onPages(f: Omit<AuditFinding, 'key' | 'status' | 'checkedAt' | 'urls' | 'url'>, rows: readonly InventoryRow[] | readonly string[], at: string): AuditFinding | null {
  const urls = (rows as readonly (InventoryRow | string)[]).map(r => (typeof r === 'string' ? r : r.url));
  if (urls.length === 0) {
    return null;
  }
  return {
    ...f,
    key: f.check,
    checkedAt: at,
    status: 'open',
    ...(urls.length === 1 ? { url: urls[0] } : { urls: urls.slice(0, URLS_KEPT) }),
    evidence: urls.length > URLS_KEPT ? `${f.evidence} (${urls.length} pages; the first ${URLS_KEPT} listed)` : f.evidence,
  };
}

/**
 * Every finding one run's reads show. Pure.
 * @param r - What was read.
 */
export function auditFindings(r: AuditRead): AuditFinding[] {
  const at = r.checkedAt;
  const out: Array<AuditFinding | null> = [];
  const rows = r.inventory.rows;
  const issues = inventoryIssues(rows);
  const home = rows.find(x => pathOf(x.url) === '/' || pathOf(x.url) === '');
  const read = rows.filter(x => x.status === 200 && !x.error);
  const origin = siteOriginOf(r.inventory);

  // Technical.
  out.push(onPages({ check: 'not_loaded', category: 'technical', severity: 'high', title: 'Pages that did not load', evidence: `${issues.notRead.length} of ${rows.length} pages the sitemap lists answered with an error or did not answer` }, issues.notRead, at));
  const homeNoindex = home ? issues.noindex.includes(home) : false;
  out.push(onPages({ check: 'noindex', category: 'technical', severity: homeNoindex ? 'high' : 'medium', title: homeNoindex ? 'The home page asks not to be indexed' : 'Pages that ask not to be indexed', evidence: `${issues.noindex.length} pages carry a noindex robots meta tag; check each is meant to stay out of Google` }, issues.noindex, at));
  out.push(onPages({ check: 'canonical_elsewhere', category: 'technical', severity: 'medium', title: 'Canonicals pointing to another page', evidence: `${issues.canonicalElsewhere.length} pages name another URL as their canonical, so Google ranks that one instead` }, issues.canonicalElsewhere, at));
  if (r.inventory.from === 'crawl') {
    out.push({ key: 'no_sitemap', check: 'no_sitemap', category: 'technical', severity: 'medium', title: 'No sitemap', evidence: 'Neither /sitemap.xml nor robots.txt names a sitemap; the pages were found by following links, so pages nothing links to are missing', url: `${origin}/sitemap.xml`, checkedAt: at, status: 'open' });
  }
  const blocked = r.robots ? robotsBlockedAgents(r.robots) : [];
  if (blocked.includes('*')) {
    out.push({ key: 'robots_blocks_all', check: 'robots_blocks_all', category: 'technical', severity: 'high', title: 'robots.txt shuts every crawler out', evidence: 'robots.txt has "User-agent: *" with "Disallow: /"', url: `${origin}/robots.txt`, checkedAt: at, status: 'open' });
  }
  if (r.brand && r.brand.isGoogleRanking && (r.brand.position === null || r.brand.position > 1)) {
    out.push({ key: 'brand_not_first', check: 'brand_not_first', category: 'technical', severity: r.brand.position === null || r.brand.position > 3 ? 'high' : 'medium', title: `Not first on Google for its own name`, evidence: r.brand.position === null ? `Google's first page for "${r.brand.query}" does not show the client's site (read ${r.brand.checkedAt.slice(0, 10)})` : `The client's site is #${r.brand.position} on Google for "${r.brand.query}" (read ${r.brand.checkedAt.slice(0, 10)})`, checkedAt: at, status: 'open' });
  }

  // Content.
  out.push(onPages({ check: 'missing_title', category: 'content', severity: 'high', title: 'Pages with no title', evidence: `${issues.noTitle.length} pages have no <title>` }, issues.noTitle, at));
  out.push(onPages({ check: 'missing_meta', category: 'content', severity: 'medium', title: 'Pages with no meta description', evidence: `${issues.noMeta.length} pages have no meta description, so Google writes the snippet itself` }, issues.noMeta, at));
  out.push(onPages({ check: 'missing_h1', category: 'content', severity: 'medium', title: 'Pages with no H1', evidence: `${issues.noH1.length} pages have no H1` }, issues.noH1, at));
  out.push(onPages({ check: 'many_h1', category: 'content', severity: 'low', title: 'Pages with more than one H1', evidence: `${issues.manyH1.length} pages have two or more H1s` }, issues.manyH1, at));
  for (const [check, groups, what, severity] of [
    ['duplicate_title', issues.duplicateTitles, 'title', 'medium'],
    ['duplicate_meta', issues.duplicateMeta, 'meta description', 'low'],
    ['duplicate_h1', duplicateH1s(read), 'H1', 'medium'],
  ] as const) {
    for (const g of groups) {
      const f = onPages({ check, category: 'content', severity, title: `The same ${what} on ${g.rows.length} pages`, evidence: `"${g.text.slice(0, 120)}" is the ${what} of ${g.rows.length} pages` }, listed(g.rows), at);
      if (f) {
        out.push({ ...f, key: `${check}:${g.text.toLowerCase().slice(0, 80)}` });
      }
    }
  }
  const thin = read.filter(x => typeof x.wordCount === 'number' && x.wordCount < THIN_WORDS && x !== home && !x.noindex);
  out.push(onPages({ check: 'thin', category: 'content', severity: 'low', title: `Thin pages (under ${THIN_WORDS} words)`, evidence: `${thin.length} indexable pages have fewer than ${THIN_WORDS} words of content` }, thin, at));

  // AI visibility: answer engines name a business by what its own site says it is.
  if (r.schema !== undefined) {
    const s = r.schema;
    const homeUrl = home?.url ?? `${origin}/`;
    if (!s || s.orgTypes.length === 0) {
      out.push({ key: 'no_org_schema', check: 'no_org_schema', category: 'ai_visibility', severity: 'high', title: 'No Organization schema on the home page', evidence: 'The home page declares no Organization (or LocalBusiness) structured data, so search and AI answers have no stated name, description or profiles for the business', url: homeUrl, checkedAt: at, status: 'open' });
    } else {
      // What the business says it is now: its profile, and its home page.
      const positioning = [
        ...(r.profile?.offering ? [{ text: r.profile.offering, from: 'the SEO profile\'s offering' }] : []),
        ...(r.profile?.industry ? [{ text: r.profile.industry, from: 'the SEO profile\'s industry' }] : []),
        ...(home?.title ? [{ text: home.title, from: 'the home page\'s title' }] : []),
        ...(home?.metaDescription ? [{ text: home.metaDescription, from: 'the home page\'s meta description' }] : []),
      ];
      const gap = s.orgDescription || s.knowsAbout?.length ? schemaPositioningGap(s, positioning) : null;
      if (!s.orgDescription) {
        out.push({ key: 'org_no_description', check: 'org_no_description', category: 'ai_visibility', severity: 'medium', title: 'The Organization schema does not say what the business does', evidence: `${s.orgTypes.join(', ')} schema has no description`, url: homeUrl, checkedAt: at, status: 'open' });
      }
      if (gap) {
        out.push({
          key: 'org_description_stale',
          check: 'org_description_stale',
          category: 'ai_visibility',
          severity: 'high',
          title: 'The Organization schema describes the business it used to be',
          evidence: `Its ${s.orgDescription ? `description "${s.orgDescription.slice(0, 160)}"` : 'schema'}${s.knowsAbout?.length ? ` and knowsAbout (${s.knowsAbout.slice(0, 8).join(', ')})` : ''} speak of ${gap.stale.join(', ')}, which what the business says now does not (${gap.said}); ${Math.round(gap.coverage * 100)}% of its words match. AI answers read this schema: say what the business is now`,
          url: homeUrl,
          checkedAt: at,
          status: 'open',
        });
      }
      if (s.sameAs === 0) {
        out.push({ key: 'org_no_sameas', check: 'org_no_sameas', category: 'ai_visibility', severity: 'low', title: 'The Organization schema links no profiles', evidence: 'No sameAs links (LinkedIn, Google Business Profile, Crunchbase, social profiles) tie the site to the business elsewhere', url: homeUrl, checkedAt: at, status: 'open' });
      }
    }
  }
  const aiBlocked = AI_CRAWLERS.filter(a => blocked.some(b => b.toLowerCase() === a.toLowerCase()));
  if (aiBlocked.length) {
    out.push({ key: 'ai_crawlers_blocked', check: 'ai_crawlers_blocked', category: 'ai_visibility', severity: 'high', title: 'AI answer engines are shut out', evidence: `robots.txt disallows the whole site to ${aiBlocked.join(', ')}`, url: `${origin}/robots.txt`, checkedAt: at, status: 'open' });
  }

  // Local: for a local client, or one that wants its Google Business Profile.
  const local = r.profile?.clientType === 'local_services' || (r.profile?.goals ?? []).includes('google_business_profile');
  if (local) {
    const homeUrl = home?.url ?? `${origin}/`;
    const isLocalSchema = (r.schema?.orgTypes ?? []).some(t => t !== 'Organization' && t !== 'Corporation');
    if (r.schema !== undefined && !isLocalSchema) {
      out.push({ key: 'no_local_schema', check: 'no_local_schema', category: 'local', severity: 'high', title: 'No LocalBusiness schema', evidence: 'The home page does not declare LocalBusiness (or a subtype such as Plumber or HVACBusiness), which ties the site to the business\'s Google Business Profile', url: homeUrl, checkedAt: at, status: 'open' });
    }
    if (r.schema && isLocalSchema && (!r.schema.telephone || !r.schema.hasAddress)) {
      out.push({ key: 'local_no_nap', check: 'local_no_nap', category: 'local', severity: 'medium', title: 'The business schema has no phone or address', evidence: `It has ${[!r.schema.telephone ? 'no telephone' : null, !r.schema.hasAddress ? 'no address' : null].filter(Boolean).join(' and ')}; the name, address and phone should match the Google Business Profile`, url: homeUrl, checkedAt: at, status: 'open' });
    }
    for (const place of r.profile?.locations ?? []) {
      const city = place.split(',')[0]!.trim();
      const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const has = read.some(x => pathOf(x.url).toLowerCase().includes(slug) || (x.title ?? '').toLowerCase().includes(city.toLowerCase()) || (x.h1 ?? '').toLowerCase().includes(city.toLowerCase()));
      if (city && !has) {
        const service = r.profile?.industry?.split(/[(,]/)[0]?.trim().toLowerCase();
        out.push({ key: `no_location_page:${slug}`, check: 'no_location_page', category: 'local', severity: 'medium', title: `No page for ${city}`, evidence: `The profile says the client serves ${place}; no page's address, title or H1 names it`, checkedAt: at, status: 'open', suggestPage: { keyword: `${service ? `${service} ` : ''}${city.toLowerCase()}`.trim(), pageType: 'location', location: city } });
      }
    }
  }
  return out.filter((f): f is AuditFinding => f !== null);
}

/**
 * H1s used on more than one page. Pure.
 * @param rows - The pages read.
 */
function duplicateH1s(rows: readonly InventoryRow[]): Array<{ text: string; rows: InventoryRow[] }> {
  const by = new Map<string, InventoryRow[]>();
  for (const r of rows) {
    const v = r.h1?.trim();
    if (v) {
      by.set(v.toLowerCase(), [...(by.get(v.toLowerCase()) ?? []), r]);
    }
  }
  return [...by.values()].filter(g => g.length > 1).map(g => ({ text: g[0]!.h1!.trim(), rows: g }));
}

/** What moves a finding. */
export type FindingEvent = { kind: 'dismiss' | 'mark_fixed' | 'reopen' | 'not_found' | 'found_again' };

/**
 * A finding's status after an event, or a refusal in words. Pure.
 *
 * Open findings are fixed (by a person, or by a later run that no longer
 * finds them) or dismissed (a person's call, kept on every later run).
 * Reopening takes either back to open; a fixed finding a later run finds
 * again is open again. Dismissing a fixed one, or fixing a dismissed one, is
 * refused: reopen it first.
 * @param current - The status now.
 * @param e - What happened.
 */
export function nextFindingStatus(current: FindingStatus, e: FindingEvent): FindingStatus | { refused: string } {
  switch (e.kind) {
    case 'dismiss':
      return current === 'open' ? 'dismissed' : current === 'dismissed' ? 'dismissed' : { refused: 'it is fixed; reopen it first' };
    case 'mark_fixed':
      return current === 'open' ? 'fixed' : current === 'fixed' ? 'fixed' : { refused: 'it is dismissed; reopen it first' };
    case 'reopen':
      return 'open';
    case 'not_found':
      return current === 'open' ? 'fixed' : current;
    case 'found_again':
      return current === 'fixed' ? 'open' : current;
  }
}

/**
 * This run's findings with what a person decided on the last run carried
 * forward — a dismissed finding stays dismissed with its note, a fix already
 * made stays linked — and the keys the last run had open that this one no
 * longer finds (fixed on that run). Pure.
 * @param previous - The last run's findings, if any.
 * @param current - This run's findings.
 */
export function carryForward(previous: readonly AuditFinding[] | null | undefined, current: readonly AuditFinding[]): { findings: AuditFinding[]; resolved: string[] } {
  const before = new Map((previous ?? []).map(f => [f.key, f]));
  const findings = current.map((f) => {
    const was = before.get(f.key);
    if (!was) {
      return f;
    }
    return {
      ...f,
      ...(was.status === 'dismissed' ? { status: 'dismissed' as const, statusAt: was.statusAt, statusBy: was.statusBy, statusNote: was.statusNote } : {}),
      ...(was.fix ? { fix: was.fix } : {}),
    };
  });
  const now = new Set(current.map(f => f.key));
  const resolved = (previous ?? []).filter(f => f.status === 'open' && !now.has(f.key)).map(f => f.key);
  return { findings, resolved };
}

const SEVERITY_RANK: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * The open findings in the order to work them: severity first, then what
 * the client's profile puts first (the local findings for a local client or a
 * Google Business Profile goal, the AI-visibility findings when AI answers is
 * a goal). Pure.
 * @param findings - The run's findings.
 * @param profile - The client's SEO profile.
 */
export function workOrder(findings: readonly AuditFinding[], profile?: SeoProfile): AuditFinding[] {
  const goals = profile?.goals ?? [];
  const lead = (c: AuditCategory) => {
    const i = goals.findIndex(g => (c === 'local' && g === 'google_business_profile') || (c === 'ai_visibility' && g === 'ai_answers') || (c === 'content' && (g === 'organic_leads' || g === 'rankings')));
    return i === -1 ? (c === 'local' && profile?.clientType === 'local_services' ? 2 : 9) : i;
  };
  return findings.filter(f => f.status === 'open').sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || lead(a.category) - lead(b.category));
}

/** `bySeverity` counts the OPEN findings, as `high` does (the app home's "High 3 · Medium 5"). */
export type AuditCounts = { total: number; open: number; high: number; fixed: number; dismissed: number; byCategory: Record<AuditCategory, number>; bySeverity: Record<AuditSeverity, number> };

/**
 * The numbers a list and a report lead with. Pure.
 * @param findings - The run's findings.
 */
export function auditCounts(findings: readonly AuditFinding[]): AuditCounts {
  const open = findings.filter(f => f.status === 'open');
  return {
    total: findings.length,
    open: open.length,
    high: open.filter(f => f.severity === 'high').length,
    fixed: findings.filter(f => f.status === 'fixed').length,
    dismissed: findings.filter(f => f.status === 'dismissed').length,
    byCategory: Object.fromEntries(AUDIT_CATEGORIES.map(c => [c, open.filter(f => f.category === c).length])) as Record<AuditCategory, number>,
    bySeverity: Object.fromEntries(AUDIT_SEVERITIES.map(v => [v, open.filter(f => f.severity === v).length])) as Record<AuditSeverity, number>,
  };
}

/**
 * The recommended next steps: the first open findings in work order, each as
 * a line a person acts on. Pure.
 * @param findings - The run's findings.
 * @param profile - The client's SEO profile.
 * @param limit - How many.
 */
export function nextSteps(findings: readonly AuditFinding[], profile?: SeoProfile, limit = 5): string[] {
  return workOrder(findings, profile).slice(0, limit).map(f => `${f.title}${f.url ? ` — ${pathOf(f.url) || '/'}` : f.urls?.length ? ` — ${pathOf(f.urls[0]!) || '/'}${f.urls.length > 1 ? ` + ${f.urls.length - 1} other recorded URLs` : ''}` : ''} (${f.severity}, ${CATEGORY_LABEL[f.category].toLowerCase()})${f.suggestPage ? `: plan a ${f.suggestPage.pageType} page for "${f.suggestPage.keyword}"` : ''}`);
}

/**
 * Where a finding's "Fix it" opens: a chat with the SEO strategist that fixes
 * it with seo_update_findings.
 * @param auditId - The audit record.
 * @param f - The finding.
 */
export function fixHref(auditId: number, f: Pick<AuditFinding, 'key' | 'title'>): string {
  const ask = `Fix this audit finding: "${f.title}" (audit #${auditId}, finding ${f.key}). Plan a page for it or make it a task, whichever fits.`;
  return `/dashboard/chat?ask=${encodeURIComponent(ask)}`;
}

/**
 * The shareable report: who, when, the counts, the recommended next steps,
 * then every finding by category with its severity, evidence, pages, status
 * and its "Fix it". Pure.
 * @param a - The audit.
 * @param a.auditId
 * @param a.projectName
 * @param a.site
 * @param a.checkedAt
 * @param a.findings
 * @param a.profile
 * @param a.pagesRead
 * @param a.listed
 * @param a.inventoryArtifactId
 */
export function renderAuditReport(a: { auditId: number; projectName: string; site: string; checkedAt: string; findings: readonly AuditFinding[]; profile?: SeoProfile; pagesRead: number; listed?: number; inventoryArtifactId?: number | null }): string {
  const c = auditCounts(a.findings);
  const date = a.checkedAt.slice(0, 10);
  const out = [
    `# SEO audit · ${a.projectName} · ${date}`,
    '',
    `${a.site}, read ${date}: ${a.pagesRead} pages${a.listed && a.listed > a.pagesRead ? ` of ${a.listed} listed` : ''}${a.inventoryArtifactId ? ` ([site inventory](/dashboard/artifacts/${a.inventoryArtifactId}))` : ''}, the home page's structured data, robots.txt and Google's results for the client's name.`,
    '',
    `**${c.open} open finding groups, ${c.high} high priority.** ${AUDIT_CATEGORIES.filter(k => c.byCategory[k]).map(k => `${CATEGORY_LABEL[k]} ${c.byCategory[k]}`).join(' · ') || 'Nothing open.'}${c.dismissed ? ` · ${c.dismissed} dismissed` : ''}`,
    '',
  ];
  out.push('A finding group is one check and its recorded affected scope, not a task or a count of affected pages. Creating a task or planning a page does not mark its finding fixed.', '');
  const steps = nextSteps(a.findings, a.profile);
  if (steps.length) {
    out.push('## Recommended next steps', '', ...steps.map((s, i) => `${i + 1}. ${s}`), '');
  }
  for (const cat of AUDIT_CATEGORIES) {
    const list = a.findings.filter(f => f.category === cat).sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
    if (list.length === 0) {
      continue;
    }
    out.push(`## ${CATEGORY_LABEL[cat]}`, '');
    for (const f of list) {
      const pages = f.url ? ` · [${pathOf(f.url) || '/'}](${f.url})` : f.urls?.length ? ` · ${f.urls.slice(0, 5).map(u => `[${pathOf(u) || '/'}](${u})`).join(', ')}${f.urls.length > 5 ? ` and ${f.urls.length - 5} more` : ''}` : '';
      const state = f.status === 'open'
        ? (f.fix ? `[${f.fix.kind === 'page' ? 'planned page linked; finding still open' : 'task linked; finding still open'}](${f.fix.href})` : `[Fix it](${fixHref(a.auditId, f)})`)
        : `${f.status}${f.statusNote ? `: ${f.statusNote}` : ''}`;
      out.push(`- **${f.title}** (${f.severity}) — ${f.evidence}${pages} · ${state}`);
    }
    out.push('');
  }
  if (a.findings.length === 0) {
    out.push('Nothing to fix on the checks this audit runs.', '');
  }
  out.push(`_Checked ${a.checkedAt.slice(0, 16).replace('T', ' ')} UTC. Each finding is read from the site as served on that date._`);
  return out.join('\n');
}
