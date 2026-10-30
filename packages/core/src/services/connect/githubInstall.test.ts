/**
 * After a GitHub install: the connection agents read is made from the
 * install's repositories, a Project's repository the install does not cover
 * gets its card, and a request reads as waiting on an owner. Fictional
 * organizations throughout.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const rooms = vi.hoisted(() => ({ list: [] as Array<{ id: number; title: string; meta: Record<string, unknown> }> }));
vi.mock('@/services/DataRoomService', () => ({ listDataRooms: vi.fn(async () => rooms.list) }));

const raised = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@/services/decisions/DecisionService', () => ({
  raiseDecision: vi.fn(async (input: { question: string; options: unknown[] }) => {
    raised.calls.push(input);
    return { view: { id: 900 + raised.calls.length, question: input.question, options: input.options, state: 'open' }, created: true };
  }),
}));

const ORG = 'org_ghinstall';
const created = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>>, projects: [] as Array<number | undefined>, made: 0 }));
vi.mock('./createSourceOnLogin', () => ({
  createSourceOnLogin: vi.fn(async (input: { orgId: string; config: Record<string, unknown>; projectId?: number }) => {
    created.configs.push(input.config);
    created.projects.push(input.projectId);
    const { db } = await import('@/libs/DB');
    const { knowledgeSourceSchema } = await import('@/models/Schema');
    await db.insert(knowledgeSourceSchema).values({ orgId: input.orgId, slug: `github-${++created.made}`, configJson: { ...input.config, _connector: 'github' }, ...(input.projectId ? { dataRoomId: input.projectId } : {}) });
    return { ok: true, sourceId: 1, slug: 'github', created: true };
  }),
  newestLiveCredential: vi.fn(async () => ({ account: 'example-agency (organization)' })),
}));

const { db } = await import('@/libs/DB');
const { askSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { coverageAsk, finishGithubInstall, noteRequestOnAsk, repoPickerAsk, requestedOrg, requestedSummary, uncoveredTargets } = await import('./githubInstall');

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct_ghinstall', name: 'Example Agency', slug: 'example-agency-gh' } as never);
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_ghinstall', slug: 'ghinstall', name: 'Example Agency' } as never);
});

beforeEach(() => {
  raised.calls = [];
  created.configs = [];
  created.projects = [];
  rooms.list = [
    { id: 12, title: 'Northwind Home Services', meta: { publishTargets: [{ id: 'site', kind: 'github', config: { repo: 'northwind-co/website', path: 'src/content/blog/{slug}.mdx' } }] } },
    { id: 13, title: 'Example Agency', meta: { publishTargets: [{ id: 'site', kind: 'github', config: { repo: 'example-agency/handbook', path: 'posts/{slug}.md' } }] } },
    { id: 14, title: 'Juniper Bakery', meta: { publishTargets: [{ id: 'site', kind: 'squarespace', config: { siteUrl: 'https://juniper.example' } }] } },
  ];
});

describe('pure', () => {
  it('a target is covered by its repository, case aside', () => {
    const targets = [{ projectId: 12, projectTitle: 'Northwind', repo: 'northwind-co/Website' }, { projectId: 13, projectTitle: 'Agency', repo: 'example-agency/handbook' }];

    expect(uncoveredTargets(targets, ['northwind-co/website']).map(t => t.projectId)).toEqual([13]);
  });

  it('the coverage card names the repo, its organization, the install, and both ways on', () => {
    const ask = coverageAsk({ repo: 'northwind-co/website', account: 'example-agency (organization)', projectTitle: 'Northwind Home Services', startHref: '/api/connect/github/start?connector=github' });

    expect(ask.question).toBe('northwind-co/website is in northwind-co, which this install doesn\'t cover');
    expect(ask.body).toMatch(/Install on northwind-co \(needs an owner of northwind-co\), or send the owner a request/);
    expect(ask.options.map(o => [o.id, o.label])).toEqual([['install:github', 'Install on northwind-co'], ['request:github', 'Ask an owner of northwind-co']]);
    // Not `connect:github`: the card must not answer itself because GitHub is connected elsewhere.
    expect(ask.options.some(o => o.id.startsWith('connect:'))).toBe(false);
  });

  it('a request is a waiting state with the organization', () => {
    expect(requestedSummary('northwind-co')).toBe('Install requested: waiting for an owner of northwind-co to approve it');
    expect(requestedSummary(null)).toMatch(/the GitHub organization/);
  });

  it('the repo picker offers the connection\'s repos, the one named like the client first', () => {
    const ask = repoPickerAsk('Northwind Home Services', ['example-agency/handbook', 'northwind-co/website', 'example-agency/tools']);

    expect(ask.question).toBe('Which repo is Northwind Home Services\'s site?');
    expect(ask.options[0]).toEqual({ id: 'repo:northwind-co/website', label: 'northwind-co/website', recommended: true });
    expect(ask.options).toHaveLength(3);
  });
});

describe('finishGithubInstall', () => {
  it('makes the GitHub source from the install\'s repositories and raises the card for the project it does not cover', async () => {
    const out = await finishGithubInstall({
      orgId: ORG,
      userId: 'usr-admin',
      conversationId: 41,
      startHref: '/api/connect/github/start?connector=github&conversation=41',
      credentials: { installationId: '501', account: 'example-agency', repositories: ['example-agency/handbook'] },
    });

    expect(created.configs).toEqual([{ repos: ['example-agency/handbook'] }]);
    expect(out.sourceSaved).toBe(true);
    expect(out.uncovered.map(t => t.repo)).toEqual(['northwind-co/website']);
    expect(raised.calls).toHaveLength(1);
    expect(raised.calls[0]).toMatchObject({ conversationId: 41, kind: 'setup', question: 'northwind-co/website is in northwind-co, which this install doesn\'t cover', objectRefs: [{ type: 'data_room', id: '12' }] });
  });

  it('an install covering every target raises no card', async () => {
    rooms.list = rooms.list.filter(r => r.id !== 12);
    const out = await finishGithubInstall({ orgId: ORG, userId: 'usr-admin', conversationId: 42, startHref: '/x', credentials: { account: 'example-agency', repositories: ['example-agency/handbook'] } });

    expect(out.uncovered).toEqual([]);
    expect(raised.calls).toHaveLength(0);
  });
});

describe('project-scoped connections (#1505)', () => {
  it('an install started for a project is that project\'s connection, and covers only that project', async () => {
    const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'data_room', label: 'Project' } as never).returning();
    const [room] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Juniper Bakery' } as never).returning();
    rooms.list = [{ id: room!.id, title: 'Juniper Bakery', meta: { publishTargets: [{ id: 'site', kind: 'github', config: { repo: 'juniper-co/site', path: 'posts/{slug}.md' } }] } }];

    const out = await finishGithubInstall({ orgId: ORG, userId: 'usr-admin', projectId: room!.id, startHref: '/x', credentials: { account: 'juniper-co', repositories: ['juniper-co/site'] } });

    expect(created.projects).toEqual([room!.id]);
    expect(out.uncovered).toEqual([]);

    const { connectedGithubRepos } = await import('./githubInstall');

    expect(await connectedGithubRepos(ORG, room!.id)).toContain('juniper-co/site');
    // Another project's work, or work for no project, never reaches it.
    expect(await connectedGithubRepos(ORG, null)).not.toContain('juniper-co/site');
  });
});

describe('the request state', () => {
  it('names the one organization the projects are still waiting on', async () => {
    expect(await requestedOrg(ORG)).toBe('northwind-co');
  });

  it('is put on the conversation\'s open GitHub connect card', async () => {
    const [row] = await db.insert(askSchema).values({ orgId: ORG, kind: 'setup', title: 'Connect GitHub', conversationId: 55, options: [{ id: 'connect:github', label: 'Log in with GitHub', href: '/api/connect/github/start?connector=github' }] }).returning();
    const [other] = await db.insert(askSchema).values({ orgId: ORG, kind: 'setup', title: 'Connect Slack', conversationId: 55, options: [{ id: 'connect:slack', label: 'Log in with Slack' }] }).returning();

    await noteRequestOnAsk(ORG, 55, requestedSummary('northwind-co'));

    const { eq } = await import('drizzle-orm');
    const [after] = await db.select().from(askSchema).where(eq(askSchema.id, row!.id));
    const [untouched] = await db.select().from(askSchema).where(eq(askSchema.id, other!.id));

    expect(after!.body).toMatch(/^Install requested: waiting for an owner of northwind-co to approve it \(requested [A-Z][a-z]{2} \d+\)\. Once they approve, connect again here/);
    expect(after!.status).toBe('open');
    expect(untouched!.body).toBeNull();
  });
});
