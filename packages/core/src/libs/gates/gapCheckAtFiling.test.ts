/**
 * A NEW FEATURE REQUEST CHECKS WHAT ALREADY SHIPS (request #226, 2026-09-29).
 *
 * #226 was filed saying "today I have no way to revoke access without deleting
 * the file"; the product already shipped link expiry and a kill switch, and
 * its capabilities page said so. Filing a gap or an idea now carries a
 * gapCheck whose sources name the product's capabilities page, opened in the
 * filing turn; a finding of `none` refuses the filing with "already ships".
 * The gate is the request type's proposal-ready gate, as the plugin ships it.
 * Every name below is invented.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { evaluateGates, gateRefusal, sourceKey } from '@/libs/gates/handoffGate';
import { loadPlugin } from '@/libs/workspace/plugins';
import { readKeyOf } from '@/services/gates/turnReads';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, artifactVersionSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { candidateGateRefusal } = await import('@/libs/actions/objects-propose-candidate');
const { writeWikiPage } = await import('@/services/wiki/WikiService');

const TYPE = parse(readFileSync(join(loadPlugin('software-factory').sourcePath, 'objects/request/type.yaml'), 'utf8')) as { schema: Record<string, unknown>; gates: Parameters<typeof evaluateGates>[0] };
const GATES = TYPE.gates;
const PROPOSAL_READY = GATES.filter(g => g.name === 'proposal-ready');

// Everything else the proposal-ready bar asks for, so only the gap check is judged.
const READY = {
  product: 'relay',
  story: 'As a founder who sent a deck, I want to know it was opened.',
  outcome: 'The sender sees who opened the link.',
  acceptance: [{ statement: 'a' }, { statement: 'b' }, { statement: 'c' }],
  mainRisk: 'Anonymous opens read as nobody.',
  visuals: { surfaceUrl: 'https://app.relay.example/library' },
  whyNote: 'The library screen shows no opens today.',
};
const CHECK = { finding: 'add', how: 'read the capabilities page: no open tracking', checkedAt: '2026-09-29T03:30:00Z', sources: ['wiki:relay-capabilities'] };

function refusal(fields: Record<string, unknown>, turn?: Parameters<typeof evaluateGates>[4]): string | undefined {
  const f = evaluateGates(PROPOSAL_READY, {}, { ...fields, status: 'candidate' }, new Date('2026-09-29T04:00:00Z'), turn);
  return f ? gateRefusal(f, 'Request') : undefined;
}

describe('the proposal-ready gate asks a gap or an idea what already ships', () => {
  it('refuses an idea filed with no gap check, and says to read the capabilities page', () => {
    const out = refusal({ ...READY, kind: 'idea' });

    expect(out).toMatch(/gapCheck\.finding: check what the product already does before filing/);
    expect(out).toMatch(/gapCheck\.sources: list what the check read/);
  });

  it('refuses a filing whose check found it already ships, saying what ships', () => {
    const out = refusal({ ...READY, kind: 'gap', gapCheck: { ...CHECK, finding: 'none', how: 'links expire (expiresAt) and Kill disables one' } });

    expect(out).toMatch(/already ships: links expire \(expiresAt\) and Kill disables one\. Nothing was filed/);
  });

  it('lets add and modify through, and asks nothing of a bug', () => {
    expect(refusal({ ...READY, kind: 'gap', gapCheck: CHECK })).toBeUndefined();
    expect(refusal({ ...READY, kind: 'idea', gapCheck: { ...CHECK, finding: 'modify' } })).toBeUndefined();
    expect(refusal({ ...READY, kind: 'bug' })).toBeUndefined();
  });

  it('with a turn, the capabilities page must be among the sources AND read in that turn', () => {
    const turn = (reads: string[]) => ({ reads, resolved: { 'product.capabilitiesPage': { name: 'the wiki page "relay-capabilities"', keys: ['wiki:relay-capabilities', 'artifact:77'] } } });

    expect(refusal({ ...READY, kind: 'gap', gapCheck: CHECK }, turn([]))).toMatch(/must name the wiki page "relay-capabilities", opened with read_wiki_page in this turn/);
    expect(refusal({ ...READY, kind: 'gap', gapCheck: { ...CHECK, sources: ['apps/web/src/Library.tsx'] } }, turn(['wiki:relay-capabilities']))).toMatch(/must name the wiki page/);
    expect(refusal({ ...READY, kind: 'gap', gapCheck: CHECK }, turn(['wiki:relay-capabilities']))).toBeUndefined();
    // Read as an artifact, named by its slug — the same page.
    expect(refusal({ ...READY, kind: 'gap', gapCheck: CHECK }, turn(['artifact:77']))).toBeUndefined();
  });

  it('a product with no capabilities page asks only for sources', () => {
    expect(refusal({ ...READY, kind: 'gap', gapCheck: CHECK }, { reads: [], resolved: { 'product.capabilitiesPage': null } })).toBeUndefined();
  });

  it('the typed filing tool carries the gap check', () => {
    expect((TYPE.schema['x-agent-file'] as { fields: string[] }).fields).toContain('gapCheck');
  });
});

describe('what counts as a source, and as a read', () => {
  it('reads one page however it is written', () => {
    for (const s of ['wiki:relay-capabilities', '/w/acme/wiki/relay-capabilities', 'relay-capabilities.md', 'Relay Capabilities']) {
      expect(sourceKey(s)).toBe('wiki:relay-capabilities');
    }

    expect(sourceKey('artifact:77')).toBe('artifact:77');
  });

  it('a read is a wiki page that was found, or an artifact that came back', () => {
    expect(readKeyOf('read_wiki_page', { slug: 'Relay Capabilities' }, '# What Relay does\n(slug relay-capabilities · v3 · updated 2026-09-25 by human · /w/acme/wiki/relay-capabilities)')).toBe('wiki:relay-capabilities');
    expect(readKeyOf('read_wiki_page', { slug: 'nope' }, 'No wiki page "nope". Pages: home.')).toBeNull();
    expect(readKeyOf('read_artifact', {}, '{"id":77,"kind":"markdown"}')).toBe('artifact:77');
    expect(readKeyOf('read_artifact', {}, 'No artifact #9 in this workspace.')).toBeNull();
    expect(readKeyOf('lookup_objects', {}, '[]')).toBeNull();
  });
});

describe('candidateGateRefusal — the door, with the product read off its record', () => {
  const ORG = 'org_gap_at_filing';
  let type: { id: number; slug: string; label: string; schema: Record<string, unknown> };
  let pageArtifactId = 0;

  beforeAll(async () => {
    const [productType] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object' } }).returning({ id: businessObjectTypeSchema.id });
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: productType!.id, title: 'Relay', status: 'active', metadata: { slug: 'relay', capabilitiesPage: 'relay-capabilities' } });
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: productType!.id, title: 'Beacon', status: 'active', metadata: { slug: 'beacon' } });
    const schema = { ...TYPE.schema, 'x-gates': GATES };
    const [row] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema }).returning({ id: businessObjectTypeSchema.id });
    type = { id: row!.id, slug: 'request', label: 'Request', schema };
    const page = await writeWikiPage(ORG, { slug: 'relay-capabilities', title: 'What Relay already does', md: '- Links expire\n- Kill disables a link', author: { kind: 'human', id: 'usr_owner' }, reason: 'seed' });
    pageArtifactId = page.page.id;
  });

  afterAll(async () => {
    await db.delete(artifactVersionSchema);
    await db.delete(artifactSchema);
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
  });

  it('refuses a filing whose turn never opened the product\'s capabilities page', async () => {
    const out = await candidateGateRefusal(ORG, type, { ...READY, kind: 'gap', gapCheck: CHECK }, { reads: [] });

    expect(out).toMatch(/must name the wiki page "relay-capabilities"/);
  });

  it('lets it through when the turn read it, by slug or as its artifact', async () => {
    expect(await candidateGateRefusal(ORG, type, { ...READY, kind: 'gap', gapCheck: CHECK }, { reads: ['wiki:relay-capabilities'] })).toBeUndefined();
    expect(await candidateGateRefusal(ORG, type, { ...READY, kind: 'gap', gapCheck: CHECK }, { reads: [`artifact:${pageArtifactId}`] })).toBeUndefined();
  });

  it('on the person\'s word it files, and says what the check still owes instead (Chris, 2026-09-29: "don\'t block me")', async () => {
    const { candidateGateAdvice } = await import('@/libs/actions/objects-propose-candidate');

    expect(await candidateGateRefusal(ORG, type, { ...READY, kind: 'idea' }, { reads: [], onPersonsWord: true })).toBeUndefined();
    expect(await candidateGateAdvice(ORG, 'request', { ...READY, kind: 'idea' }, { reads: [], onPersonsWord: true })).toMatch(/the "proposal-ready" bar is not met yet — gapCheck\.finding: check what the product already does/);
    expect(await candidateGateAdvice(ORG, 'request', { ...READY, kind: 'gap', gapCheck: CHECK }, { reads: ['wiki:relay-capabilities'], onPersonsWord: true })).toBeUndefined();
  });

  it('without a turn (the API, a card filed later) the door asks for the check, not the read', async () => {
    expect(await candidateGateRefusal(ORG, type, { ...READY, kind: 'gap', gapCheck: CHECK })).toBeUndefined();
    expect(await candidateGateRefusal(ORG, type, { ...READY, kind: 'gap' })).toMatch(/check what the product already does/);
  });

  it('a product whose record names no capabilities page asks only for sources', async () => {
    expect(await candidateGateRefusal(ORG, type, { ...READY, product: 'beacon', kind: 'gap', gapCheck: { ...CHECK, sources: ['apps/web/src/Library.tsx'] } }, { reads: [] })).toBeUndefined();
  });
});
