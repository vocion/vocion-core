/**
 * Linear connector against recorded GraphQL answers: it syncs a team's issues
 * as documents keyed by Linear's immutable id, asks only for what changed on
 * an incremental run, keeps finished issues inside the window on a full one,
 * turns a GraphQL error into a sentence, and checks each team key on Test
 * connection. The teams and issues are invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { linearAuthorization, linearConnector, linearGraphql, linearStatusCategory, linearSyncFilter } from './linear';

function graphql(answers: Array<(body: { query: string; variables: Record<string, unknown> }) => unknown>) {
  const bodies: Array<{ query: string; variables: Record<string, unknown>; auth: string }> = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    bodies.push({ ...body, auth: (init.headers as Record<string, string>).authorization ?? '' });
    const answer = answers[Math.min(i, answers.length - 1)]!(body);
    i += 1;
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
  return bodies;
}

async function collect(docs: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of docs) {
    out.push(d);
  }
  return out;
}

const issue = (n: number, type = 'started') => ({
  id: `0b1c-${n}`,
  identifier: `ENG-${n}`,
  title: `Fix the export ${n}`,
  description: 'Exports time out over 10k rows.',
  url: `https://linear.app/acme/issue/ENG-${n}`,
  priorityLabel: 'High',
  updatedAt: '2026-10-01T00:00:00Z',
  state: { id: 's1', name: type === 'completed' ? 'Done' : 'In Progress', type },
  team: { id: 't1', key: 'ENG', name: 'Engineering' },
  assignee: { name: 'Jamie Smith', email: 'jamie@acme.example' },
  labels: { nodes: [{ id: 'l1', name: 'Bug' }] },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('linear sync', () => {
  it('yields each issue keyed by its id, paging by cursor, with a personal key sent bare', async () => {
    const bodies = graphql([
      () => ({ data: { issues: { nodes: [issue(1)], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } }),
      () => ({ data: { issues: { nodes: [issue(2, 'completed')], pageInfo: { hasNextPage: false, endCursor: null } } } }),
    ]);
    const ctx: SourceContext = { sourceId: 1, orgId: 'org_1', config: { projectKeys: ['eng'] }, credentials: { token: 'lin_api_northwind' } };

    const docs = await collect(linearConnector.sync(ctx));

    expect(docs.map(d => d.externalId)).toEqual(['linear:0b1c-1', 'linear:0b1c-2']);
    expect(docs[0]).toMatchObject({ title: '[ENG-1] Fix the export 1', uri: 'https://linear.app/acme/issue/ENG-1', metadata: { key: 'ENG-1', projectKey: 'ENG', statusCategory: 'indeterminate', completed: false, labels: ['Bug'] } });
    expect(docs[1]!.metadata).toMatchObject({ statusCategory: 'done', completed: true });
    expect(bodies[0]!.auth).toBe('lin_api_northwind');
    expect(bodies[1]!.variables.after).toBe('c1');
    expect(bodies[0]!.variables.filter).toMatchObject({ team: { key: { in: ['ENG'] } } });
  });

  it('builds an incremental filter from the watermark and a full one that ages finished issues out', () => {
    const now = new Date('2026-10-08T12:00:00Z');

    expect(linearSyncFilter({ projectKeys: ['ENG'], since: new Date('2026-10-08T11:00:00Z'), doneWindowDays: 90, now })).toEqual({ team: { key: { in: ['ENG'] } }, updatedAt: { gte: '2026-10-08T10:55:00.000Z' } });
    expect(linearSyncFilter({ projectKeys: ['ENG'], since: null, doneWindowDays: 30, now })).toEqual({ team: { key: { in: ['ENG'] } }, or: [{ state: { type: { nin: ['completed', 'canceled'] } } }, { updatedAt: { gte: '2026-09-08T12:00:00.000Z' } }] });
    expect(linearStatusCategory('backlog')).toBe('new');
    expect(linearAuthorization('oauth-token')).toBe('Bearer oauth-token');
  });

  it('turns a GraphQL refusal into a sentence, and fails the sync with it', async () => {
    graphql([() => ({ errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] })]);

    await expect(linearGraphql('lin_api_bad', 'query { viewer { id } }')).resolves.toMatchObject({ ok: false, kind: 'unauthorized', message: expect.stringContaining('Authentication required') });
    await expect(collect(linearConnector.sync({ sourceId: 1, orgId: 'org_1', config: { projectKeys: ['ENG'] }, credentials: { token: 'lin_api_bad' } }))).rejects.toThrow(/Linear refused the request/);
  });

  it('Test connection names the account and checks every team key', async () => {
    graphql([() => ({ data: { viewer: { name: 'Jamie Smith', organization: { name: 'Acme' } }, teams: { nodes: [{ key: 'ENG', name: 'Engineering' }] } } })]);

    const out = await linearConnector.inspect!({ config: { projectKeys: ['ENG', 'OPS'] }, credentials: { token: 'lin_api_northwind' }, options: {} }) as { checks: Array<{ key: string; ok: boolean }>; error: string };

    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['account', true], ['team:ENG', true], ['team:OPS', false]]);
    expect(out.error).toMatch(/it sees ENG/);
  });
});
