/**
 * A client's SEO profile: what the site says about the kind of client it is,
 * the prefill a person edits on the onboarding card, the edit read back, and
 * what the client type and goals put first for the strategist. Every client
 * and site here is fictional.
 */
import { describe, expect, it } from 'vitest';
import { applyProfileDraft, cleanSeoProfile, clientTypeFrom, detectClientType, domainOf, goalFrom, missingFields, overlayProfile, playbookLinks, prefillSeoProfile, profileDraftText, renderSeoProfile, seoPriorities } from './profile';
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

  it('says nothing when the site is unclear, and never calls a client local from a place alone', () => {
    expect(detectClientType({ urls: ['https://x.example/about', 'https://x.example/blog/one'] })).toBeNull();
    // One path is not a pattern.
    expect(detectClientType({ urls: ['https://x.example/pricing'] })).toBeNull();
    // A region or "Worldwide" in the schema is reach, and a place alone is never local.
    expect(detectClientType({ places: ['Springfield, IL'] })).toBeNull();
    expect(homepageSignals('<script type="application/ld+json">{"@type":"Organization","address":{"addressRegion":"Global","addressCountry":"US"},"areaServed":"Worldwide"}</script>', 'https://x.example/').places).toEqual([]);
  });
});

/** One fictional site of each kind: its home page and the paths its inventory lists. */
const SITES = {
  b2b_services: {
    url: 'https://harborline-advisory.example/',
    html: `<html lang="en"><head><title>Harborline | AI Acceleration Partner for Mid-Market Companies</title>
<meta name="description" content="Harborline is the AI acceleration partner for mid-market companies. Senior engineers find where AI pays off, build it, and run it.">
<script type="application/ld+json">{"@type":"Organization","name":"Harborline","address":{"@type":"PostalAddress","addressRegion":"Global","addressCountry":"US"},"areaServed":"Worldwide","hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"AI consulting"}}]}}</script></head>
<body><main><h1>AI that pays off</h1><p>For COOs, CFOs and CTOs at mid-market companies who need AI to move the numbers. Our consulting engagements start with an assessment. Read the case studies, then book a call.</p></main></body></html>`,
    urls: ['/', '/services/ai-assessment', '/case-studies/logistics', '/industries/manufacturing', '/insights/ai-roi', '/contact'],
  },
  b2b_saas: {
    url: 'https://tally-books.example/',
    html: `<html lang="en"><head><title>Tally Books — invoicing software for agencies</title>
<meta name="description" content="Invoicing and time tracking software for creative agencies. Start your free trial.">
<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Tally Books","applicationCategory":"BusinessApplication"}</script></head>
<body><main><h1>Get paid faster</h1><p>The invoicing platform that integrates with your accounting tools. Plans from $12 per user. Start a free trial or book a demo.</p></main></body></html>`,
    urls: ['/', '/pricing', '/integrations/ledgerly', '/demo', '/login', '/blog/late-payments'],
  },
  local_services: {
    url: 'https://fernwood-plumbing.example/',
    html: `<html lang="en-US"><head><title>Fernwood Plumbing | Plumbers in Fairview</title>
<meta name="description" content="Same-day plumbing repairs in Fairview and the surrounding towns.">
<script type="application/ld+json">{"@type":"Plumber","name":"Fernwood Plumbing","telephone":"+1 555 0100","address":{"@type":"PostalAddress","streetAddress":"12 Mill Rd","addressLocality":"Fairview","addressRegion":"OH"},"areaServed":["Lakeside","Riverton"]}</script></head>
<body><main><h1>Plumbers near you</h1><p>Licensed and insured. Free estimates, 24/7 emergency service. Call us now.</p></main></body></html>`,
    urls: ['/', '/service-areas/lakeside', '/locations/riverton', '/drain-cleaning', '/water-heaters'],
  },
  ecommerce: {
    url: 'https://fern-and-clay.example/',
    html: `<html lang="en"><head><title>Fern &amp; Clay — handmade ceramics</title>
<meta name="description" content="Handmade mugs, bowls and planters. Free shipping over $50.">
<script type="application/ld+json">[{"@type":"OnlineStore","name":"Fern & Clay"},{"@type":"Product","name":"Stoneware mug","offers":{"@type":"Offer","price":"28"}}]</script></head>
<body><main><h1>Made by hand</h1><p>Shop now. Add to cart. In stock and ready to ship.</p></main></body></html>`,
    urls: ['/', '/collections/mugs', '/products/stoneware-mug', '/cart', '/shop'],
  },
} as const;

describe('one site of each kind', () => {
  const read = (k: keyof typeof SITES) => {
    const site = SITES[k];
    return { ...homepageSignals(site.html, site.url), urls: site.urls.map(p => new URL(p, site.url).href) };
  };

  it('reads a B2B AI services firm as B2B services, not local, and leads its goals with leads and AI answers', () => {
    const p = prefillSeoProfile({ id: 1 }, read('b2b_services'));

    expect(p.clientType).toBe('b2b_services');
    expect(p.goals).toEqual(['organic_leads', 'ai_answers']);
    expect(p.locations).toBeUndefined();
    expect(p.evidence?.clientType).toMatch(/buyer titles/);
    expect(p.evidence?.clientType).toMatch(/case-studies/);
    expect(p.evidence?.goals).toMatch(/B2B services firm whose site sells expertise or AI/);
  });

  it('reads a SaaS product as B2B SaaS', () => {
    const r = detectClientType(read('b2b_saas'));

    expect(r?.type).toBe('b2b_saas');
    expect(r?.why).toMatch(/SoftwareApplication schema/);
    expect(prefillSeoProfile({ id: 1 }, read('b2b_saas')).goals).toEqual(['organic_leads', 'ai_answers']);
  });

  it('reads a trade with an address, service areas and a call-now CTA as local services, with its places', () => {
    const p = prefillSeoProfile({ id: 1 }, read('local_services'));

    expect(p.clientType).toBe('local_services');
    expect(p.goals).toEqual(['google_business_profile', 'organic_leads']);
    expect(p.locations).toEqual(['Fairview, OH', 'Lakeside', 'Riverton']);
    expect(p.evidence?.clientType).toMatch(/Plumber schema.*service-areas.*a street address/);
  });

  it('reads a shop with product schema and a cart as ecommerce', () => {
    const p = prefillSeoProfile({ id: 1 }, read('ecommerce'));

    expect(p.clientType).toBe('ecommerce');
    expect(p.goals).toEqual(['rankings', 'organic_leads']);
    expect(p.evidence?.clientType).toMatch(/OnlineStore, Product schema/);
  });

  it('asks the person to choose when it cannot tell, never defaulting to local', () => {
    const p = prefillSeoProfile({ id: 1 }, homepageSignals('<html><head><title>Welcome</title></head><body><main><p>Hello.</p></main></body></html>', 'https://plain.example/'));

    expect(p.clientType).toBe('other');
    expect(p.evidence?.clientType).toBe('the site does not say clearly: please choose');
    expect(p.goals).toEqual(['organic_leads']);
    expect(profileDraftText(p).split('\n')[0]).toBe('Client type: Other  (read from: the site does not say clearly: please choose; choose B2B services, B2B SaaS, Local services, Ecommerce or Other)');
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
    expect(p.evidence).toMatchObject({ clientType: 'HVACBusiness schema on the home page', language: 'the home page\'s language tag', competitors: 'the domains Google ranked beside the client' });
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

    // Each value with where it was read, beside it on the card.
    expect(body.split('\n')[0]).toBe('Client type: Local services  (read from: schema; choose B2B services, B2B SaaS, Local services, Ecommerce or Other)');
    expect(body).toContain('Industry: HVAC  (read from: about page)');
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
    expect(playbookLinks(pr.playbooks).find(l => l.slug === 'location-pages-without-doorways')).toEqual({ slug: 'location-pages-without-doorways', label: 'Location pages without doorways', path: '/playbooks/location-pages-without-doorways/SKILL.md', href: '/dashboard/skills/location-pages-without-doorways' });
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
    expect(md).toContain('Playbooks to lead with for this client: How we brief a page (/playbooks/how-we-brief-a-page/SKILL.md), On-page checklist (/playbooks/on-page-checklist/SKILL.md), Internal linking (/playbooks/internal-linking/SKILL.md).');
    expect(renderSeoProfile(undefined)).toEqual([]);
    expect(renderSeoProfile({})).toEqual([]);
  });
});
