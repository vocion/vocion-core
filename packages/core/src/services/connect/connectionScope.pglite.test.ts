/**
 * Project-scoped connections on PGlite (`connectionScope.ts`): a connection
 * can belong to one Project, and only that project's work uses it. The
 * resolver gives work for a project the workspace's connections and its own,
 * never another project's; GitHub tokens, credentials by slug, publishing and
 * the agent's sources all read through it; the work's project comes from what
 * the work carries (a conversation's scope, the page's record, an SEO page's
 * `projectId`, a mission run, a job's input). An agency's two clients here are
 * fictional: Northwind Home Services and Kestrel Capital.
 */
import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
// The vault is not what is under test: every stored credential decrypts to a token named after its row.
vi.mock('@/services/SourceCredentialService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/SourceCredentialService')>();
  return { ...actual, getCredentialsForConnector: vi.fn(async (input: { apiTokenId: string | null }) => (input.apiTokenId ? { token: `pat-${input.apiTokenId}` } : undefined)) };
});
vi.mock('@/libs/github/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/github/client')>();
  return { ...actual, resolveGithubToken: vi.fn(async (c?: { token?: string }) => c?.token) };
});

const { db } = await import('@/libs/DB');
const { conversationSchema, knowledgeSourceSchema, missionRunSchema, businessObjectSchema, apiTokenSchema } = await import('@/models/Schema');
const { createDataRoom } = await import('@/services/DataRoomService');
const { createObjectType } = await import('@/services/BusinessObjectService');
const scope = await import('./connectionScope');
const { repoAccess, sourceConfigForRepo, tokenForRepo } = await import('@/services/agents/tools/githubPullRead');
const { resolveApiTokenIdForSource } = await import('@/services/SourceCredentialService');
const { publishTargetScopeRefusal } = await import('@/services/publish/sitePublish');
const { squarespaceConnectionFor } = await import('@/services/publish/squarespaceSignIn');
const { runtimeContextFromScope, workScopeFor } = await import('@/services/agents/runtimeContext');
const { withCallContext } = await import('@/services/spend/callContext');
const { patchProject } = await import('@/app/api/v1/projects/[id]/handlers');

const ORG = 'proj_scoped_connections';
const REPO = 'example-org/northwind-site';
let northwind = 0;
let kestrel = 0;

/**
 * A stored credential row for a connection to name (the vault is mocked).
 * @param id - The credential's id.
 */
async function credential(id: string) {
  // A minted-shape row: the vault is mocked, so all a credential needs here is to exist.
  await db.insert(apiTokenSchema).values({ id, orgId: ORG, name: id, platform: 'vocion', secretHash: `hash-${id}` }).onConflictDoNothing();
}

beforeAll(async () => {
  northwind = (await createDataRoom(ORG, 'usr-agency', { title: 'Northwind Home Services' })).id;
  kestrel = (await createDataRoom(ORG, 'usr-agency', { title: 'Kestrel Capital' })).id;
  await credential('tok-northwind');
  await credential('tok-workspace');
  await db.insert(knowledgeSourceSchema).values([
    // Northwind's GitHub: only Northwind's work may use it.
    { orgId: ORG, slug: 'github-api-github-com', configJson: { _connector: 'github', repos: [REPO], deployBranch: 'main' }, apiTokenId: 'tok-northwind', dataRoomId: northwind },
    // The workspace's own GitHub, for its internal repository.
    { orgId: ORG, slug: 'github', configJson: { _connector: 'github', repos: ['example-org/agency-ops'] }, apiTokenId: 'tok-workspace' },
    // Northwind's Squarespace site.
    { orgId: ORG, slug: 'squarespace', configJson: { _connector: 'squarespace', siteUrl: 'https://northwind-home.example/' }, dataRoomId: northwind },
    // A workspace-wide web crawl.
    { orgId: ORG, slug: 'web-docs', kind: 'web', configJson: { _connector: 'web', urls: ['https://docs.example'] } },
  ]);
});

describe('the migration', () => {
  it('adds a nullable project to a connection and to a mission run, and every existing connection reads as the whole workspace', async () => {
    const [web] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.slug, 'web-docs'));

    expect(web!.dataRoomId).toBeNull();

    const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Check', brief: 'Check', team: { lead: 'lead', members: [] } }).returning();

    expect(run!.dataRoomId).toBeNull();
  });

  it('a connection never outlives its project as a workspace-wide one: deleting the project takes it along', async () => {
    const doomed = (await createDataRoom(ORG, 'usr-agency', { title: 'Contoso Supply' })).id;
    const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'contoso-web', configJson: { _connector: 'web' }, dataRoomId: doomed }).returning();
    await db.delete(businessObjectSchema).where(eq(businessObjectSchema.id, doomed));

    expect(await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, row!.id))).toEqual([]);
  });
});

describe('connectionsFor — the one resolver', () => {
  it('gives work for a project the workspace\'s connections and its own', async () => {
    const slugs = (await scope.connectionsFor(ORG, { projectId: northwind })).map(c => c.slug);

    expect(slugs).toEqual(expect.arrayContaining(['github-api-github-com', 'github', 'squarespace', 'web-docs']));
  });

  it('never gives work for one project another project\'s connection', async () => {
    const slugs = (await scope.connectionsFor(ORG, { projectId: kestrel })).map(c => c.slug);

    expect(slugs).toEqual(expect.arrayContaining(['github', 'web-docs']));
    expect(slugs).not.toContain('github-api-github-com');
    expect(slugs).not.toContain('squarespace');
  });

  it('gives work for no project the workspace\'s connections only', async () => {
    const slugs = (await scope.connectionsFor(ORG, { projectId: null })).map(c => c.slug);

    expect(slugs).not.toContain('github-api-github-com');
    expect(slugs).toContain('github');
  });

  it('reads the current work\'s project off the call context when none is named', async () => {
    const inNorthwind = await scope.withWorkProject(northwind, () => scope.connectionsFor(ORG));
    const outside = await scope.connectionsFor(ORG);

    expect(inNorthwind.map(c => c.slug)).toContain('github-api-github-com');
    expect(outside.map(c => c.slug)).not.toContain('github-api-github-com');
  });

  it('names what it withholds, with the project it belongs to', async () => {
    const withheld = await scope.connectionsWithheld(ORG, { projectId: kestrel });

    expect(withheld.map(c => [c.slug, c.projectTitle])).toEqual(expect.arrayContaining([['github-api-github-com', 'Northwind Home Services'], ['squarespace', 'Northwind Home Services']]));
  });

  it('scopes a connection only to a project of this workspace', async () => {
    const [row] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.slug, 'web-docs'));

    expect(await scope.setConnectionScope(ORG, row!.id, 999_999)).toEqual({ ok: false, why: '#999999 is not a project in this workspace.' });
    expect(await scope.setConnectionScope(ORG, row!.id, kestrel)).toEqual({ ok: true, projectTitle: 'Kestrel Capital' });
    expect(await scope.setConnectionScope(ORG, row!.id, null)).toEqual({ ok: true, projectTitle: null });
  });
});

describe('a GitHub token under scope', () => {
  it('serves the repository to its own project\'s work', async () => {
    expect(await tokenForRepo(ORG, REPO, { projectId: northwind })).toBe('pat-tok-northwind');
    expect(await sourceConfigForRepo(ORG, REPO, { projectId: northwind })).toEqual({ deployBranch: 'main', branchPrefix: null });
  });

  it('refuses another project\'s work, saying whose connection it is', async () => {
    expect(await tokenForRepo(ORG, REPO, { projectId: kestrel })).toBeNull();
    expect(await sourceConfigForRepo(ORG, REPO, { projectId: kestrel })).toBeNull();
    expect(await repoAccess(ORG, REPO, { projectId: kestrel })).toEqual({
      token: null,
      refusal: `GitHub for ${REPO} is connected for project Northwind Home Services, not for this work.`,
    });
  });

  it('refuses work for no project the same way, and a turn inside Northwind\'s work gets it from the call context', async () => {
    expect((await repoAccess(ORG, REPO)).refusal).toContain('Northwind Home Services');
    expect(await scope.withWorkProject(northwind, () => tokenForRepo(ORG, REPO))).toBe('pat-tok-northwind');
  });

  it('a workspace repository serves every project\'s work', async () => {
    expect(await tokenForRepo(ORG, 'example-org/agency-ops', { projectId: kestrel })).toBe('pat-tok-workspace');
  });

  it('says nothing about a repository no connection lists', async () => {
    expect(await repoAccess(ORG, 'example-org/unknown', { projectId: kestrel })).toEqual({ token: null, refusal: null });
  });

  it('every GitHub call through the factory\'s one entry point is refused by name', async () => {
    const { ghFor } = await import('@/services/factory/githubChecks');

    await expect(scope.withWorkProject(kestrel, () => ghFor(ORG, REPO))).rejects.toThrow('connected for project Northwind Home Services, not for this work');
    await expect(scope.withWorkProject(northwind, () => ghFor(ORG, REPO))).resolves.toMatchObject({ token: 'pat-tok-northwind' });
  });
});

describe('a credential named by slug', () => {
  it('is refused, by project, to work outside it — never a quiet fall-through to another key', async () => {
    await expect(resolveApiTokenIdForSource(ORG, 'github-api-github-com', { projectId: kestrel })).rejects.toThrow('is connected for project Northwind Home Services, not for this work.');
    await expect(resolveApiTokenIdForSource(ORG, 'github-api-github-com', { projectId: northwind })).resolves.toBe('tok-northwind');
  });

  it('picks among the connections in scope when only the connector is named', async () => {
    await expect(resolveApiTokenIdForSource(ORG, 'github', { projectId: kestrel })).resolves.toBe('tok-workspace');
  });

  it('a settings page that serves no work reads any of them', async () => {
    await expect(resolveApiTokenIdForSource(ORG, 'github-api-github-com', 'any')).resolves.toBe('tok-northwind');
  });
});

describe('publishing across projects', () => {
  const github = { kind: 'github', config: { repo: REPO, path: 'src/content/{slug}.mdx' } };
  const squarespace = { kind: 'squarespace', config: { siteUrl: 'https://northwind-home.example' } };

  it('a project publishes through its own connection', async () => {
    expect(await publishTargetScopeRefusal(ORG, northwind, github)).toBeNull();
    expect(await publishTargetScopeRefusal(ORG, northwind, squarespace)).toBeNull();
    expect(await squarespaceConnectionFor(ORG, 'https://northwind-home.example', { projectId: northwind })).toMatchObject({ slug: 'squarespace' });
  });

  it('another project is refused, with the project named, and never loads the other client\'s kept sign-in', async () => {
    expect(await publishTargetScopeRefusal(ORG, kestrel, github)).toBe(`GitHub for ${REPO} is connected for project Northwind Home Services, not for this work.`);
    expect(await publishTargetScopeRefusal(ORG, kestrel, squarespace)).toBe('Squarespace for northwind-home.example is connected for project Northwind Home Services, not for this work.');
    expect(await squarespaceConnectionFor(ORG, 'https://northwind-home.example', { projectId: kestrel })).toBeNull();
  });

  it('a project\'s page refuses a publish target whose connection belongs to another project, naming it', async () => {
    const req = (body: unknown) => new Request(`http://localhost/api/v1/projects/${kestrel}`, { method: 'PATCH', body: JSON.stringify(body) }) as unknown as NextRequest;
    const person = { orgId: ORG, actorId: 'usr-agency', source: 'session' as const, principal: { kind: 'user', id: 'usr-agency', role: 'admin', scope: { orgId: ORG } } } as never;
    const target = { id: 'site', kind: 'github', label: 'Website', config: { repo: REPO, path: 'src/content/{slug}.mdx' } };

    const refused = await patchProject(person, String(kestrel), req({ publishTargets: [target] }));

    expect(refused.status).toBe(400);
    expect((await refused.json()).error.message).toContain(`GitHub for ${REPO} is connected for project Northwind Home Services, not for this work.`);
    expect((await patchProject(person, String(northwind), req({ publishTargets: [target] }))).status).toBe(200);
  });

  it('a target no connection serves yet is not refused: saying how to connect is the publish\'s own job', async () => {
    expect(await publishTargetScopeRefusal(ORG, kestrel, { kind: 'github', config: { repo: 'example-org/kestrel-site' } })).toBeNull();
  });
});

describe('the work\'s project', () => {
  it('is named outright by a run\'s input, an SEO page\'s or batch\'s projectId', async () => {
    expect(await scope.workProjectFor(ORG, { projectId: northwind })).toBe(northwind);
    expect(await scope.workProjectFor(ORG, { input: { projectId: String(kestrel) } })).toBe(kestrel);
    expect(await scope.jobWorkProject({ orgId: ORG, input: { projectId: northwind } })).toBe(northwind);
    // An id that is not a project here is never trusted.
    expect(await scope.workProjectFor(ORG, { projectId: 999_999 })).toBeNull();
    expect(await scope.jobWorkProject({ orgId: 'another-workspace', projectId: northwind })).toBeNull();
  });

  it('is the project a record is, or the project a record belongs to (metadata.projectId)', async () => {
    const type = (await createObjectType({ slug: 'seo_page', label: 'SEO page' }, ORG))[0]!;
    const [page] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type.id, title: 'Drain cleaning', metadata: { projectId: northwind } }).returning();

    expect(await scope.workProjectFor(ORG, { records: [{ type: 'object', id: String(northwind) }] })).toBe(northwind);
    expect(await scope.workProjectFor(ORG, { records: [{ type: 'object', id: String(page!.id) }] })).toBe(northwind);
    expect(await scope.workProjectFor(ORG, { records: [{ type: 'deal', id: '42' }] })).toBeNull();
  });

  it('a conversation keeps its project: its scope, then the record it was opened about, before the page the person is on', async () => {
    const conversation = (over: Record<string, unknown>) => db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'lead', title: 'About the site', createdBy: 'usr-agency', ...over }).returning();
    const [scoped] = await conversation({ scopeRef: scope.projectScopeRef(northwind) });
    const [openedOnNorthwind] = await conversation({ contextJson: { path: `/dashboard/projects/${northwind}`, title: 'Northwind Home Services', record: { type: 'object', id: String(northwind) } } });
    const [unscoped] = await conversation({});
    const kestrelPage = { record: { type: 'object', id: String(kestrel) } };

    expect(await scope.turnWorkProject(ORG, { conversationId: scoped!.id, pageContext: kestrelPage })).toBe(northwind);
    expect(await scope.turnWorkProject(ORG, { conversationId: openedOnNorthwind!.id, pageContext: kestrelPage })).toBe(northwind);
    expect(await scope.turnWorkProject(ORG, { conversationId: unscoped!.id, pageContext: kestrelPage })).toBe(kestrel);
    expect(await scope.turnWorkProject(ORG, { conversationId: unscoped!.id })).toBeNull();
  });

  it('a mission run started for a project keeps it through every turn', async () => {
    const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Refresh pages', brief: 'Refresh the pages', team: { lead: 'lead', members: [] }, dataRoomId: kestrel }).returning();

    expect(await scope.turnWorkProject(ORG, { missionRunId: run!.id })).toBe(kestrel);
  });
});

describe('an agent turn\'s sources', () => {
  const row = { slug: 'lead', connectorSources: ['github-api-github-com', 'github', 'squarespace', 'web-docs'], objectTypeSlugs: [], searchConfig: {}, harnessConfig: {} };
  const agentScope = { enabledPlugins: [], defaultTimeZone: 'UTC', sourceKinds: { 'github-api-github-com': 'github', 'github': 'github', 'squarespace': 'squarespace', 'web-docs': 'web' } };

  it('leaves out another project\'s connections, for the tools and for retrieval', async () => {
    const work = await workScopeFor(ORG, kestrel);
    const ctx = runtimeContextFromScope(ORG, row as never, agentScope as never, work);

    expect(ctx.workProjectId).toBe(kestrel);
    expect(ctx.connectorSources).toEqual(['github', 'web-docs']);
    expect(Object.keys(ctx.sourceKinds ?? {})).toEqual(['github', 'web-docs']);
    expect(ctx.withheldSourceSlugs).toEqual(expect.arrayContaining(['github-api-github-com', 'squarespace']));
  });

  it('keeps them for the project\'s own work, read from the call context the turn opened', async () => {
    const work = await withCallContext({ workProjectId: northwind }, () => workScopeFor(ORG));
    const ctx = runtimeContextFromScope(ORG, row as never, agentScope as never, work);

    expect(ctx.connectorSources).toEqual(row.connectorSources);
    expect(ctx.withheldSourceSlugs).toBeUndefined();
  });
});
