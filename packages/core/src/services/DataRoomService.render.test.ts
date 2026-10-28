import type { DataRoomDetail } from './DataRoomService';
import type { ArtifactRow } from '@/services/ArtifactService';
import type { Ask } from '@/services/AskService';
import { describe, expect, it } from 'vitest';
import { artifactText, citeRule, deliverableIndex, findInSources, mergeBrand, mergeRules, mergeVoice, renderBrandProfile, renderDataRoom, roomAnchor, roomDeliverables, ruleCitation, SOURCE_TEXT_PER_SOURCE, SOURCE_TEXT_TOTAL, sourceKey, withoutAppSuffix } from './DataRoomService';

/**
 * The bundle the agent reads and a person downloads: order and sections. The
 * rules come first because they govern everything under them; an auto filing
 * says so, with its score; working files that are neither documents nor
 * decision logs still appear.
 */

const artifact = (id: number, over: Partial<ArtifactRow>): ArtifactRow => ({ id, kind: 'markdown', title: `A${id}`, spec: {}, currentVersion: 1, conversationId: null, recordRole: null, url: null, createdAt: new Date('2026-09-10T00:00:00Z'), updatedAt: null, ...over } as ArtifactRow);

const detail: DataRoomDetail = {
  id: 7,
  title: 'Northwind — Hiring agents',
  status: 'active',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: null,
  meta: {
    client: 'Northwind Logistics',
    stage: 'Proposal',
    status: 'Third call held.',
    statusAt: '2026-09-16T10:00:00Z',
    anchor: { type: 'deal', system: 'hubspot', id: '100', label: 'Northwind — Hiring agents', amount: 120000 },
    rules: ['Call the product "Managed AI".', 'Openings are ~20 a month, not a dozen.'],
    deliverables: [
      // Names artifact 21 — the room said this twice, once as prose and once
      // by anchoring the document. The artifact is the truth.
      { title: 'Proposal — v2.0 (CV model + iPad checklist, 4-month scope)', artifactId: 21, status: 'sent', date: '2026-09-18' },
      { title: 'Case study', status: 'planned' },
    ],
    notes: '## Where things are\n\nPricing lives in the 09-16 log.',
    sources: [
      { documentId: 1, title: 'Northwind — weekly sync', kind: 'transcript', rating: 2, channel: 'zoom', date: '2026-09-16', retrievedAt: '2026-09-16T18:00:00Z', filedBy: 'auto', score: 0.82, evidence: ['domain northwind.example', '"northwind" in the title'] },
      { artifactId: 2, title: 'Pasted scope note', kind: 'note', rating: 3, retrievedAt: '2026-09-15T18:00:00Z', filedBy: 'human' },
    ],
    milestones: [{ date: '2026-09-20', title: 'Proposal sent', status: 'planned' }, { date: '2026-09-02', title: 'Discovery call', status: 'done' }],
    highlights: [{ kind: 'quote', text: 'We work on a monthly fee for managed AI services.', who: 'Amy Larkin', date: '2026-09-16', addedAt: '2026-09-16T18:00:00Z' }],
    publishTargets: [
      { id: 'site', kind: 'github', label: 'Marketing site', config: { repo: 'example-org/northwind-site', baseBranch: 'main' } },
      { id: 'blog', kind: 'squarespace', config: { siteUrl: 'https://example-site.squarespace.com' } },
    ],
  },
  artifacts: [
    artifact(20, { recordRole: 'decision-log:1', title: '2026-09-16 · weekly sync — decision log', spec: { md: '1. Volume is ~20.' } }),
    artifact(21, { kind: 'document', title: 'Proposal', spec: { sheets: 9, verification: { ok: true } }, currentVersion: 3 }),
    artifact(22, { recordRole: 'architecture:v0.2', title: 'Platform architecture v0.2', kind: 'markdown' }),
    artifact(23, { recordRole: 'source:Pasted scope note', title: 'Pasted scope note' }),
  ],
  items: [{ id: 5, title: 'Confirm openings per month', status: 'open', risk: 'high', body: 'Amy said ~20.' } as Ask, { id: 6, title: 'Send the deck', status: 'done', risk: 'low', decisionNote: 'sent 09-15' } as Ask],
  work: [
    { id: 40, typeSlug: 'seo_page', typeLabel: 'SEO page', title: 'Waterproof hiking boots', status: 'drafting', updatedAt: new Date('2026-09-17T00:00:00Z') },
    { id: 41, typeSlug: 'seo_batch', typeLabel: 'SEO batch', title: 'Spring footwear', status: 'open', updatedAt: new Date('2026-09-16T00:00:00Z') },
    { id: 42, typeSlug: 'seo_page', typeLabel: 'SEO page', title: 'Trail running shoes', status: null, updatedAt: new Date('2026-09-15T00:00:00Z') },
  ],
};

describe('renderDataRoom', () => {
  const md = renderDataRoom(detail);
  const at = (s: string) => md.indexOf(s);

  it('orders the bundle: publish targets, instructions, status, wiki, sources, timeline, highlights, items, logs, documents, work, working files', () => {
    const order = ['# Northwind — Hiring agents — project', 'Publishes to:', '## Instructions for this project', '> **Status as of 2026-09-16.**', '## Wiki', '## Promised', '## Sources', '## Timeline', '## Highlights', '## Open items', '## 2026-09-16 · weekly sync — decision log', '## Documents', '## Work', '## Working files'].map(at);

    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lists where the project publishes and the records that belong to it, grouped by type', () => {
    expect(md).toContain('Publishes to: Marketing site — GitHub example-org/northwind-site · Squarespace https://example-site.squarespace.com');
    expect(md).toContain('### SEO page\n\n- #40 Waterproof hiking boots · drafting\n- #42 Trail running shoes');
    expect(at('### SEO page')).toBeLessThan(at('### SEO batch'));
    expect(md).toContain('- #41 Spring footwear · open');
  });

  it('shows the anchor, the auto filing with its score and evidence, and the timeline in date order', () => {
    expect(md).toContain('Anchor: deal "Northwind — Hiring agents" in hubspot (100) · $120,000');
    expect(md).toContain('⭐⭐⭐ Pasted scope note — note, filed 2026-09-15');
    expect(md).toContain('filed automatically at 82% (domain northwind.example, "northwind" in the title)');
    expect(at('| 2026-09-02 | Discovery call | done |')).toBeLessThan(at('| 2026-09-20 | Proposal sent | planned |'));
    expect(md).toContain('- **quote** · "We work on a monthly fee for managed AI services." — Amy Larkin, 2026-09-16');
    expect(md).toContain('1. 🔴 Confirm openings per month — Amy said ~20.');
    expect(md).toContain('- ~~Send the deck~~ (done: sent 09-15)');
    expect(md).toContain('- Proposal · v3 · sent 2026-09-18 · 9 sheets · verified');
    expect(md).toContain('- Platform architecture v0.2 · markdown · v1 · architecture:v0.2');
    // A pasted source is a source, listed once with its weight — not a working file.
    expect(md.split('Pasted scope note').length - 1).toBe(1);
  });

  it('says a deliverable once: the one with an artifact IS the document row, the one without is still only promised', () => {
    expect(md).not.toContain('## Deliverables');
    expect(md).toContain('- Case study — planned');
    // The prose line for artifact 21 is gone; its state and date moved onto
    // the document, which is the one thing that exists.
    expect(md).not.toContain('CV model + iPad checklist');
    expect(md.split('## Promised').length - 1).toBe(1);
  });
});

describe('roomAnchor', () => {
  it('reads the new shape first and the legacy deal as an anchor of type deal', () => {
    expect(roomAnchor({ anchor: { type: 'project', id: 'p1' } })).toEqual({ type: 'project', id: 'p1' });
    expect(roomAnchor({ deal: { system: 'hubspot', id: '9', amount: 5 } })).toEqual({ type: 'deal', system: 'hubspot', id: '9', amount: 5 });
    expect(roomAnchor({})).toBeNull();
  });
});

describe('roomDeliverables', () => {
  const pdf = artifact(31, { kind: 'file', title: 'Proposal.pdf' });
  const proposal = artifact(30, { kind: 'document', title: 'Proposal', currentVersion: 4 });
  const log = artifact(32, { kind: 'markdown', recordRole: 'decision-log:1' });

  it('renders a deliverable that has an artifact AS that artifact, carrying its state and date', () => {
    const split = roomDeliverables([proposal, log], [{ title: 'Proposal — v2.0 (4-month scope)', artifactId: 30, status: 'sent', date: '2026-09-18' }]);

    expect(split.documents).toHaveLength(1);
    expect(split.documents[0]).toMatchObject({ state: 'sent', date: '2026-09-18' });
    expect(split.documents[0]!.artifact.id).toBe(30);
    expect(split.documents[0]!.deliverable!.title).toContain('4-month scope');
    // Said once: it is not also a promise.
    expect(split.promised).toEqual([]);
  });

  it('a deliverable with no artifact is a commitment nobody has produced, and survives', () => {
    const split = roomDeliverables([proposal], [{ title: 'Case study', status: 'planned' }, { title: 'SOW', date: '2026-10-01' }]);

    expect(split.promised.map(d => d.title)).toEqual(['Case study', 'SOW']);
    expect(split.documents[0]).toMatchObject({ state: 'drafted', deliverable: null });
  });

  it('a file that exists is at least drafted — planned never describes a thing you can open', () => {
    expect(roomDeliverables([proposal], [{ title: 'Proposal', artifactId: 30, status: 'planned' }]).documents[0]!.state).toBe('drafted');
    expect(roomDeliverables([proposal], [{ title: 'Proposal', artifactId: 30, status: 'signed' }]).documents[0]!.state).toBe('signed');
  });

  it('collapses two lines naming one artifact to the newest, and keeps a line whose artifact is not on this room', () => {
    const legacy = [
      { title: 'Proposal v2.0', artifactId: 30, status: 'sent' as const },
      { title: 'Proposal v1.0', artifactId: 30, status: 'drafted' as const },
      { title: 'Deck', artifactId: 99 },
    ];
    const split = roomDeliverables([proposal, pdf], legacy);

    expect(split.documents.map(d => d.artifact.id)).toEqual([30, 31]);
    expect(split.documents[0]!.deliverable!.title).toBe('Proposal v2.0');
    expect(split.documents[0]!.state).toBe('sent');
    // The PDF nobody promised is still a document; the deliverable pointing
    // somewhere else is still visible rather than silently dropped.
    expect(split.documents[1]).toMatchObject({ state: 'drafted', deliverable: null });
    expect(split.promised.map(d => d.title)).toEqual(['Deck']);
  });
});

describe('deliverableIndex', () => {
  const list = [
    { title: 'Proposal v2.0 (4-month scope)', artifactId: 30, status: 'drafted' as const },
    { title: 'Case study', status: 'planned' as const },
  ];

  it('replaces the line for the same ARTIFACT however the prose changed', () => {
    expect(deliverableIndex(list, { title: 'Proposal v3.0 (6-month scope)', artifactId: 30, status: 'sent' })).toBe(0);
  });

  it('turns a promise into the document line when the artifact arrives under the same name', () => {
    expect(deliverableIndex(list, { title: 'case study', artifactId: 77, status: 'drafted' })).toBe(1);
  });

  it('is a new line when neither the artifact nor the name is known', () => {
    expect(deliverableIndex(list, { title: 'SOW', artifactId: 88 })).toBe(-1);
    expect(deliverableIndex(list, { title: 'SOW' })).toBe(-1);
    expect(deliverableIndex([], { title: 'Proposal', artifactId: 30 })).toBe(-1);
  });

  it('a promise with no artifact still matches on its title, as it always did', () => {
    expect(deliverableIndex(list, { title: 'Case study', status: 'planned' })).toBe(1);
  });
});

describe('mergeRules', () => {
  it('removes first, then adds — so replacing the list keeps a rule present in both', () => {
    const existing = ['Call the product Managed AI.', 'Never quote headcount.'];

    expect(mergeRules(existing, ['Call the product Managed AI.', 'Openings are ~20 a month.'], existing)).toEqual(['Call the product Managed AI.', 'Openings are ~20 a month.']);
    expect(mergeRules(existing, ['  Never quote headcount. '], undefined)).toEqual(existing);
    expect(mergeRules(existing, undefined, ['Never quote headcount.'])).toEqual(['Call the product Managed AI.']);
    expect(mergeRules(undefined, ['a', '', 'a'], undefined)).toEqual(['a']);
  });
});

/**
 * The client's brand lives on the room, not on one document — so the logo is
 * fetched once and every later proposal written from that room uses the same
 * mark instead of inventing a wordmark (2026-09-19).
 */
describe('client brand on the room', () => {
  const logo = { dataUri: 'data:image/png;base64,iVBORw0KG', width: 240, height: 60, bytes: 3072, contentType: 'image/png', source: 'https://northwind.example/logo.png', fetchedAt: '2026-09-19T09:00:00Z', url: '/api/artifacts/x/y.png' };
  const mark = { ...logo, width: 64, height: 64, source: 'https://northwind.example/mark.svg', contentType: 'image/svg+xml', dataUri: 'data:image/svg+xml;base64,PHN2Zw' };

  it('replaces one slot and leaves the other alone', () => {
    expect(mergeBrand({ logo }, 'mark', mark)).toEqual({ logo, mark });
    expect(mergeBrand({ logo, mark }, 'logo', { ...logo, source: 'https://northwind.example/v2.png' }).logo?.source).toBe('https://northwind.example/v2.png');
    expect(mergeBrand(undefined, 'logo', logo)).toEqual({ logo });
  });

  it('links the stored copy instead of inlining its base64, and says how to get the data URI', () => {
    const big = { ...logo, dataUri: `data:image/png;base64,${'A'.repeat(40_000)}` };
    const md = renderDataRoom({ ...detail, meta: { ...detail.meta, brand: { logo: big, mark: { ...mark, url: undefined } } } });

    expect(md).toContain('## Client brand');
    expect(md).not.toContain('base64');
    expect(md).toContain('- **logo** — [logo](/api/artifacts/x/y.png) · 240×60, 3 KB, from https://northwind.example/logo.png on 2026-09-19');
    // No stored copy: the link is where it came from.
    expect(md).toContain('[mark](https://northwind.example/mark.svg)');
    expect(md).toContain('call fetch_image with its source URL, project_id 7');
    expect(md).toContain('Never redraw a mark as text');
    expect(md.length).toBeLessThan(6_000);
  });

  it('says nothing at all when the room has no brand', () => {
    expect(renderDataRoom(detail)).not.toContain('## Client brand');
  });
});

/**
 * A client's guides reach the writer: the text of every ⭐⭐⭐ source is in the
 * bundle the SEO agents read, capped per source and in all, every cut saying
 * how much is left and how to read it by id (red team, 2026-10-27: the writer
 * saw guideline documents by title only).
 */
describe('the ⭐⭐⭐ sources in full', () => {
  const guide = [
    '# Northwind Home Services — writing guide',
    '',
    'Do: call our people "technicians", never "guys".',
    'Don\'t: promise same-day service anywhere outside the metro.',
    'Do: end every page with "Book a visit".',
  ].join('\n');
  const sources = [
    { artifactId: 31, title: 'Writing guide', kind: 'attachment' as const, rating: 3 as const, retrievedAt: '2026-10-20T10:00:00Z', filedBy: 'human' as const },
    { documentId: 12, title: 'Brand book', kind: 'attachment' as const, rating: 3 as const, retrievedAt: '2026-10-21T10:00:00Z', filedBy: 'human' as const },
    { artifactId: 33, title: 'Scanned price sheet', kind: 'attachment' as const, rating: 3 as const, retrievedAt: '2026-10-21T10:00:00Z', filedBy: 'human' as const },
    { artifactId: 34, title: 'Old call notes', kind: 'note' as const, rating: 1 as const, retrievedAt: '2026-10-01T10:00:00Z', filedBy: 'human' as const },
  ];
  const room = (texts: Record<string, string>) => renderDataRoom({ ...detail, meta: { ...detail.meta, sources }, sourceTexts: texts });

  it('prints each three-star source\'s text under its title and id, and lists every source with its id', () => {
    const md = room({ 'artifact:31': guide, 'doc:12': 'Navy and white. The van is the logo.', 'artifact:33': '' });

    expect(md).toContain('## ⭐⭐⭐ sources in full');
    expect(md).toContain('### Writing guide · `artifact:31`');
    expect(md).toContain('Don\'t: promise same-day service anywhere outside the metro.');
    expect(md).toContain('### Brand book · `doc:12`\n\nNavy and white. The van is the logo.');
    expect(md).toContain('### Scanned price sheet · `artifact:33`\n\n_No text could be read from this source');
    // The one-star note is listed with its id, not printed.
    expect(md).toContain('Old call notes — note, filed 2026-10-01 · `artifact:34`');
    expect(md).not.toContain('### Old call notes');
    expect(md).toContain('read_project { project_id: 7, source: "<id>" }');
    expect(md.indexOf('## Sources')).toBeLessThan(md.indexOf('## ⭐⭐⭐ sources in full'));
  });

  it('cuts a long source at its cap and says how much is left and how to read the rest', () => {
    const long = 'Use plain words. '.repeat(1_000);
    const md = room({ 'artifact:31': long });

    expect(md).toContain(`_Cut at ${SOURCE_TEXT_PER_SOURCE.toLocaleString('en-US')} of ${long.trim().length.toLocaleString('en-US')} characters. Read the rest: read_project { project_id: 7, source: "artifact:31", offset: ${SOURCE_TEXT_PER_SOURCE} }._`);
  });

  it('stops printing at the total and names each source left out with its read call', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ artifactId: 50 + i, title: `Guide ${i + 1}`, kind: 'attachment' as const, rating: 3 as const, retrievedAt: '2026-10-20T10:00:00Z' }));
    const texts = Object.fromEntries(many.map(s => [`artifact:${s.artifactId}`, 'x'.repeat(SOURCE_TEXT_PER_SOURCE)]));
    const md = renderDataRoom({ ...detail, meta: { ...detail.meta, sources: many }, sourceTexts: texts });
    const printed = (md.match(/x{100,}/g) ?? []).join('').length;

    expect(printed).toBe(SOURCE_TEXT_TOTAL);
    expect(md).toContain(`### Guide 5 · \`artifact:54\`\n\n_Not printed: the bundle's ${SOURCE_TEXT_TOTAL.toLocaleString('en-US')} characters for sources in full are spent. Read it (${SOURCE_TEXT_PER_SOURCE.toLocaleString('en-US')} characters): read_project { project_id: 7, source: "artifact:54" }._`);
  });

  it('prints nothing extra when the texts were not read (the project page)', () => {
    expect(renderDataRoom({ ...detail, meta: { ...detail.meta, sources } })).not.toContain('sources in full');
  });

  it('reads an artifact\'s text whatever kind it is', () => {
    expect(artifactText({ spec: { md: '# Note' } })).toBe('# Note');
    expect(artifactText({ spec: { text: 'PDF words', filename: 'a.pdf' } })).toBe('PDF words');
    expect(artifactText({ spec: { html: '<style>p{}</style><p>One</p><p>Two</p>' } })).toBe('One\nTwo');
    expect(artifactText({ spec: { filename: 'logo.png' } })).toBe('');
    expect(sourceKey({ documentId: 12 })).toBe('doc:12');
    expect(sourceKey({ artifactId: 3 })).toBe('artifact:3');
    expect(sourceKey({})).toBeNull();
  });

  it('finds passages in the project\'s own sources only, most words first', () => {
    const found = findInSources(sources, { 'artifact:31': guide, 'doc:12': 'Navy and white. Technicians wear navy.', 'artifact:34': 'We discussed pricing.' }, 'technicians guys');

    expect(found[0]).toMatchObject({ key: 'artifact:31', title: 'Writing guide' });
    expect(found[0]!.text).toContain('"technicians", never "guys"');
    expect(found.map(f => f.key)).toEqual(['artifact:31', 'doc:12']);
    expect(findInSources(sources, { 'artifact:31': guide }, 'warranty')).toEqual([]);
  });
});

/**
 * A rule taken from a client's guide says which guide, so a writer can check
 * it and a person can see why it is there (principle 10).
 */
describe('rules that cite their source', () => {
  const sources = [{ documentId: 12, title: 'Brand book', kind: 'attachment' as const, rating: 3 as const, retrievedAt: '2026-10-21T10:00:00Z' }];

  it('names the source by title and id, or a page by its URL', () => {
    expect(ruleCitation(sources, 'doc:12')).toBe('"Brand book", doc:12');
    expect(ruleCitation(sources, 'https://northwind-home.example/about')).toBe('https://northwind-home.example/about');
    expect(ruleCitation(sources, undefined)).toBeNull();
    expect(citeRule('Say "technicians", never "guys".', '"Brand book", doc:12')).toBe('Say "technicians", never "guys". (from "Brand book", doc:12)');
    expect(citeRule('Already cited (from "Brand book", doc:12)', '"Brand book", doc:12')).toBe('Already cited (from "Brand book", doc:12)');
  });
});

/**
 * The client voice is structured and sourced, and printed first: the writer
 * reads how the client writes before anything else, and never the agency's
 * brand in its place.
 */
describe('the client voice block', () => {
  const voice = {
    pointOfView: { text: 'we, to you', source: 'https://northwind-home.example/about' },
    spelling: { text: 'US' as const, source: 'doc:12' },
    tone: [{ text: 'neighbourly', source: 'https://northwind-home.example/' }],
    bannedPhrases: [{ text: 'cheap', source: 'doc:12' }],
    preferredCtas: [{ text: 'Book a visit', source: 'https://northwind-home.example/' }],
    neverClaim: [{ text: 'Same-day service outside the metro', source: 'doc:12', phrases: ['same-day'] }],
    updatedAt: '2026-10-27T09:00:00Z',
  };

  it('prints at the top, before the instructions, every line with its source', () => {
    const md = renderDataRoom({ ...detail, meta: { ...detail.meta, voice } });

    expect(md.indexOf('## Client voice')).toBeGreaterThan(0);
    expect(md.indexOf('## Client voice')).toBeLessThan(md.indexOf('## Instructions for this project'));
    expect(md).toContain('- **Point of view:** we, to you — [northwind-home.example/about](https://northwind-home.example/about)');
    expect(md).toContain('- **Spelling:** US — `doc:12`');
    expect(md).toContain('- **Never use:** "cheap" (`doc:12`)');
    expect(md).toContain('- **Calls to action:** "Book a visit" ([northwind-home.example](https://northwind-home.example/))');
    expect(md).toContain('- **Never claim:** Same-day service outside the metro (checked words: "same-day") — `doc:12`');
    expect(md).toContain('not as the agency');
  });

  it('says nothing when the project has no voice', () => {
    expect(renderDataRoom(detail)).not.toContain('## Client voice');
  });

  it('sets the fields given, replaces a list whole, and clears one sent empty', () => {
    const merged = mergeVoice(voice, { tone: [{ text: 'plain', source: 'doc:12' }], bannedPhrases: [] });

    expect(merged.tone).toEqual([{ text: 'plain', source: 'doc:12' }]);
    expect(merged.bannedPhrases).toBeUndefined();
    expect(merged.pointOfView).toEqual(voice.pointOfView);
    expect(merged.updatedAt).not.toBe(voice.updatedAt);
  });
});

describe('competitors and the site inventory on the bundle', () => {
  it('cites each competitor with the searches it ranked for, and links the inventory', () => {
    const md = renderDataRoom({
      ...detail,
      meta: {
        ...detail.meta,
        siteInventory: { artifactId: 88, site: 'northwind-home.example', readAt: '2026-10-27T09:00:00Z', pages: 300, from: 'sitemap', cappedAt: 300, listed: 412 },
        competitors: {
          readAt: '2026-10-27T09:05:00Z',
          queries: ['furnace repair springfield', 'ac install springfield'],
          location: 'Springfield, Illinois, United States',
          isGoogleRanking: true,
          domains: [{ domain: 'kestrel-heating.example', ranked: [{ query: 'furnace repair springfield', position: 2, url: 'https://kestrel-heating.example/furnace' }, { query: 'ac install springfield', position: 4, url: 'https://kestrel-heating.example/ac' }] }],
        },
      },
    });

    expect(md).toContain('Site inventory: [northwind-home.example, read 2026-10-27](/dashboard/artifacts/88) — 300 pages from the sitemap, the first 300 of 412 listed (artifact #88).');
    expect(md).toContain('## Competitors');
    expect(md).toContain('Read from Google on 2026-10-27 for 2 searches in Springfield, Illinois, United States');
    expect(md).toContain('- **kestrel-heating.example** — "furnace repair springfield" #2 ([page](https://kestrel-heating.example/furnace)); "ac install springfield" #4 ([page](https://kestrel-heating.example/ac))');
  });
});

describe('a project is the client, not an app', () => {
  const apps = ['seo', 'Search Engine Optimization', 'marketing', 'Paid Marketing'];

  it('takes an app\'s name off the end of a title, and nothing else', () => {
    expect(withoutAppSuffix('Northwind Home Services — SEO', apps)).toBe('Northwind Home Services');
    expect(withoutAppSuffix('Northwind Home Services - SEO project', apps)).toBe('Northwind Home Services');
    expect(withoutAppSuffix('Northwind Home Services (Paid Marketing)', apps)).toBe('Northwind Home Services');
    expect(withoutAppSuffix('Northwind Home Services | search engine optimization', apps)).toBe('Northwind Home Services');
    // An engagement name is the person's word, not an app's.
    expect(withoutAppSuffix('Northwind — Hiring agents', apps)).toBe('Northwind — Hiring agents');
    expect(withoutAppSuffix('Kestrel-Capital', apps)).toBe('Kestrel-Capital');
    expect(withoutAppSuffix('SEO', apps)).toBe('SEO');
  });
});

describe('the brand read off the client\'s site', () => {
  it('prints the colours, fonts and name with where and when they were read, and nothing without them', () => {
    expect(renderBrandProfile({ source: 'https://northwind-home.example/', readAt: '2026-10-27T09:00:00Z', name: 'Northwind Home Services', colors: { primary: '#0B3D5C' }, fonts: { body: 'Lato' } })).toEqual([
      '- **Name:** Northwind Home Services',
      '- **Colours:** primary #0B3D5C',
      '- **Fonts:** body Lato',
      '- Read from https://northwind-home.example/ on 2026-10-27.',
    ]);
    expect(renderBrandProfile(undefined)).toEqual([]);
  });
});

describe('the brand a project read off a built site', () => {
  it('names its fonts without the build hash, even on a profile read before they were taken off', () => {
    const lines = renderBrandProfile({ source: 'https://northwind-home.example', readAt: '2026-10-27T00:00:00Z', fonts: { heading: 'Barlow-364621179e86efae', primary: 'Inter-b937ba1167470226' } });

    expect(lines).toContain('- **Fonts:** heading Barlow · primary Inter');
  });
});
