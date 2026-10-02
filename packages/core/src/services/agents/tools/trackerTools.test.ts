/**
 * The tracker reads: present only for an agent with a tracker source, each
 * answering through the source's provider. The provider is mocked; the issues
 * are invented.
 */
import type { RuntimeContext } from '../types';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  kind: 'jira',
  projectKeys: ['NW'],
  readIssue: vi.fn(async (key: string) => ({ key, summary: 'Totals are off', status: 'To Do', comments: [], attachments: [{ id: '55', filename: 'shot.png' }] })),
  searchIssues: vi.fn(async () => [{ key: 'NW-7', summary: 'Totals are off', status: 'To Do', assignee: null, updated: null, url: 'https://acme.atlassian.net/browse/NW-7' }]),
  readAttachment: vi.fn(async (id: string) => (id === '55'
    ? { filename: 'shot.png', mimeType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47]) }
    : { filename: 'notes.md', mimeType: 'text/markdown', bytes: Buffer.from('# Notes\nSeen on prod.') })),
}));
const resolved = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock('@/services/tracker/provider', () => ({ trackerProviderFor: async (_org: string, opts: unknown) => {
  resolved.args.push(opts);
  return provider;
} }));
vi.mock('@/libs/tools/artifacts/store', () => ({ saveArtifact: async (input: { ext: string }) => ({ url: `/api/artifacts/org_1-abc.${input.ext}` }) }));

const { trackerTools } = await import('./trackerTools');

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'product-manager', connectorSources: sources, sourceKinds: kinds, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

describe('the tracker reads', () => {
  it('exist only for an agent whose sources include a tracker, by kind', () => {
    expect(trackerTools(ctxFor([]))).toHaveLength(0);
    expect(trackerTools(ctxFor(['github']))).toHaveLength(0);
    expect((trackerTools(ctxFor(['jira'])) as unknown as Invokable[]).map(t => t.name)).toEqual(['tracker_read_issue', 'tracker_search_issues', 'tracker_read_attachment']);
    expect(trackerTools(ctxFor(['noco-board'], { 'noco-board': 'jira' }))).toHaveLength(3);
  });

  it('reads an issue through the provider the key resolves to', async () => {
    const [read] = trackerTools(ctxFor(['jira'])) as unknown as Invokable[];
    const out = JSON.parse(await read!.invoke({ key: 'nw-7' }));

    expect(resolved.args.at(-1)).toEqual({ issueKey: 'nw-7' });
    expect(provider.readIssue).toHaveBeenCalledWith('NW-7');
    expect(out).toMatchObject({ ok: true, tracker: 'jira', issue: { key: 'NW-7', summary: 'Totals are off' } });
  });

  it('searches inside the configured projects and says so', async () => {
    const [, search] = trackerTools(ctxFor(['jira'])) as unknown as Invokable[];
    const out = JSON.parse(await search!.invoke({ query: 'status = "To Do"', limit: 5 }));

    expect(provider.searchIssues).toHaveBeenCalledWith('status = "To Do"', 5);
    expect(out).toMatchObject({ ok: true, projects: ['NW'], count: 1, issues: [{ key: 'NW-7' }] });
  });

  it('stores an image attachment and returns text for a text one', async () => {
    const [, , attachment] = trackerTools(ctxFor(['jira'])) as unknown as Invokable[];

    expect(JSON.parse(await attachment!.invoke({ attachment_id: '55', issue_key: 'NW-7' }))).toMatchObject({ ok: true, filename: 'shot.png', url: '/api/artifacts/org_1-abc.png' });
    expect(JSON.parse(await attachment!.invoke({ attachment_id: '56' }))).toMatchObject({ ok: true, filename: 'notes.md', text: '# Notes\nSeen on prod.' });
  });
});
