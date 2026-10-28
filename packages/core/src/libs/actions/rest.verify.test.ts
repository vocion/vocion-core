/**
 * rest.request with a list argument and `verify` — the path a set of linked
 * ticket keys takes from a proposal to a card:
 *
 *   - The list is normalized (trimmed, upper-cased, deduped) before it is
 *     validated, checked, shown or sent, and capped and pattern-checked.
 *   - Each entry is read through the source's own declared tool before any
 *     card exists; a wrong kind is refused naming the entry and its kind.
 *   - The "currently" the card shows is checked against the record.
 *   - The card reads a list as words, an empty list as "none", and the body
 *     carries `[]` so an empty list clears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(async () => ({ baseUrl: 'https://api.northwind.example', token: 'tok-fixture' })),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { restRequestAction } = await import('./rest');

const ORG = 'org_rest_verify_fixture';
const KEY = { type: 'string', normalize: ['trim', 'uppercase'], pattern: '^[A-Z][A-Z0-9_]+-[1-9][0-9]*$' };

const CONFIG = {
  tools: [
    {
      name: 'get_issue',
      method: 'GET',
      path: '/api/issue/{issueKey}/{projectId}',
      input: { type: 'object', properties: { projectId: { type: 'string' }, issueKey: { type: 'string' } }, required: ['projectId', 'issueKey'] },
      response: { pick: 'ticket' },
    },
    {
      name: 'get_milestone',
      method: 'GET',
      path: '/api/milestones',
      input: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] },
      query: { 'filters[documentId][$eq]': '{documentId}' },
      response: { pick: 'data' },
    },
  ],
  actions: [
    {
      name: 'update_milestone',
      method: 'PUT',
      path: '/api/milestones/{documentId}',
      input: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          projectId: { type: 'string' },
          epicKeys: { type: 'array', maxItems: 10, uniqueItems: true, items: KEY },
          previousEpicKeys: { type: 'array', maxItems: 10, uniqueItems: true, items: KEY },
        },
        required: ['documentId'],
      },
      body: { data: { epicKeys: '{epicKeys}' } },
      verify: [
        {
          each: 'epicKeys',
          tool: 'get_issue',
          input: { projectId: '{projectId}', issueKey: '{item}' },
          expect: { path: 'fields.issuetype.name', in: ['Epic'] },
          also: { parent: 'fields.parent.key' },
          refuse: '{item} is a {found}, not an Epic (its parent: {parent}).',
        },
        {
          when: 'epicKeys',
          tool: 'get_milestone',
          input: { documentId: '{documentId}' },
          expect: { path: '0.epicKeys', sameItemsAs: 'previousEpicKeys' },
          refuse: 'The milestone currently links {found}; pass exactly that as previousEpicKeys.',
        },
      ],
      review: {
        fields: [
          { label: 'Epics now', value: '{previousEpicKeys}' },
          { label: 'Epics after', value: '{epicKeys}' },
        ],
      },
    },
  ],
};

const ISSUES: Record<string, unknown> = {
  'ACME-1': { fields: { issuetype: { name: 'Epic' } } },
  'ACME-2': { fields: { issuetype: { name: 'Epic' } } },
  'ACME-7': { fields: { issuetype: { name: 'Story' }, parent: { key: 'ACME-1' } } },
};

function res(status: number, body: unknown): Response {
  return { ok: status < 300, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

/**
 * The API: issues by key, and one milestone.
 * @param current - The keys the milestone links.
 */
function api(current: unknown = ['ACME-7']) {
  return vi.fn(async (url: string) => {
    const issue = /\/api\/issue\/([^/]+)\//.exec(url);
    if (issue) {
      const found = ISSUES[decodeURIComponent(issue[1]!)];
      return found ? res(200, { success: true, ticket: found }) : res(400, { error: { message: `Ticket ${issue[1]} not found` } });
    }
    return res(200, { data: [{ documentId: 'm-1', epicKeys: current }] });
  });
}

function proposal(input: Record<string, unknown>) {
  return restRequestAction.inputSchema.parse({ sourceSlug: 'acme', action: 'update_milestone', input: { documentId: 'm-1', projectId: 'p-1', ...input }, summary: 'Link the milestone to its epics.' });
}

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'acme', kind: 'plugin', configJson: { ...CONFIG, _connector: 'rest', _name: 'Acme' } });
});

afterEach(() => vi.unstubAllGlobals());

describe('precheck', () => {
  it('lets a set of epics through, read once per key after normalizing', async () => {
    const f = api();
    vi.stubGlobal('fetch', f);

    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: [' acme-1', 'ACME-2', 'acme-1 '], previousEpicKeys: ['acme-7'] }))).resolves.toBeUndefined();

    const urls = f.mock.calls.map(call => String(call[0]));

    expect(urls.filter(u => u.includes('/api/issue/')).sort()).toEqual([
      'https://api.northwind.example/api/issue/ACME-1/p-1',
      'https://api.northwind.example/api/issue/ACME-2/p-1',
    ]);
  });

  it('refuses a story key, naming it, its kind and its parent', async () => {
    vi.stubGlobal('fetch', api());

    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: ['ACME-1', 'ACME-7'], previousEpicKeys: ['ACME-7'] })))
      .resolves
      .toBe('update_milestone was not proposed: ACME-7 is a Story, not an Epic (its parent: ACME-1).');
  });

  it('refuses a "currently" that is not what the milestone links', async () => {
    vi.stubGlobal('fetch', api());

    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: ['ACME-1'] })))
      .resolves
      .toBe('update_milestone was not proposed: The milestone currently links ACME-7; pass exactly that as previousEpicKeys.');
  });

  it('refuses a malformed key or too many before any read', async () => {
    const f = api();
    vi.stubGlobal('fetch', f);

    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: ['ACME 1'] }))).resolves.toMatch(/epicKeys\.0: "ACME 1" does not match/);
    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: Array.from({ length: 11 }, (_, i) => `ACME-${i + 1}`) }))).resolves.toMatch(/epicKeys: at most 10 entries/);
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses when the key cannot be checked, in the API\'s words', async () => {
    vi.stubGlobal('fetch', api());

    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: ['ACME-404'], previousEpicKeys: ['ACME-7'] })))
      .resolves
      .toMatch(/^update_milestone was not proposed: ACME-404: could not be checked \(get_issue: The API answered 400.*Ticket ACME-404 not found/);
  });

  it('lets an empty list through to clear the links, with no key reads', async () => {
    const f = api();
    vi.stubGlobal('fetch', f);

    await expect(restRequestAction.precheck!({ orgId: ORG }, proposal({ epicKeys: [], previousEpicKeys: ['ACME-7'] }))).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('the card and the request', () => {
  it('shows the old and new lists as words, normalized, and sends the same list', async () => {
    const card = await restRequestAction.reviewCard!({ orgId: ORG }, proposal({ epicKeys: [' acme-1', 'acme-2', 'ACME-1'], previousEpicKeys: ['ACME-7'] }));

    expect(card.fields.slice(0, 2)).toEqual([
      { label: 'Epics now', value: 'ACME-7' },
      { label: 'Epics after', value: 'ACME-1, ACME-2' },
    ]);
    expect(card.content?.[0]).toMatchObject({ body: expect.stringContaining('"ACME-1",\n      "ACME-2"') });
  });

  it('reads an empty list as "none" on the card and sends [] to clear', async () => {
    const card = await restRequestAction.reviewCard!({ orgId: ORG }, proposal({ epicKeys: [], previousEpicKeys: ['ACME-7'] }));

    expect(card.fields.slice(0, 2)).toEqual([
      { label: 'Epics now', value: 'ACME-7' },
      { label: 'Epics after', value: 'none' },
    ]);

    const f = vi.fn(async () => res(200, { data: { documentId: 'm-1' } }));
    vi.stubGlobal('fetch', f);
    await restRequestAction.execute({ orgId: ORG, credentials: { baseUrl: 'https://api.northwind.example', token: 'tok-fixture' } }, proposal({ epicKeys: [], previousEpicKeys: ['ACME-7'] }));

    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ data: { epicKeys: [] } });
  });
});
