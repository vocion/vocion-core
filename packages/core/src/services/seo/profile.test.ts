/**
 * A client's SEO profile: what the site says about the kind of client it is,
 * the prefill a person edits on the onboarding card, the edit read back, and
 * what the client type and goals put first for the strategist. Every client
 * and site here is fictional.
 */
import { describe, expect, it } from 'vitest';
import { applyProfileDraft, cleanSeoProfile, clientTypeFrom, detectClientType, domainOf, goalFrom, missingFields, overlayProfile, prefillSeoProfile, profileDraftText, renderSeoProfile, seoPriorities } from './profile';
import { homepageSignals, inventoryUrls } from './profilePrefill';

const HOME = `<!doctype html><html lang="en-US"><head>
<title>Northwind Home Services | Furnace and AC repair in Springfield</title>
<meta name="description" content="Furnace and air conditioning repair, installed and serviced by our own technicians.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"HVACBusiness","name":"Northwind Home Services","address":{"@type":"PostalAddress","addressLocality":"Springfield","addressRegion":"IL"},"areaServed":[{"@type":"City","name":"Shelbyville"},"Capital City"]}</script>
</head><body><main><h1>Warm in winter</h1><p>We fix furnaces.</p></main></body></html>`;

describe('what the site says about the client', () => {
  it('reads the home page: language, description, schema types and the places its schema names', () => {
    const s = homepageSignals(HOME, 'https://northwind-home.example/');

    expect(s.lang).toBe('en-US');
    expect(s.description).toContain('Furnace and air conditioning repair');
    expect(s.schemaTypes).toContain('HVACBusiness');
    expect(s.places).toEqual(['Springfield, IL', 'Shelbyville', 'Capital City']);
  });

  it('lists every URL a site inventory links', () => {
    const md = '| [/](https://a.example/) | 200 |\n| [/pricing](https://a.example/pricing) | 200 |\n| [/pricing](https://a.example/pricing) |';

    expect(inventoryUrls(md)).toEqual(['https://a.example/', 'https://a.example/pricing']);
  });

  it('names the kind of client and says why, or nothing when the site is unclear', () => {
    expect(detectClientType({ schemaTypes: ['WebSite', 'Plumber'] })).toEqual({ type: 'local_services', why: 'the home page declares Plumber schema' });
    expect(detectClientType({ urls: ['https://tally.example/pricing', 'https://tally.example/integrations/slack', 'https://tally.example/blog/a'] })).toMatchObject({ type: 'b2b_saas' });
    expect(detectClientType({ urls: ['https://fernshop.example/products/mug', 'https://fernshop.example/collections/kitchen', 'https://fernshop.example/cart'] })).toMatchObject({ type: 'ecommerce' });
    expect(detectClientType({ urls: ['https://x.example/about', 'https://x.example/blog/one'] })).toBeNull();
    // One path is not a pattern.
    expect(detectClientType({ urls: ['https://x.example/pricing'] })).toBeNull();
  });
});

describe('the prefill', () => {
  const project = { id: 7, domains: ['northwind-home.example'], competitors: ['www.Rivalheat.example', 'coolfix.example'], publishTargets: [{ id: 'blog' }], hasWiki: true, voiceTone: ['plain', 'warm'] };

  it('fills what the site and project say, each with where it came from, and suggests goals for the kind of client', () => {
    const p = prefillSeoProfile(project, homepageSignals(HOME, 'https://northwind-home.example/'));

    expect(p).toMatchObject({
      clientType: 'local_services',
      goals: ['google_business_profile', 'organic_leads'],
      website: 'https://northwind-home.example',
      language: 'en-US',
      locations: ['Springfield, IL', 'Shelbyville', 'Capital City'],
      tone: 'plain, warm',
      competitors: ['rivalheat.example', 'coolfix.example'],
      publishTarget: 'blog',
      guidelines: [{ label: 'Instructions', href: '/dashboard/projects/7#instructions' }, { label: 'Wiki', href: '/dashboard/projects/7#wiki' }],
    });
    expect(p.evidence).toMatchObject({ clientType: 'the home page declares HVACBusiness schema', language: 'the home page\'s language tag', competitors: 'the domains Google ranked beside the client' });
    // What only a reader can fill stays empty, and is said to be.
    expect(missingFields(p)).toEqual(['industry', 'audience']);
  });

  it('lets what the agent read win, with its own evidence, and never invents a value', () => {
    const p = overlayProfile(prefillSeoProfile(project, {}), { industry: 'Home services (HVAC)', audience: 'Homeowners in Springfield', clientType: 'local_services', evidence: { audience: 'https://northwind-home.example/about' } });

    expect(p.industry).toBe('Home services (HVAC)');
    expect(p.evidence?.audience).toBe('https://northwind-home.example/about');
    expect(p.evidence?.industry).toBe('read off the client\'s pages');
    expect(p.offering).toBeUndefined();
    expect(p.language).toBeUndefined();
  });

  it('cleans: goals de-duplicated in order, competitors as domains, blanks and bad links dropped', () => {
    expect(cleanSeoProfile({ goals: ['ai_answers', 'rankings', 'ai_answers'], competitors: ['https://www.Rival.example/path', 'not a domain', ''], industry: '  ', guidelines: [{ label: 'Guide', href: 'javascript:alert(1)' }, { label: 'Wiki', href: '/dashboard/projects/1#wiki' }] }))
      .toEqual({ goals: ['ai_answers', 'rankings'], competitors: ['rival.example'], guidelines: [{ label: 'Wiki', href: '/dashboard/projects/1#wiki' }] });
    expect(domainOf('localhost')).toBe('');
  });
});

describe('the card\'s text', () => {
  const drafted = cleanSeoProfile({ clientType: 'local_services', goals: ['google_business_profile', 'organic_leads'], industry: 'HVAC', locations: ['Springfield'], website: 'https://northwind-home.example', publishTarget: 'blog', guidelines: [{ label: 'Wiki', href: '/dashboard/projects/7#wiki' }], evidence: { clientType: 'schema', industry: 'about page' } });

  it('reads as one field a line, and reads back unchanged', () => {
    const body = profileDraftText(drafted, id => (id === 'blog' ? 'GitHub · northwind/site' : null));

    expect(body.split('\n')[0]).toBe('Client type: Local services  (B2B SaaS, Local services, Ecommerce or Other)');
    expect(body).toContain('Goals, most important first: Google Business Profile, Organic leads');
    expect(body).toContain('Publishes to: GitHub · northwind/site');
    expect(applyProfileDraft(drafted, body)).toEqual(drafted);
  });

  it('reads an edit back: a new type, goals reordered in their own words, a cleared field; edited fields lose their evidence', () => {
    const body = profileDraftText(drafted)
      .replace(/^Client type: .*$/m, 'Client type: SaaS')
      .replace(/^Goals.*$/m, 'Goals, most important first: AI answers > GBP > leads')
      .replace(/^Industry: .*$/m, 'Industry:')
      .replace(/^Competitors: .*$/m, 'Competitors: rival.example, https://coolfix.example/');

    const edited = applyProfileDraft(drafted, body);

    expect(edited.clientType).toBe('b2b_saas');
    expect(edited.goals).toEqual(['ai_answers', 'google_business_profile', 'organic_leads']);
    expect(edited.industry).toBeUndefined();
    expect(edited.competitors).toEqual(['rival.example', 'coolfix.example']);
    expect(edited.evidence).toBeUndefined();
    // Not on the text: kept as drafted.
    expect(edited.guidelines).toEqual(drafted.guidelines);
    expect(edited.publishTarget).toBe('blog');
  });

  it('leaves a field it cannot read as drafted rather than guessing', () => {
    const edited = applyProfileDraft(drafted, 'Client type: a bakery\nGoals, most important first: world peace');

    expect(edited.clientType).toBe('local_services');
    expect(edited.goals).toEqual(drafted.goals);
    expect(clientTypeFrom('Ecommerce')).toBe('ecommerce');
    expect(goalFrom('AIO')).toBe('ai_answers');
    expect(goalFrom('organic_leads')).toBe('organic_leads');
  });
});

describe('what comes first', () => {
  it('a local services client: Google Business Profile tasks and location pages, the doorway playbook', () => {
    const pr = seoPriorities({ clientType: 'local_services', goals: ['google_business_profile', 'organic_leads'], locations: ['Springfield', 'Shelbyville'] });

    expect(pr.lines[0]).toMatch(/^Google Business Profile: .*location pages for each place served \(Springfield, Shelbyville\)/);
    expect(pr.pageTypes.slice(0, 2)).toEqual(['location', 'service']);
    expect(pr.playbooks).toContain('location-pages-without-doorways');
    expect(pr.trackPrompts).toBe(false);
  });

  it('a B2B SaaS client: use-case, comparison and integration pages; AI answers adds tracked prompts and citable pages', () => {
    const pr = seoPriorities({ clientType: 'b2b_saas', goals: ['ai_answers', 'organic_leads'] });

    expect(pr.lines[0]).toMatch(/^Named in AI answers: track the prompts/);
    expect(pr.lines.join(' ')).toMatch(/use cases, comparisons, alternatives, integrations/);
    expect(pr.lines.at(-1)).toMatch(/use-case, comparison .* integration pages carry the plan/);
    expect(pr.trackPrompts).toBe(true);
    expect(pr.playbooks).toContain('sourcing-and-claims');
    expect(pr.pageTypes[0]).toBe('landing');
  });

  it('the bundle prints the profile and the order to work in; nothing without one', () => {
    const md = renderSeoProfile({ clientType: 'ecommerce', goals: ['rankings'], website: 'https://fernshop.example', savedAt: '2026-10-29T10:00:00Z' }).join('\n');

    expect(md).toContain('## SEO profile');
    expect(md).toContain('- **Client type:** Ecommerce');
    expect(md).toContain('### What comes first for this client');
    expect(md).toMatch(/1\. Rankings: /);
    expect(renderSeoProfile(undefined)).toEqual([]);
    expect(renderSeoProfile({})).toEqual([]);
  });
});
