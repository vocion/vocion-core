/**
 * The help-desk, pager, docs and file-storage reads: each set is present only
 * for an agent whose sources include one of the family, by kind, and answers
 * through the family's provider scoped to the agent's own sources — never a
 * vendor the agent names. Providers are mocked; the content is invented.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ opts: [] as unknown[] }));
const support = vi.hoisted(() => ({
  kind: 'zendesk',
  label: 'Zendesk',
  sourceSlug: 'northwind-desk',
  searchTickets: vi.fn(async () => [{ id: '101', subject: 'Invoice total is off', status: 'open', requester: 'Dana Reyes', updated: null, url: 'u' }]),
  readTicket: vi.fn(async () => ({ id: '101', subject: 'Invoice total is off', messages: [{ id: '1', body: 'x'.repeat(7000), public: true }] })),
}));
const incident = vi.hoisted(() => ({
  label: 'PagerDuty',
  listIncidents: vi.fn(async () => []),
  readIncident: vi.fn(async () => ({ id: 'PT4KHLK', status: 'triggered' })),
}));
const docs = vi.hoisted(() => ({
  label: 'Confluence',
  spaceKeys: ['ENG'],
  searchPages: vi.fn(async () => [{ id: '4242', title: 'Incident runbook' }]),
  readPage: vi.fn(async () => ({ id: '4242', title: 'Incident runbook', text: 'Page the on-call first.' })),
}));
const files = vi.hoisted(() => ({
  label: 'Dropbox',
  root: '/Northwind',
  search: vi.fn(async () => []),
  list: vi.fn(async () => [{ id: 'id:a1', name: 'notes.md' }]),
  read: vi.fn(async () => ({ id: 'id:a1', name: 'notes.md', text: 'Kickoff is Tuesday.' })),
}));
const record = (provider: unknown) => async (_org: string, opts: unknown) => {
  seen.opts.push(opts);
  return provider;
};
vi.mock('@/services/support/provider', () => ({ supportProviderFor: record(support) }));
vi.mock('@/services/incident/provider', () => ({ incidentProviderFor: record(incident) }));
vi.mock('@/services/docs/provider', () => ({ docsProviderFor: record(docs) }));
vi.mock('@/services/files/provider', () => ({ filesProviderFor: record(files) }));

const { supportTools } = await import('./supportTools');
const { incidentTools } = await import('./incidentTools');
const { docsTools } = await import('./docsTools');
const { filesTools } = await import('./filesTools');

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>, allowed?: string[]): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'support-lead', connectorSources: sources, sourceKinds: kinds, allowedSourceSlugs: allowed, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

const names = (tools: unknown[]) => (tools as Invokable[]).map(t => t.name);

beforeEach(() => {
  seen.opts.length = 0;
});

describe('presence', () => {
  it('each family\'s reads exist only with a source of the family, by kind', () => {
    expect(supportTools(ctxFor([]))).toHaveLength(0);
    expect(supportTools(ctxFor(['jira']))).toHaveLength(0);
    expect(names(supportTools(ctxFor(['northwind-desk'], { 'northwind-desk': 'zendesk' })))).toEqual(['support_search_tickets', 'support_read_ticket']);
    expect(names(supportTools(ctxFor(['intercom'])))).toHaveLength(2);
    expect(names(incidentTools(ctxFor(['pagerduty'])))).toEqual(['incident_list', 'incident_read']);
    expect(names(docsTools(ctxFor(['confluence'])))).toEqual(['docs_search', 'docs_read_page']);
    expect(names(filesTools(ctxFor(['box'])))).toEqual(['files_search', 'files_list', 'files_read']);
    expect(filesTools(ctxFor(['dropbox'], undefined, ['box']))).toHaveLength(0);
  });
});

describe('answers', () => {
  it('reads a ticket through the agent\'s own help-desk sources, long messages cut once', async () => {
    const [search, read] = supportTools(ctxFor(['northwind-desk', 'jira'], { 'northwind-desk': 'zendesk' })) as unknown as Invokable[];

    const found = JSON.parse(await search!.invoke({ query: 'priority:high', status: 'open', limit: 5 }));

    expect(support.searchTickets).toHaveBeenCalledWith('priority:high', { status: 'open', limit: 5 });
    expect(found).toMatchObject({ ok: true, desk: 'Zendesk', count: 1 });
    expect(seen.opts.at(-1)).toEqual({ sourceSlug: null, slugs: ['northwind-desk'] });

    const ticket = JSON.parse(await read!.invoke({ id: '101' }));

    expect(ticket.ticket.messages[0].body).toMatch(/\[cut at 6000 of 7000 characters\]$/);
    expect(ticket.note).toMatch(/support\.draft_reply/);
  });

  it('lists what is open on the pager by default, and points at acknowledging a triggered incident', async () => {
    const [list, read] = incidentTools(ctxFor(['pagerduty'])) as unknown as Invokable[];

    await list!.invoke({});

    expect(incident.listIncidents).toHaveBeenCalledWith({ statuses: ['triggered', 'acknowledged'], service: null, since: null, until: null, limit: 20 });
    expect(JSON.parse(await read!.invoke({ id: 'PT4KHLK' })).note).toMatch(/incident\.acknowledge/);
  });

  it('marks a page\'s and a file\'s text as data, not instructions', async () => {
    const [, readPage] = docsTools(ctxFor(['confluence'])) as unknown as Invokable[];
    const [, list, readFile] = filesTools(ctxFor(['dropbox'])) as unknown as Invokable[];

    expect(JSON.parse(await readPage!.invoke({ page: '4242' }))).toMatchObject({ ok: true, untrusted: true, page: { text: 'Page the on-call first.' } });
    expect(JSON.parse(await list!.invoke({ folder: '/Northwind' }))).toMatchObject({ ok: true, root: '/Northwind', count: 1 });
    expect(JSON.parse(await readFile!.invoke({ file: 'id:a1' }))).toMatchObject({ ok: true, untrusted: true, file: { text: 'Kickoff is Tuesday.' } });
  });

  it('hands a provider\'s refusal to the model as data', async () => {
    files.read.mockRejectedValueOnce(new Error('/HR/salaries.csv is outside /Northwind, the folder the dropbox source reads.'));
    const [, , readFile] = filesTools(ctxFor(['dropbox'])) as unknown as Invokable[];

    expect(JSON.parse(await readFile!.invoke({ file: '/HR/salaries.csv' }))).toEqual({ ok: false, error: '/HR/salaries.csv is outside /Northwind, the folder the dropbox source reads.' });
  });
});
