/**
 * A CLIENT'S SEO PROFILE — what kind of client this is and what they want
 * from search, as typed fields on their Project (`meta.seoProfile`).
 *
 * An agency SEO lead, on her first session (2026-10-29): "whenever you
 * onboard … you get to choose what kind of client it is, because if it's a
 * services client, we will do Google Business Profile SEO for them … B2B
 * SaaS, services, their SEO needs differ." The client type and the ranked
 * goals are what decide which work comes first: a local services client gets
 * Google Business Profile work and location pages, a B2B SaaS client
 * use-case, comparison and integration pages, and a client who wants to be
 * named in AI answers gets tracked prompts and pages worth citing
 * ({@link seoPriorities}). The bundle every SEO seat reads prints them
 * (`renderSeoProfile`), so the strategist's plan is weighted by them.
 *
 * Free-form voice, rules and guidelines stay where they are (the project's
 * voice block, Instructions, Wiki and its ⭐⭐⭐ guideline documents): the
 * profile links them, it never copies them.
 *
 * Never written silently: onboarding pre-fills it from the client's site and
 * puts it in front of a person as ONE card they edit and save
 * (`seo.save_profile`); on the project page a person edits it in place. No
 * agent write path takes it (`PERSON_ONLY_FIELDS`).
 *
 * Pure and light (zod only): the project page, the action and the tools all
 * import it.
 */

import { z } from 'zod';

export const SEO_CLIENT_TYPES = ['b2b_saas', 'local_services', 'ecommerce', 'other'] as const;
export type SeoClientType = typeof SEO_CLIENT_TYPES[number];

export const CLIENT_TYPE_LABEL: Record<SeoClientType, string> = {
  b2b_saas: 'B2B SaaS',
  local_services: 'Local services',
  ecommerce: 'Ecommerce',
  other: 'Other',
};

export const SEO_GOALS = ['organic_leads', 'google_business_profile', 'ai_answers', 'rankings', 'other'] as const;
export type SeoGoal = typeof SEO_GOALS[number];

export const GOAL_LABEL: Record<SeoGoal, string> = {
  organic_leads: 'Organic leads',
  google_business_profile: 'Google Business Profile',
  ai_answers: 'Named in AI answers',
  rankings: 'Rankings',
  other: 'Other',
};

/** The profile's fields, in the order a person reads them. */
export const SEO_PROFILE_FIELDS = ['clientType', 'industry', 'goals', 'offering', 'audience', 'locations', 'language', 'tone', 'competitors', 'website', 'publishTarget', 'guidelines'] as const;
export type SeoProfileField = typeof SEO_PROFILE_FIELDS[number];

export const FIELD_LABEL: Record<SeoProfileField, string> = {
  clientType: 'Client type',
  industry: 'Industry',
  goals: 'Goals',
  offering: 'Offering',
  audience: 'Audience',
  locations: 'Locations',
  language: 'Language',
  tone: 'Tone',
  competitors: 'Competitors',
  website: 'Website',
  publishTarget: 'Publishes to',
  guidelines: 'Guidelines',
};

export type GuidelineLink = { label: string; href: string };

export type SeoProfile = {
  clientType?: SeoClientType;
  industry?: string;
  /** Most important first. */
  goals?: SeoGoal[];
  /** What the client sells, in a line. */
  offering?: string;
  /** Who buys it. */
  audience?: string;
  /** The cities or service areas a local client serves. */
  locations?: string[];
  /** The language its pages are written in (`en-US`, `fr`). */
  language?: string;
  /** The tone in a few words; the sourced voice block is the full version. */
  tone?: string;
  /** Competitor domains. */
  competitors?: string[];
  /** The client's site, as an origin. */
  website?: string;
  /** The id of one of the project's publish targets, where its pages ship by default. */
  publishTarget?: string;
  /** Links to the pages that hold the client's voice, rules and guidelines. */
  guidelines?: GuidelineLink[];
  /** Where a pre-filled value was read, by field: a page URL or "the project's competitors". */
  evidence?: Partial<Record<SeoProfileField, string>>;
  /** When and by whom it was last saved. */
  savedAt?: string;
  savedBy?: string;
};

const text = (max: number) => z.string().trim().max(max);

/** The profile as a person or a card sends it. Lenient on blanks; `cleanSeoProfile` settles them. */
export const seoProfileSchema = z.object({
  clientType: z.enum(SEO_CLIENT_TYPES).optional(),
  industry: text(120).optional(),
  goals: z.array(z.enum(SEO_GOALS)).max(SEO_GOALS.length).optional(),
  offering: text(400).optional(),
  audience: text(300).optional(),
  locations: z.array(text(120)).max(50).optional(),
  language: text(40).optional(),
  tone: text(200).optional(),
  competitors: z.array(text(200)).max(30).optional(),
  website: text(300).optional(),
  publishTarget: text(120).optional(),
  guidelines: z.array(z.object({ label: text(120), href: text(500) })).max(20).optional(),
  evidence: z.record(z.string(), z.string().max(500)).optional(),
});

export type SeoProfileInput = z.infer<typeof seoProfileSchema>;

/**
 * A domain as compared: lowercase, no scheme, no `www.`, no path. Empty when
 * it is not one.
 * @param raw - A domain or URL.
 */
export function domainOf(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) {
    return '';
  }
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `https://${s}`).hostname;
    return host.replace(/^www\./, '').includes('.') ? host.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/**
 * A site as an origin (`https://northwind-home.example`), or empty.
 * @param raw - A domain or URL.
 */
export function websiteOf(raw: string): string {
  const s = raw.trim();
  if (!s) {
    return '';
  }
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return url.hostname.includes('.') ? url.origin : '';
  } catch {
    return '';
  }
}

const uniq = <T>(list: readonly T[], key: (t: T) => string = t => String(t).toLowerCase()): T[] => {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = key(t);
    if (!k || seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
};

/**
 * A profile with blanks dropped, goals de-duplicated in their order,
 * competitors as domains, the website as an origin and every guideline a
 * real link. Never invents a value. Pure.
 * @param input - The profile as given.
 */
export function cleanSeoProfile(input: SeoProfileInput | SeoProfile): SeoProfile {
  const out: SeoProfile = {};
  const str = (v: string | undefined) => (v ?? '').trim();
  if (input.clientType && (SEO_CLIENT_TYPES as readonly string[]).includes(input.clientType)) {
    out.clientType = input.clientType;
  }
  for (const k of ['industry', 'offering', 'audience', 'language', 'tone', 'publishTarget'] as const) {
    const v = str(input[k]);
    if (v) {
      out[k] = v;
    }
  }
  const goals = uniq((input.goals ?? []).filter(g => (SEO_GOALS as readonly string[]).includes(g)));
  if (goals.length) {
    out.goals = goals;
  }
  const locations = uniq((input.locations ?? []).map(l => l.trim()).filter(Boolean));
  if (locations.length) {
    out.locations = locations;
  }
  const competitors = uniq((input.competitors ?? []).map(domainOf).filter(Boolean));
  if (competitors.length) {
    out.competitors = competitors;
  }
  const website = websiteOf(input.website ?? '');
  if (website) {
    out.website = website;
  }
  const guidelines = uniq((input.guidelines ?? []).map(g => ({ label: g.label.trim(), href: g.href.trim() })).filter(g => g.label && /^(?:\/|https?:\/\/)/i.test(g.href)), g => g.href.toLowerCase());
  if (guidelines.length) {
    out.guidelines = guidelines;
  }
  const evidence = Object.fromEntries(Object.entries(input.evidence ?? {}).filter(([k, v]) => (SEO_PROFILE_FIELDS as readonly string[]).includes(k) && typeof v === 'string' && v.trim()));
  if (Object.keys(evidence).length) {
    out.evidence = evidence as SeoProfile['evidence'];
  }
  if ('savedAt' in input && input.savedAt) {
    out.savedAt = input.savedAt;
  }
  if ('savedBy' in input && input.savedBy) {
    out.savedBy = input.savedBy;
  }
  return out;
}

/** What the client's site says about it, read off its home page and inventory (`profilePrefill.ts`). */
export type SiteSignals = {
  /** The page's `<html lang>`. */
  lang?: string | null;
  /** The home page's title and meta description. */
  title?: string | null;
  description?: string | null;
  /** schema.org types the home page declares. */
  schemaTypes?: string[];
  /** Places its schema names: an address's locality and region, `areaServed`. */
  places?: string[];
  /** Every URL the site inventory listed. */
  urls?: string[];
  /** The home page's URL. */
  homepage?: string;
};

/** schema.org types that make a business local (LocalBusiness and its common subtypes). */
const LOCAL_TYPES = /^(?:LocalBusiness|HomeAndConstructionBusiness|ProfessionalService|HVACBusiness|Plumber|Electrician|RoofingContractor|GeneralContractor|HousePainter|Locksmith|MovingCompany|AutoRepair|AutomotiveBusiness|Dentist|MedicalClinic|Physician|LegalService|Attorney|AccountingService|FinancialService|RealEstateAgent|Restaurant|FoodEstablishment|HealthAndBeautyBusiness|BeautySalon|DaySpa|ChildCare|EmergencyService|CleaningService|PestControl|LandscapingBusiness|Store)$/;
const SAAS_TYPES = /^(?:SoftwareApplication|WebApplication|SaaS)$/;
const COMMERCE_TYPES = /^(?:Product|ProductGroup|Offer|AggregateOffer|OfferCatalog|ItemList|OnlineStore)$/;

const SAAS_PATHS = /\/(?:pricing|integrations?|demo|book-a-demo|request-a-demo|docs|developers|api|changelog|features|use-cases|solutions|compare|vs|alternatives|signup|sign-up|login|free-trial|trial)(?:\/|$)/i;
const COMMERCE_PATHS = /\/(?:products?|collections?|shop|store|cart|checkout|category|catalog)(?:\/|$)/i;
const LOCAL_PATHS = /\/(?:locations?|service-areas?|areas-we-serve|areas-served|near-me|cities|our-locations)(?:\/|$)/i;

/**
 * Which kind of client the site reads as, and why — or null when it gives no
 * clear signal. Schema the home page declares is strongest; the inventory's
 * paths count when two or more of a kind agree. Pure.
 * @param s - The site's signals.
 */
export function detectClientType(s: SiteSignals): { type: SeoClientType; why: string } | null {
  const types = s.schemaTypes ?? [];
  const local = types.filter(t => LOCAL_TYPES.test(t));
  if (local.length) {
    return { type: 'local_services', why: `the home page declares ${local.join(', ')} schema` };
  }
  const saas = types.filter(t => SAAS_TYPES.test(t));
  if (saas.length) {
    return { type: 'b2b_saas', why: `the home page declares ${saas.join(', ')} schema` };
  }
  const paths = (s.urls ?? []).map((u) => {
    try {
      return new URL(u).pathname;
    } catch {
      return '';
    }
  });
  const count = (re: RegExp) => uniq(paths.filter(p => re.test(p)).map(p => p.match(re)![0].replace(/\/$/, '')));
  const scores: Array<{ type: SeoClientType; hits: string[] }> = [
    { type: 'ecommerce', hits: [...count(COMMERCE_PATHS), ...types.filter(t => COMMERCE_TYPES.test(t))] },
    { type: 'b2b_saas', hits: count(SAAS_PATHS) },
    { type: 'local_services', hits: count(LOCAL_PATHS) },
  ];
  const best = scores.sort((a, b) => b.hits.length - a.hits.length)[0]!;
  if (best.hits.length >= 2 && best.hits.length > (scores[1]?.hits.length ?? 0)) {
    return { type: best.type, why: `the site has ${best.hits.slice(0, 4).join(', ')}` };
  }
  if ((s.places ?? []).length > 0) {
    return { type: 'local_services', why: `the home page's schema names ${s.places!.slice(0, 3).join(', ')}` };
  }
  return null;
}

/**
 * The goals a client of this kind usually ranks first — a suggestion on the
 * card, the person's to reorder. Pure.
 * @param type - The client type.
 */
export function suggestedGoals(type: SeoClientType | undefined): SeoGoal[] {
  switch (type) {
    case 'local_services':
      return ['google_business_profile', 'organic_leads'];
    case 'b2b_saas':
      return ['organic_leads', 'ai_answers'];
    case 'ecommerce':
      return ['rankings', 'organic_leads'];
    default:
      return ['organic_leads'];
  }
}

/** What the project already holds that a profile reads. */
export type ProfileProjectFacts = {
  id: number;
  domains?: string[];
  competitors?: string[];
  publishTargets?: Array<{ id: string }>;
  /** The project's wiki has text. */
  hasWiki?: boolean;
  /** Guideline documents filed at ⭐⭐⭐, with where each opens. */
  guidelineDocs?: GuidelineLink[];
  /** Its voice block's tone words. */
  voiceTone?: string[];
};

/**
 * Links to where the client's voice, rules and guidelines live: the project's
 * Instructions and Wiki, and each guideline document. Pure.
 * @param p - The project's facts.
 */
export function projectGuidelineLinks(p: ProfileProjectFacts): GuidelineLink[] {
  const base = `/dashboard/projects/${p.id}`;
  return [
    { label: 'Instructions', href: `${base}#instructions` },
    ...(p.hasWiki ? [{ label: 'Wiki', href: `${base}#wiki` }] : []),
    ...(p.guidelineDocs ?? []),
  ];
}

/**
 * The profile as the site and the project say it, before anyone reads the
 * pages: the website, the language, places, the client type with why, the
 * goals such a client usually ranks, the competitors Google showed, the
 * publish target the project has, and links to its guidelines. Every value
 * says where it came from (`evidence`). Fields only a reader can fill
 * (industry, offering, audience, tone) are the agent's, from the pages it
 * read; the home page's description is a starting offering. Pure.
 * @param project - What the project holds.
 * @param site - What the site says.
 */
export function prefillSeoProfile(project: ProfileProjectFacts, site: SiteSignals): SeoProfile {
  const evidence: Partial<Record<SeoProfileField, string>> = {};
  const out: SeoProfile = {};
  const website = websiteOf(site.homepage ?? project.domains?.[0] ?? '');
  if (website) {
    out.website = website;
    evidence.website = site.homepage ? `the home page, ${site.homepage}` : 'the project\'s domain';
  }
  if (site.lang?.trim()) {
    out.language = site.lang.trim();
    evidence.language = 'the home page\'s language tag';
  }
  const detected = detectClientType(site);
  if (detected) {
    out.clientType = detected.type;
    evidence.clientType = detected.why;
  }
  out.goals = suggestedGoals(out.clientType);
  evidence.goals = out.clientType ? `what a ${CLIENT_TYPE_LABEL[out.clientType]} client usually ranks first: reorder them` : 'a starting point: reorder them';
  if (site.places?.length && out.clientType === 'local_services') {
    out.locations = uniq(site.places);
    evidence.locations = 'the home page\'s schema (address and area served)';
  }
  if (site.description?.trim()) {
    out.offering = site.description.trim();
    evidence.offering = 'the home page\'s meta description';
  }
  if (project.voiceTone?.length) {
    out.tone = project.voiceTone.join(', ');
    evidence.tone = 'the project\'s voice block';
  }
  if (project.competitors?.length) {
    out.competitors = project.competitors;
    evidence.competitors = 'the domains Google ranked beside the client';
  }
  const target = project.publishTargets?.[0];
  if (target) {
    out.publishTarget = target.id;
    evidence.publishTarget = 'the project\'s first publish target';
  }
  out.guidelines = projectGuidelineLinks(project);
  out.evidence = evidence;
  return cleanSeoProfile(out);
}

/**
 * The agent's reading laid over the prefill: a value the agent read off the
 * client's pages wins, and its evidence is the agent's. Pure.
 * @param base - The prefill.
 * @param read - What the agent read, with where (`evidence`).
 */
export function overlayProfile(base: SeoProfile, read: SeoProfileInput): SeoProfile {
  const merged: SeoProfile = { ...base, evidence: { ...base.evidence } };
  for (const k of SEO_PROFILE_FIELDS) {
    const v = read[k];
    const empty = v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
    if (empty) {
      continue;
    }
    (merged as Record<string, unknown>)[k] = v;
    merged.evidence![k] = read.evidence?.[k] ?? 'read off the client\'s pages';
  }
  return cleanSeoProfile(merged);
}

/** Fields worth a person's attention when they are empty. */
const WANTED: readonly SeoProfileField[] = ['clientType', 'industry', 'goals', 'offering', 'audience', 'language', 'tone', 'website'];

/**
 * The fields still empty, in reading order. Locations count only for a local
 * client. Pure.
 * @param p - The profile.
 */
export function missingFields(p: SeoProfile): SeoProfileField[] {
  const wanted = p.clientType === 'local_services' ? [...WANTED.slice(0, 5), 'locations' as const, ...WANTED.slice(5)] : WANTED;
  return wanted.filter((k) => {
    const v = p[k];
    return v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim());
  });
}

/** The SEO app's playbooks by name (`templates/plugins/seo/playbooks/`), the agency's way of working. */
export const SEO_PLAYBOOK_LABEL: Record<string, string> = {
  'how-we-brief-a-page': 'How we brief a page',
  'location-pages-without-doorways': 'Location pages without doorways',
  'sourcing-and-claims': 'Sourcing and claims',
  'on-page-checklist': 'On-page checklist',
  'internal-linking': 'Internal linking',
};

/**
 * The playbooks to lead with for this client, each with its name, where an
 * agent reads it and where a person opens it. Pure.
 * @param slugs - From {@link seoPriorities}.
 */
export function playbookLinks(slugs: readonly string[]): Array<{ slug: string; label: string; path: string; href: string }> {
  return slugs.map(slug => ({ slug, label: SEO_PLAYBOOK_LABEL[slug] ?? slug, path: `/playbooks/${slug}/SKILL.md`, href: `/dashboard/skills/${slug}` }));
}

export type SeoPriorities = {
  /** What comes first for this client, most important first, each a line a strategist acts on. */
  lines: string[];
  /** The agency playbooks to lead with, by slug. */
  playbooks: string[];
  /** Page types to weight a plan toward, most important first. */
  pageTypes: Array<'location' | 'service' | 'blog' | 'landing'>;
  /** Track AI-answer prompts for this client. */
  trackPrompts: boolean;
};

/**
 * What the client type and the ranked goals put first — the strategist's
 * playbook selection and plan weighting read this, in the bundle. Ordered by
 * the goals as ranked, then the client type. Pure.
 * @param p - The profile.
 */
export function seoPriorities(p: SeoProfile | undefined): SeoPriorities {
  const lines: string[] = [];
  const playbooks = new Set<string>(['how-we-brief-a-page', 'on-page-checklist']);
  const pageTypes: SeoPriorities['pageTypes'] = [];
  let trackPrompts = false;
  const add = (...t: SeoPriorities['pageTypes']) => t.forEach(x => !pageTypes.includes(x) && pageTypes.push(x));
  const type = p?.clientType;
  const where = p?.locations?.length ? ` (${p.locations.slice(0, 5).join(', ')}${p.locations.length > 5 ? ', …' : ''})` : '';
  for (const g of p?.goals ?? []) {
    if (g === 'google_business_profile') {
      lines.push(`Google Business Profile: categories, services, photos and weekly posts kept current, reviews asked for and answered, NAP the same on the site and the profile; location pages for each place served${where}.`);
      playbooks.add('location-pages-without-doorways');
      add('location', 'service');
    } else if (g === 'organic_leads') {
      lines.push(type === 'b2b_saas'
        ? 'Organic leads: bottom-of-funnel pages first (use cases, comparisons, alternatives, integrations), each with the demo or trial call to action.'
        : type === 'ecommerce'
          ? 'Organic leads: category and buying-guide pages that end at a product, before blog posts.'
          : `Organic leads: service pages${where} with the client's call to action, before blog posts.`);
      add(type === 'b2b_saas' ? 'landing' : 'service');
    } else if (g === 'ai_answers') {
      lines.push('Named in AI answers: track the prompts buyers ask AI assistants (category, shortlist, problem, comparison, brand); write pages worth citing (a clear definition up front, sourced facts and numbers, an FAQ); the Organization schema says what the business is now.');
      playbooks.add('sourcing-and-claims');
      trackPrompts = true;
      add('landing', 'blog');
    } else if (g === 'rankings') {
      lines.push('Rankings: clusters the client can win first, each with one page; refresh pages ranking 4 to 20 before writing new ones.');
      add('blog');
    }
  }
  if (type === 'local_services') {
    if (!(p?.goals ?? []).includes('google_business_profile')) {
      lines.push(`A local services client: Google Business Profile work and location pages${where} come before blog posts.`);
      playbooks.add('location-pages-without-doorways');
    }
    add('location', 'service');
  } else if (type === 'b2b_saas') {
    lines.push('A B2B SaaS client: use-case, comparison ("vs" and alternatives) and integration pages carry the plan; blog posts support them.');
    add('landing', 'blog');
  } else if (type === 'ecommerce') {
    lines.push('An ecommerce client: category and collection pages, then buying guides that link to them; product pages are refreshed, not written from scratch.');
    add('landing', 'blog');
  }
  playbooks.add('internal-linking');
  return { lines, playbooks: [...playbooks], pageTypes, trackPrompts };
}

/**
 * The profile for the bundle every SEO seat reads, right after the voice:
 * the fields, then what comes first. Empty when there is no profile. Pure.
 * @param p - The profile.
 * @param publishTargetLine - The publish target in words, by id.
 */
export function renderSeoProfile(p: SeoProfile | undefined, publishTargetLine: (id: string) => string | null = () => null): string[] {
  if (!p || Object.keys(cleanSeoProfile(p)).length === 0) {
    return [];
  }
  const out = ['## SEO profile', '', `Saved${p.savedAt ? ` ${p.savedAt.slice(0, 10)}` : ''} by a person. The client type and the goals decide what comes first: weight every plan by them.`, ''];
  for (const line of profileFacts(p, publishTargetLine)) {
    out.push(`- **${line.label}:** ${line.value}`);
  }
  const pr = seoPriorities(p);
  if (pr.lines.length) {
    out.push('', '### What comes first for this client', '');
    pr.lines.forEach((l, i) => out.push(`${i + 1}. ${l}`));
  }
  if (pr.pageTypes.length) {
    out.push('', `Weight plans toward: ${pr.pageTypes.join(', ')} pages.`);
  }
  out.push('', `Playbooks to lead with for this client: ${playbookLinks(pr.playbooks).map(l => `${l.label} (${l.path})`).join(', ')}.`);
  out.push('');
  return out;
}

/**
 * The profile as label / value lines, for the page and the bundle. Pure.
 * @param p - The profile.
 * @param publishTargetLine - The publish target in words, by id.
 */
export function profileFacts(p: SeoProfile, publishTargetLine: (id: string) => string | null = () => null): Array<{ key: SeoProfileField; label: string; value: string }> {
  const list = (v: string[] | undefined) => (v ?? []).join(', ');
  const values: Record<SeoProfileField, string> = {
    clientType: p.clientType ? CLIENT_TYPE_LABEL[p.clientType] : '',
    industry: p.industry ?? '',
    goals: (p.goals ?? []).map((g, i) => `${i + 1}. ${GOAL_LABEL[g]}`).join('  '),
    offering: p.offering ?? '',
    audience: p.audience ?? '',
    locations: list(p.locations),
    language: p.language ?? '',
    tone: p.tone ?? '',
    competitors: list(p.competitors),
    website: p.website ?? '',
    publishTarget: p.publishTarget ? (publishTargetLine(p.publishTarget) ?? p.publishTarget) : '',
    guidelines: (p.guidelines ?? []).map(g => `[${g.label}](${g.href})`).join(', '),
  };
  return SEO_PROFILE_FIELDS.filter(k => values[k]).map(k => ({ key: k, label: FIELD_LABEL[k], value: values[k] }));
}

/**
 * The profile as the editable text on the onboarding card: one field a line,
 * `Label: value`, lists comma-separated, goals most important first.
 * Guidelines are links and stay off the text. Pure.
 * @param p - The profile.
 * @param publishTargetLine - The publish target in words, by id.
 */
export function profileDraftText(p: SeoProfile, publishTargetLine: (id: string) => string | null = () => null): string {
  const lines = [
    `Client type: ${p.clientType ? CLIENT_TYPE_LABEL[p.clientType] : ''}  (B2B SaaS, Local services, Ecommerce or Other)`,
    `Industry: ${p.industry ?? ''}`,
    `Goals, most important first: ${(p.goals ?? []).map(g => GOAL_LABEL[g]).join(', ')}  (Organic leads, Google Business Profile, Named in AI answers, Rankings, Other)`,
    `Offering: ${p.offering ?? ''}`,
    `Audience: ${p.audience ?? ''}`,
    `Locations: ${(p.locations ?? []).join(', ')}`,
    `Language: ${p.language ?? ''}`,
    `Tone: ${p.tone ?? ''}`,
    `Competitors: ${(p.competitors ?? []).join(', ')}`,
    `Website: ${p.website ?? ''}`,
  ];
  if (p.publishTarget) {
    lines.push(`Publishes to: ${publishTargetLine(p.publishTarget) ?? p.publishTarget}`);
  }
  return lines.join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * A client type from what a person typed: its label or its slug. Pure.
 * @param raw - "Local services", "local_services", "SaaS".
 */
export function clientTypeFrom(raw: string): SeoClientType | null {
  const n = norm(raw);
  if (!n) {
    return null;
  }
  const hit = SEO_CLIENT_TYPES.find(t => norm(t) === n || norm(CLIENT_TYPE_LABEL[t]) === n);
  if (hit) {
    return hit;
  }
  if (/saas|software/.test(n)) {
    return 'b2b_saas';
  }
  if (/local|service/.test(n)) {
    return 'local_services';
  }
  if (/commerce|shop|store|retail/.test(n)) {
    return 'ecommerce';
  }
  return /other/.test(n) ? 'other' : null;
}

/**
 * A goal from what a person typed: its label, its slug or a common short form. Pure.
 * @param raw - "GBP", "AI answers", "organic_leads".
 */
export function goalFrom(raw: string): SeoGoal | null {
  const n = norm(raw);
  if (!n) {
    return null;
  }
  const hit = SEO_GOALS.find(g => norm(g) === n || norm(GOAL_LABEL[g]) === n);
  if (hit) {
    return hit;
  }
  if (/^gbp$|googlebusiness|businessprofile|mapspack|localpack/.test(n)) {
    return 'google_business_profile';
  }
  if (/^aio$|^ai|aianswer|aioverview|llm|chatgpt|citation/.test(n)) {
    return 'ai_answers';
  }
  if (/lead/.test(n)) {
    return 'organic_leads';
  }
  if (/rank|position|traffic/.test(n)) {
    return 'rankings';
  }
  return /other/.test(n) ? 'other' : null;
}

/**
 * The profile after a person edited the card's text. Each line it can read is
 * taken; a line cleared to nothing clears its field; a line it cannot read
 * (a client type nobody offers) leaves the field as drafted rather than
 * guessing. Anything not on the text (guidelines, the publish target) stays
 * as drafted. Pure.
 * @param p - The drafted profile.
 * @param body - The edited text.
 */
export function applyProfileDraft(p: SeoProfile, body: string): SeoProfile {
  const lines = body.split('\n');
  const field = (label: string): string | undefined => {
    const line = lines.find(l => l.trim().toLowerCase().startsWith(`${label.toLowerCase()}`) && l.includes(':'));
    if (line === undefined) {
      return undefined;
    }
    // A trailing "(…)" hint the card wrote is not part of the value.
    return line.slice(line.indexOf(':') + 1).replace(/\s{2,}\([^)]*\)\s*$/, '').trim();
  };
  const list = (v: string) => v.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  const next: SeoProfile = { ...p, evidence: { ...p.evidence } };
  const edited = (k: SeoProfileField, changed: boolean) => {
    if (changed && next.evidence) {
      delete next.evidence[k];
    }
  };
  const type = field('Client type');
  if (type !== undefined) {
    const t = type ? clientTypeFrom(type) : null;
    if (!type) {
      edited('clientType', next.clientType !== undefined);
      delete next.clientType;
    } else if (t) {
      edited('clientType', t !== next.clientType);
      next.clientType = t;
    }
  }
  const goals = field('Goals');
  if (goals !== undefined) {
    const read = list(goals.replace(/\b\d+[.)]\s*/g, ',').replace(/\s*>\s*/g, ',')).map(goalFrom);
    if (read.every(g => g !== null)) {
      const g = uniq(read as SeoGoal[]);
      edited('goals', g.join() !== (next.goals ?? []).join());
      next.goals = g;
    }
  }
  for (const [label, k] of [['Industry', 'industry'], ['Offering', 'offering'], ['Audience', 'audience'], ['Language', 'language'], ['Tone', 'tone']] as const) {
    const v = field(label);
    if (v !== undefined) {
      edited(k, v !== (next[k] ?? ''));
      next[k] = v;
    }
  }
  const locations = field('Locations');
  if (locations !== undefined) {
    edited('locations', locations !== (next.locations ?? []).join(', '));
    next.locations = list(locations);
  }
  const competitors = field('Competitors');
  if (competitors !== undefined) {
    edited('competitors', competitors !== (next.competitors ?? []).join(', '));
    next.competitors = list(competitors);
  }
  const website = field('Website');
  if (website !== undefined) {
    edited('website', website !== (next.website ?? ''));
    next.website = website;
  }
  return cleanSeoProfile(next);
}
