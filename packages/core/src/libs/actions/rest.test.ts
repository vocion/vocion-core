/**
 * rest.request — the generic write against a `rest` source:
 *
 *   - Refused at propose time, with a sentence the model acts on, when the
 *     source does not exist, is not a REST source, declares no such action,
 *     the input misses its schema, or a path parameter is absent.
 *   - Credentials resolve from the source the INPUT names (`sourceSlugFor`).
 *   - The ladder keys on `rest.request.<source>.<action>`.
 *   - The review card reads from the endpoint's own review hints, drops a
 *     row that resolved to nothing, and shows the request as a code block
 *     with an Irreversible badge unless the endpoint says otherwise.
 *   - Execute renders the body from the input, keeps JSON types, and turns a
 *     non-2xx into a failed run carrying the API's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_CONFIG } from '@/libs/rest/spec.test';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { restRequestAction } = await import('./rest');
const { policyKeyForRun } = await import('./policyKey');

const ORG = 'org_rest_action_fixture';
const CTX = { orgId: ORG, credentials: { baseUrl: 'https://api.northwind.example', token: 'tok-fixture' } };

function res(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status < 300, status, text: async () => text } as unknown as Response;
}

function parse(input: Record<string, unknown>) {
  return restRequestAction.inputSchema.parse(input);
}

const GOOD = { sourceSlug: 'acme-delivery', action: 'update_milestone', input: { documentId: 'm-12', name: 'Kickoff', dueDate: '2026-10-01' }, summary: 'Move the kickoff milestone to 1 October.' };

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'acme-delivery', kind: 'plugin', configJson: { ...EXAMPLE_CONFIG, _connector: 'rest', _name: 'Acme Delivery API' } });
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } });
});

afterEach(() => vi.unstubAllGlobals());

describe('the contract', () => {
  it('is external, not reversible, keyed per endpoint, and takes its credential from the named source', () => {
    expect(restRequestAction.external).toBe(true);
    // The envelope (propose_action) carries rationale, evidence and confidence; the input does not ask twice.
    expect(Object.keys(restRequestAction.inputSchema.shape).sort()).toEqual(['action', 'input', 'sourceSlug', 'summary']);
    expect(restRequestAction.undo).toBeUndefined();
    expect(restRequestAction.sourceSlug).toBeUndefined();
    expect(restRequestAction.sourceSlugFor!(parse(GOOD))).toBe('acme-delivery');
    expect(policyKeyForRun('rest.request', GOOD)).toBe('rest.request.acme-delivery.update_milestone');
  });
});

describe('precheck', () => {
  it('lets a well-formed proposal through', async () => {
    await expect(restRequestAction.precheck!({ orgId: ORG }, parse(GOOD))).resolves.toBeUndefined();
  });

  it('refuses a source that does not exist, or is not a REST source', async () => {
    await expect(restRequestAction.precheck!({ orgId: ORG }, parse({ ...GOOD, sourceSlug: 'nope' }))).resolves.toMatch(/No REST source "nope"/);
    await expect(restRequestAction.precheck!({ orgId: ORG }, parse({ ...GOOD, sourceSlug: 'hubspot' }))).resolves.toMatch(/No REST source "hubspot"/);
    await expect(restRequestAction.precheck!({ orgId: 'org_other_fixture' }, parse(GOOD))).resolves.toMatch(/No REST source/);
  });

  it('refuses an action the source does not declare, naming the ones it does', async () => {
    await expect(restRequestAction.precheck!({ orgId: ORG }, parse({ ...GOOD, action: 'delete_milestone' }))).resolves.toMatch(/no action "delete_milestone".*Declared: update_milestone/);
  });

  it('refuses input outside the endpoint\'s schema, naming the field', async () => {
    // JSONB does not keep key order, so the declared list is matched as a set.
    const refusal = await restRequestAction.precheck!({ orgId: ORG }, parse({ ...GOOD, input: { documentId: 'm-12', dueDate: 'soon' } }));

    expect(refusal).toMatch(/dueDate: .*Declared properties: /);
    expect(refusal).toContain('documentId');
    expect(refusal).toContain('name');
    await expect(restRequestAction.precheck!({ orgId: ORG }, parse({ ...GOOD, input: { name: 'x' } }))).resolves.toMatch(/documentId/);
  });
});

describe('reviewCard', () => {
  it('reads the endpoint\'s hints, drops a row that resolved to nothing, and shows the request', async () => {
    const card = await restRequestAction.reviewCard!({ orgId: ORG }, parse({ ...GOOD, input: { documentId: 'm-12', name: 'Kickoff' } }));

    expect(card.title).toBe('Update milestone m-12');
    expect(card.system).toBe('Acme Delivery API');
    expect(card.headline).toBe('Move the kickoff milestone to 1 October.');
    expect(card.badges).toEqual([{ label: 'Acme Delivery API' }, { label: 'Irreversible', tone: 'warn' }]);
    expect(card.fields).toEqual([
      { label: 'Name', value: 'Kickoff' },
      { label: 'Method', value: 'PUT' },
      { label: 'Path', value: '/api/milestones/m-12' },
    ]);
    expect(card.content).toEqual([{ kind: 'text', id: 'request', label: 'Request', preformatted: true, body: 'PUT /api/milestones/m-12\n\n{\n  "data": {\n    "name": "Kickoff"\n  }\n}' }]);
    expect(card.summary).toBeUndefined();
  });

  it('still renders for a source that has gone, saying why', async () => {
    const card = await restRequestAction.reviewCard!({ orgId: ORG }, parse({ ...GOOD, sourceSlug: 'gone' }));

    expect(card.title).toBe('update_milestone on gone');
    expect(card.fields[0]).toMatchObject({ label: 'Refused' });
  });
});

describe('execute', () => {
  it('PUTs the rendered body with the credential and returns status and the picked body', async () => {
    const f = vi.fn(async () => res(200, { data: { documentId: 'm-12', name: 'Kickoff', dueDate: '2026-10-01' } }));
    vi.stubGlobal('fetch', f);

    const out = await restRequestAction.execute(CTX, parse(GOOD));

    expect(out).toEqual({ sourceSlug: 'acme-delivery', action: 'update_milestone', method: 'PUT', path: '/api/milestones/m-12', status: 200, body: { data: { documentId: 'm-12', name: 'Kickoff', dueDate: '2026-10-01' } } });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.northwind.example/api/milestones/m-12');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ data: { name: 'Kickoff', dueDate: '2026-10-01' } });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-fixture');
  });

  it('records only the leaves response.select names, so a run does not keep what the API served beside them', async () => {
    await db.delete(knowledgeSourceSchema);
    await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'acme-delivery',
      kind: 'plugin',
      configJson: {
        _connector: 'rest',
        _name: 'Acme Delivery API',
        actions: [{ name: 'update_milestone', method: 'PUT', path: '/api/milestones/{documentId}', input: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] }, response: { pick: 'data', select: ['documentId', 'name'] } }],
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { data: { documentId: 'm-12', name: 'Kickoff', brief: { blocks: [1, 2, 3] } }, meta: { audit: 'x' } })));

    const out = await restRequestAction.execute(CTX, parse({ sourceSlug: 'acme-delivery', action: 'update_milestone', input: { documentId: 'm-12' }, summary: 'Rename.' }));

    expect(out).toMatchObject({ status: 200, body: { documentId: 'm-12', name: 'Kickoff' } });
  });

  it('drops body keys whose argument was not supplied, and still sends {} when every key dropped', async () => {
    const f = vi.fn(async () => res(200, {}));
    vi.stubGlobal('fetch', f);
    await restRequestAction.execute(CTX, parse({ ...GOOD, input: { documentId: 'm-12', name: 'Kickoff' } }));

    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ data: { name: 'Kickoff' } });

    await restRequestAction.execute(CTX, parse({ ...GOOD, input: { documentId: 'm-12' } }));

    expect(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toBe('{}');
  });

  it('resolves built-in dates in the workspace\'s zone, on the server, and sends query on an action', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T23:30:00Z'));
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'planner', kind: 'plugin', configJson: {
      _connector: 'rest',
      actions: [{ name: 'plan_week', method: 'POST', path: '/api/plans', query: { dryRun: '{dryRun}' }, input: { type: 'object', properties: { dryRun: { type: 'boolean' } } }, body: { data: { from: '{$weekStart}', to: '{$today+7d}' } } }],
    } });
    const f = vi.fn(async () => res(200, {}));
    vi.stubGlobal('fetch', f);
    try {
      await restRequestAction.execute(CTX, parse({ sourceSlug: 'planner', action: 'plan_week', input: { dryRun: true }, summary: 'Plan the week.' }));
    } finally {
      vi.useRealTimers();
    }
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    // No project row here, so the zone is the server default (UTC): still 2026-09-29.
    expect(url).toBe('https://api.northwind.example/api/plans?dryRun=true');
    expect(JSON.parse(String(init.body))).toEqual({ data: { from: '2026-09-28', to: '2026-10-06' } });
  });

  it('fails the run on a non-2xx, with the API\'s answer as the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { error: { message: 'dueDate must be a date' } })));

    await expect(restRequestAction.execute(CTX, parse(GOOD))).rejects.toThrow(/update_milestone failed: The API answered 400.*dueDate must be a date/);
  });

  it('refuses without a credential, and without touching the API', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);

    await expect(restRequestAction.execute({ orgId: ORG }, parse(GOOD))).rejects.toThrow(/credential.*"acme-delivery"/);
    expect(f).not.toHaveBeenCalled();
  });
});
