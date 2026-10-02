/**
 * `describe_sources` answers "which repositories do you have access to?" from
 * the source's own list checked against what GitHub says the installation
 * grants — not from the index, not from the operating intent. These pin that
 * the live answer wins, that a repository the source lists but the app was not
 * granted is named as such, that an unconnected source says so, and that a
 * source outside the agent's `connectorSources` is never described.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  credentialStatusForOrg: vi.fn(),
  getCredentialsForSource: vi.fn(),
}));
vi.mock('@/libs/connect/summary', () => ({ grantSummaryForSource: vi.fn() }));
vi.mock('@/libs/connect/providers/github', () => ({ installationRepositories: vi.fn() }));
vi.mock('@/libs/github/app', () => ({
  installationIdFrom: (c?: Record<string, unknown>) => (typeof c?.installationId === 'string' ? c.installationId : undefined),
  installationToken: vi.fn(async () => 'ghs_installation'),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { credentialStatusForOrg, getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { grantSummaryForSource } = await import('@/libs/connect/summary');
const { installationRepositories } = await import('@/libs/connect/providers/github');
const { describeSourcesTool, repositoryLines, scopeLines } = await import('./describeSources');

const ORG = 'org_describe_sources';

function ctxFor(connectorSources: string[]): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'product-manager',
    connectorSources,
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { invoke: (input: Record<string, unknown>) => Promise<string> };
const call = (tool: unknown, args: Record<string, unknown> = {}) => (tool as Invokable).invoke(args);

async function createSource(slug: string, config: Record<string, unknown>): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson: config })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
  vi.mocked(credentialStatusForOrg).mockResolvedValue({ bySourceId: {}, byConnectorSlug: {} });
  vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);
  vi.mocked(grantSummaryForSource).mockResolvedValue(null);
  vi.mocked(installationRepositories).mockResolvedValue([]);
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('describe_sources', () => {
  it('names the repositories the source lists against what GitHub says the installation grants, live', async () => {
    const id = await createSource('github', { _connector: 'github', repos: ['The-NocoCompany/warranty-app', 'The-NocoCompany/noco-sales'], branchPrefix: 'factory/', deployBranch: 'main' });
    vi.mocked(credentialStatusForOrg).mockResolvedValue({ bySourceId: { [id]: { connected: true, updatedAt: '2026-09-30T21:17:00.000Z', broken: null } }, byConnectorSlug: {} });
    vi.mocked(getCredentialsForSource).mockResolvedValue({ installationId: '777', account: 'The-NocoCompany' });
    vi.mocked(grantSummaryForSource).mockResolvedValue({ account: 'The-NocoCompany (organization)', granted: { label: 'Repositories', items: ['stale-snapshot/ignored'] } });
    vi.mocked(installationRepositories).mockResolvedValue(['The-NocoCompany/warranty-app', 'The-NocoCompany/amazon-ads-reporting']);
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId: id,
      status: 'completed',
      startedAt: new Date('2026-09-30T21:20:00.000Z'),
      completedAt: new Date('2026-09-30T21:20:30.000Z'),
      counts: { created: 0, updated: 0, unchanged: 0, errors: 0, skipped: 12 },
      skipped: [{ uri: 'https://github.com/The-NocoCompany/warranty-app/pull/58', message: 'branch fix-date-range-last-day is outside the factory/ prefix', at: '2026-09-30T21:20:10.000Z' }],
    });

    const out = await call(describeSourcesTool(ctxFor(['github', 'jira'])));

    expect(out).toContain('github (github connector)');
    expect(out).toContain('Repositories: The-NocoCompany/warranty-app, The-NocoCompany/noco-sales');
    expect(out).toContain('Only branches starting with: factory/');
    expect(out).toContain('Connected as: The-NocoCompany (organization)');
    // The live answer, not the stored snapshot.
    expect(out).toContain('asked of GitHub now');
    expect(out).not.toContain('stale-snapshot');
    expect(out).toContain('The-NocoCompany/warranty-app — in the source\'s list and granted to the app');
    expect(out).toContain('The-NocoCompany/noco-sales — in the source\'s list but NOT granted to the app');
    expect(out).toContain('The-NocoCompany/amazon-ads-reporting — granted to the app but not in the source\'s list');
    // Why the index is empty, in the same answer.
    expect(out).toContain('read 12 items and kept none: branch fix-date-range-last-day is outside the factory/ prefix');
    expect(out).toContain('0 documents in the index');
    // Nothing secret made it into the text.
    expect(out).not.toContain('ghs_installation');
    expect(out).not.toContain('777');
  });

  it('says when nothing is connected, and never describes a source the agent cannot read', async () => {
    await createSource('jira', { _connector: 'jira', projectKeys: ['NOCO'], baseUrl: 'https://metacto.atlassian.net' });
    await createSource('slack', { _connector: 'slack' });

    const out = await call(describeSourcesTool(ctxFor(['jira'])));

    expect(out).toContain('jira (jira connector)');
    expect(out).toContain('Jira projects: NOCO');
    expect(out).toContain('Credential: none stored');
    expect(out).not.toContain('slack (');
    expect(await call(describeSourcesTool(ctxFor(['jira'])), { source: 'slack' })).toContain('No connected source named "slack" is readable by this agent');
  });

  it('keeps credentials and plumbing out of the scope lines', () => {
    expect(scopeLines({ _connector: 'github', repos: ['a/b'], apiToken: 'x', schedule: '*/5 * * * *', lookbackDays: 7, deployBranch: 'main' }))
      .toEqual(['Repositories: a/b', 'Deploy branch: main']);
    expect(repositoryLines(['a/b'], ['a/b', 'a/c'], false)).toEqual([
      '  - a/b — in the source\'s list and granted to the app (as of connecting)',
      '  - a/c — granted to the app but not in the source\'s list, so it is not read',
    ]);
  });
});
