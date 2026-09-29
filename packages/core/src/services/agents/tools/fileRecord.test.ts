/**
 * file_<type>: a record filed through a tool whose arguments ARE the type.
 *
 * Conversation 353 (2026-09-28): the product manager filed a feature request
 * through propose_action with the fields it guessed — `description`,
 * `requestedBy`, a product NAME, no `dedupOn` — was refused twice, and filed
 * nothing. These tests hold the typed tool to the real software-factory
 * request type (loaded from the plugin, gates and all), against a real
 * database, with a scripted model driving a real deepagents graph.
 */
import type { RuntimeContext } from '../types';
import type { FilingType } from './fileRecord';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '@/libs/workspace/loader';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');
const { filingTypeOf, loadFilingTypes, filingSchema } = await import('./fileRecord');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_file_record';

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

/**
 * The request type exactly as the applier stores it: the plugin's schema, gates inside as `x-gates`.
 * @param slug
 */
function storedRequestType(slug = 'request'): { slug: string; label: string; description?: string; schema: Record<string, unknown> } {
  const dir = mkdtempSync(join(tmpdir(), 'file-record-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\nplugins: [software-factory]\n');
  const ot = loadWorkspace(dir).objectTypes.find(t => t.slug === slug)!;
  return { slug: ot.slug, label: ot.label, description: ot.description, schema: { ...(ot.schema ?? {}), 'x-gates': ot.gates ?? [] } };
}

/** A JSON Schema property, read loosely. */
type Js = { type?: string; enum?: string[]; required?: string[]; minItems?: number; properties?: Record<string, Js>; items?: Js; description?: string };

/** The shape of conversation 353's ask, in the request type's own terms (fictional product). */
const ASK_353 = {
  title: 'A sender can see who opened a shared file, and when',
  product: 'send',
  kind: 'idea',
  outcome: 'Allow a sender to see which recipients opened a shared file, and when they opened it.',
  story: 'As a founder who just sent a deck to an investor, I want to know whether they opened it, so I follow up at the right moment instead of guessing.',
  body: 'File a feature request for Send: senders want to see who opened the file and when.',
  acceptance: [
    { statement: 'The file detail page lists each recipient with the time they first opened the file.' },
    { statement: 'A recipient who has not opened the file reads "Not opened yet".' },
    { statement: 'The list updates within a minute of a recipient opening the file.' },
  ],
  mainRisk: 'Open tracking touches the public viewer route every recipient loads.',
  visuals: { surfaceUrl: 'https://send.example/files/demo' },
  whyNote: 'Checked the file detail page on send.example: it shows the recipients but no open times.',
  // What already ships, checked before filing (request #226, 2026-09-29).
  gapCheck: { finding: 'add', how: 'The capabilities page lists sharing and expiry, no open tracking.', checkedAt: '2026-09-28T12:00:00Z', sources: ['wiki:send-capabilities'] },
  why: ['user_request'],
  sizeClass: 'minor',
  confidence: 0.9,
  rationale: 'The person asked for this feature request in chat, for Send.',
};

describe('the request type\'s filing tool schema', () => {
  const spec = filingTypeOf(storedRequestType(), { product: ['ledger', 'send'] })!;
  const schema = toJsonSchema(filingSchema(spec) as never) as Js;

  it('requires what the proposal-ready bar demands, with story, outcome and acceptance among them', () => {
    expect(spec.toolName).toBe('file_request');
    expect(schema.required).toEqual(expect.arrayContaining(['title', 'product', 'story', 'outcome', 'acceptance', 'mainRisk', 'visuals', 'whyNote']));
    expect(schema.properties!.acceptance!.minItems).toBe(3);
    expect(schema.properties!.visuals!.required).toEqual(['surfaceUrl']);
  });

  it('names the product by the workspace\'s own slugs, never by a free string', () => {
    expect(schema.properties!.product!.enum).toEqual(['ledger', 'send']);
    expect(schema.properties!.product!.description).toContain('by slug: ledger, send');
  });

  it('types the arrays: acceptance is [{statement}] and why is the closed list', () => {
    const item = schema.properties!.acceptance!.items!;

    expect(item.type).toBe('object');
    expect(Object.keys(item.properties!)).toEqual(['statement']);
    expect(item.required).toEqual(['statement']);
    expect(schema.properties!.why!.items!.enum).toEqual(expect.arrayContaining(['user_request', 'production_bug']));
  });

  it('carries the type\'s own descriptions, and leaves dedup, rollups and state out of the model\'s hands', () => {
    expect(schema.properties!.outcome!.description).toContain('WHAT A PERSON CAN DO AFTERWARDS');
    expect(schema.properties!.story!.description).toContain('Required to file:');

    for (const hidden of ['dedupOn', 'dedupeKey', 'state', 'actualCents', 'priority', 'recommendationState']) {
      expect(schema.properties).not.toHaveProperty(hidden);
    }

    expect(spec.dedupOn).toEqual(['product', 'title']);
  });

  it('is plain JSON Schema a provider accepts: no x- keywords anywhere', () => {
    expect(JSON.stringify(schema)).not.toMatch(/"x-/);
  });
});

describe('the architecture plan\'s filing tool (#201, 2026-09-28: a free-form plan was refused "expected array, received object")', () => {
  const spec = filingTypeOf(storedRequestType('architecture_plan'), { product: ['ledger', 'send'] })!;
  const schema = toJsonSchema(filingSchema(spec) as never) as Js;

  it('is file_architecture_plan, deduped by request, with components and risks typed as arrays', () => {
    expect(spec.toolName).toBe('file_architecture_plan');
    expect(spec.dedupOn).toEqual(['requestId']);
    expect(schema.properties!.components!.type).toBe('array');
    expect(schema.properties!.risks!.type).toBe('array');
    expect(JSON.stringify(schema)).not.toMatch(/"x-/);
  });
});

describe('the filing types an agent gets', () => {
  it('resolves reference enums from live records only, and skips types that do not opt in', async () => {
    const req = storedRequestType();
    await db.insert(businessObjectTypeSchema).values([
      { orgId: ORG, slug: 'request', label: req.label, schema: req.schema },
      { orgId: ORG, slug: 'engineering_task', label: 'Engineering task', schema: { type: 'object', properties: { title: { type: 'string' } } } },
    ]);
    const [productType] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object' } }).returning();
    await db.insert(businessObjectSchema).values([
      { orgId: ORG, typeId: productType!.id, title: 'Send', metadata: { slug: 'send' } },
      { orgId: ORG, typeId: productType!.id, title: 'Ledger', metadata: { slug: 'ledger' }, status: 'active' },
      { orgId: ORG, typeId: productType!.id, title: 'Not yet a product', metadata: { slug: 'maybe' }, status: 'candidate' },
    ]);

    const types = await loadFilingTypes(ORG, ['request', 'engineering_task']);

    expect(types.map(t => t.slug)).toEqual(['request']);
    expect(types[0]!.properties.product!.enum).toEqual(['ledger', 'send']);
  });
});

describe('filing a request from chat, end to end', () => {
  it('a scripted model calls file_request with conversation 353\'s ask, and a request is filed with its link', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate.request', threshold: 0.5, enabled: 'true' } as never);
    const filingTypes: FilingType[] = await loadFilingTypes(ORG, ['request']);
    const events: Array<{ type: string; record?: { href?: string } }> = [];
    const ctx = {
      orgId: ORG,
      userId: 'user_owner',
      agentSlug: 'product-manager',
      conversationId: 353,
      connectorSources: [],
      objectTypeSlugs: ['request'],
      filingTypes,
      enabledPlugins: ['software-factory'],
      searchConfig: {},
      harnessConfig: {},
      citationSeq: { current: 0 },
      delegations: new Map(),
      emit: (e: never) => events.push(e),
    } as unknown as RuntimeContext;
    const fileRequest = buildDomainTools(ctx).find(t => t.name === 'file_request')!;

    expect(fileRequest).toBeDefined();

    const { ScriptedChatModel, ScriptSchema } = await import('@/libs/llm/scripted');
    const { createDeepAgent } = await import('deepagents');
    const script = ScriptSchema.parse({
      turns: [{ match: 'file a feature request', steps: [{ tool: 'file_request', args: ASK_353 }], reply: 'Filed.' }],
    });
    const graph = createDeepAgent({ model: new ScriptedChatModel({ script }) as never, tools: [fileRequest] as never });
    const out = await graph.invoke({ messages: [{ role: 'user', content: 'File a feature request for Send: senders want to see who opened the file and when.' }] } as never) as { messages: Array<{ getType: () => string; content: unknown; name?: string }> };
    const toolAnswer = out.messages.filter(m => m.getType() === 'tool').map(m => String(m.content)).join('\n');

    expect(toolAnswer).toMatch(/is DONE: filed as request #\d+ \(run #\d+, confidence 0\.9\), open at \S+/);

    const [row] = await db
      .select()
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectTypeSchema.slug, 'request')));

    expect(row!.business_object.status).toBe('approved');
    expect(row!.business_object.title).toBe(ASK_353.title);
    expect(row!.business_object.metadata).toMatchObject({ product: 'send', title: ASK_353.title, story: ASK_353.story, acceptance: ASK_353.acceptance });
    expect(row!.business_object.metadata).not.toHaveProperty('confidence');
    expect(toolAnswer).toContain(`request #${row!.business_object.id}`);
    expect(events.find(e => e.type === 'record_created')?.record?.href).toContain(String(row!.business_object.id));
  });

  it('a product that is not one of the workspace\'s is refused by the schema before anything runs', async () => {
    const filingTypes = await loadFilingTypes(ORG, ['request']);
    const ctx = { orgId: ORG, agentSlug: 'product-manager', connectorSources: [], objectTypeSlugs: ['request'], filingTypes, searchConfig: {}, harnessConfig: {}, citationSeq: { current: 0 }, delegations: new Map(), emit: () => {} } as unknown as RuntimeContext;
    const fileRequest = buildDomainTools(ctx).find(t => t.name === 'file_request')!;
    const answer = await fileRequest.invoke({ type: 'tool_call', id: 'c1', name: 'file_request', args: { ...ASK_353, product: 'Orbit' } } as never) as { content: unknown };

    expect(String(answer.content)).toMatch(/^Not recorded: invalid arguments for file_request/);
  });
});

describe('the generic propose_action path beside it', () => {
  it('still files a well-formed candidate, and a refused one of a typed type names file_request', async () => {
    const filingTypes = await loadFilingTypes(ORG, ['request']);
    const ctx = { orgId: ORG, agentSlug: 'product-manager', connectorSources: [], objectTypeSlugs: ['request'], filingTypes, searchConfig: {}, harnessConfig: {}, citationSeq: { current: 0 }, delegations: new Map(), emit: () => {} } as unknown as RuntimeContext;
    const propose = buildDomainTools(ctx).find(t => t.name === 'propose_action')!;
    const envelope = { confidence: 0.9, rationale: 'Asked for in chat.', suggested_decision: 'approve', suggested_decision_reason: 'The person asked for it.' };

    expect(propose.description).toContain('request → file_request');

    // Conversation 353's call, as sent: free-form fields, a product name, no story.
    const guessed = await propose.invoke({
      ...envelope,
      action_id: 'objects.propose_candidate',
      action_input: { objectType: 'request', title: 'Openers list', dedupOn: ['title'], fields: { why: 'user_request', kind: 'feature', product: 'Send', description: 'Who opened the file', requestedBy: 'owner' } },
    }) as string;

    expect(guessed).toMatch(/^Proposal refused \(.+\): Not proposed: this request fails the "proposal-ready" bar/);
    expect(guessed).toContain('Call file_request instead');

    const { title, confidence: _c, rationale: _r, ...fields } = ASK_353;
    const filed = await propose.invoke({
      ...envelope,
      action_id: 'objects.propose_candidate',
      action_input: { objectType: 'request', title: `${title} (generic path)`, dedupOn: ['product', 'title'], fields: { ...fields, title: `${title} (generic path)` } },
    }) as string;

    expect(filed).toMatch(/^objects\.propose_candidate is DONE: filed as request #\d+/);
  });
});
