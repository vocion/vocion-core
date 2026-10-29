/**
 * The SEO app's playbooks in a workspace with no folder (Vocion Cloud), on
 * PGlite: applied once on install as the workspace's own copies, mounted for
 * the strategist, the writer and the editor (consulted or not), edited in
 * place, and kept as a person left them when core ships new templates.
 * Every workspace, person and agency here is fictional.
 */
import type { AppBundleRecord } from '@/libs/workspace/bundleTrack';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, playbookSchema, projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { upgradeInstalledApps } = await import('@/services/plugins/upgradeBundles');
const { loadPlugin } = await import('@/libs/workspace/plugins');
const { mountSkills } = await import('@/services/playbooks/mount');
const { playbookTextHash } = await import('@/services/playbooks/owned');
const { buildInitialFiles } = await import('@/services/agents/harness');
const { currentSourceText, getSourceArtifact, mirrorSource, writeWorkspaceSource } = await import('@/services/workspace/WorkspaceSourceService');

const ORG = 'proj_playbooks_kestrel';
const SEO_PLAYBOOKS = ['how-we-brief-a-page', 'location-pages-without-doorways', 'sourcing-and-claims', 'on-page-checklist', 'internal-linking'];
const shipped = (slug: string) => readFileSync(join(loadPlugin('seo').sourcePath, 'playbooks', slug, 'SKILL.md'), 'utf8');
const agentRow = async (slug: string) => (await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, slug))))[0]!;
const appVersions = async () => db.select().from(workspaceVersionSchema).where(and(eq(workspaceVersionSchema.orgId, ORG), like(workspaceVersionSchema.sourcePath, 'app:%'))).orderBy(desc(workspaceVersionSchema.appliedAt), desc(workspaceVersionSchema.id));
const copyText = async (slug: string) => (await currentSourceText(ORG, 'playbook', slug))?.content;
const mountedFor = async (slug: string) => {
  const row = await agentRow(slug);
  return mountSkills({ orgId: ORG, skillSlugs: row.skillSlugs ?? [], playbookSlugs: row.playbookSlugs ?? [] });
};

const MORE_LINKS_IN = '- **In:** at least three existing, relevant pages link to the new one once it is';
const linksEdited = () => shipped('internal-linking').replace('- **In:** at least two existing, relevant pages link to the new one once it is', MORE_LINKS_IN);

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-playbooks', name: 'Kestrel Capital', slug: 'kestrel-playbooks' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-playbooks', slug: 'kestrel-seo', name: 'Kestrel Search', timeZone: 'America/Denver', enabledPlugins: ['data-rooms', 'wiki', 'seo'] });
  const res = await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' });

  expect(res.errors).toEqual([]);
});

describe('installing the SEO app applies its playbooks into the workspace', () => {
  it('writes a catalog row and the workspace\'s own copy of each, as shipped, and records what it left', async () => {
    const rows = await db.select().from(playbookSchema).where(and(eq(playbookSchema.orgId, ORG), eq(playbookSchema.kind, 'playbook')));

    expect(rows.map(r => r.slug)).toEqual(expect.arrayContaining(SEO_PLAYBOOKS));

    const [install] = await appVersions();
    for (const slug of SEO_PLAYBOOKS) {
      const copy = await getSourceArtifact(ORG, 'playbook', slug);

      expect(copy?.spec).toMatchObject({ slug, kind: 'playbook', md: shipped(slug) });
      expect(copy?.lastAuthorKind).toBe('system');
      expect(install?.bundle?.playbooks?.[slug]).toBe(playbookTextHash(shipped(slug)));
    }
  });

  it('the strategist, the writer and the editor name the playbooks they work by', async () => {
    expect((await agentRow('seo-strategist')).playbookSlugs).toEqual(expect.arrayContaining(SEO_PLAYBOOKS));
    expect((await agentRow('seo-writer')).playbookSlugs).toEqual(expect.arrayContaining(['sourcing-and-claims', 'on-page-checklist', 'internal-linking', 'location-pages-without-doorways']));
    expect((await agentRow('seo-editor')).playbookSlugs).toEqual(expect.arrayContaining(['on-page-checklist', 'sourcing-and-claims']));
  });
});

describe('the agents read them', () => {
  it('mounts each seat\'s playbooks at /playbooks/<slug>/', async () => {
    const editor = await mountedFor('seo-editor');

    expect(editor['/playbooks/on-page-checklist/SKILL.md']).toContain('# On-page checklist');
    expect(editor['/playbooks/sourcing-and-claims/SKILL.md']).toContain('# Sourcing and claims');
    expect(editor['/skills/review-page/SKILL.md']).toContain('/playbooks/on-page-checklist/SKILL.md');

    const strategist = await mountedFor('seo-strategist');

    expect(strategist['/playbooks/how-we-brief-a-page/SKILL.md']).toContain('# How we brief a page');
  });

  it('a teammate the strategist consults reads its own playbooks, at the same path', async () => {
    // The lead names none, so whatever is mounted came with its teammates.
    const before = (await agentRow('seo-strategist')).playbookSlugs;
    await db.update(agentSchema).set({ playbookSlugs: [] }).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'seo-strategist')));
    try {
      const files = await buildInitialFiles(ORG, 'seo-strategist');

      expect(files['/teammates/seo-editor/skills/review-page/SKILL.md']?.content).toBeTruthy();
      expect(files['/playbooks/on-page-checklist/SKILL.md']?.content).toContain('# On-page checklist');
      expect(files['/playbooks/how-we-brief-a-page/SKILL.md']).toBeUndefined();
    } finally {
      await db.update(agentSchema).set({ playbookSlugs: before }).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'seo-strategist')));
    }
  });
});

describe('the workspace edits its copy', () => {
  it('a person\'s save is a new version of the copy, with no folder and no apply, and every agent reads it', async () => {
    const res = await writeWorkspaceSource({ orgId: ORG, kind: 'playbook', slug: 'internal-linking', content: linksEdited(), author: { kind: 'human', id: 'usr-mara' }, changeSummary: 'Three links in, not two', existingOnly: true });

    expect(res).toMatchObject({ unchanged: false, applied: null, previousVersion: 1 });
    expect(res.version.version).toBe(2);
    expect(await copyText('internal-linking')).toBe(linksEdited());
    expect((await mountedFor('seo-writer'))['/playbooks/internal-linking/SKILL.md']).toContain(MORE_LINKS_IN);
  });

  it('refuses a copy that does not validate, and leaves the copy alone', async () => {
    await expect(writeWorkspaceSource({ orgId: ORG, kind: 'playbook', slug: 'internal-linking', content: '# No frontmatter', author: { kind: 'human', id: 'usr-mara' }, changeSummary: 'Oops' })).rejects.toThrow(/frontmatter/);
    expect(await copyText('internal-linking')).toBe(linksEdited());
  });
});

describe('an upgrade keeps an edited playbook', () => {
  it('moves an untouched copy to the new template, keeps the one a person changed, and says so on the version row', async () => {
    // An older release: other templates, and an older checklist the bundle left untouched.
    const older = shipped('on-page-checklist').replace('# On-page checklist', '# On-page checklist (older)');
    await mirrorSource({ orgId: ORG, kind: 'playbook', slug: 'on-page-checklist', title: 'On-page checklist', content: older, author: { kind: 'system', id: null }, changeSummary: 'Updated with the app' });
    const [install] = await appVersions();
    const bundle = structuredClone(install!.bundle!) as AppBundleRecord;
    bundle.hashes.seo = 'older-templates';
    bundle.playbooks = { ...bundle.playbooks, 'on-page-checklist': playbookTextHash(older) };
    await db.update(workspaceVersionSchema).set({ bundle }).where(eq(workspaceVersionSchema.id, install!.id));

    const out = await upgradeInstalledApps({ orgIds: [ORG] });

    expect(out).toMatchObject({ checked: 1, failed: [] });

    const upgrade = 'upgraded' in out ? out.upgraded[0] : undefined;

    expect(upgrade?.kept).toEqual(expect.arrayContaining([{ resource: 'playbook', slug: 'internal-linking', field: 'text' }]));
    expect(upgrade?.kept).not.toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'on-page-checklist' })]));
    expect(await copyText('internal-linking')).toBe(linksEdited());
    expect(await copyText('on-page-checklist')).toBe(shipped('on-page-checklist'));

    // It stays the person's on every later upgrade, until they put it back.
    const [row] = await appVersions();

    expect(row?.bundle?.playbooks?.['internal-linking']).toBe(playbookTextHash(shipped('internal-linking')));

    await db.update(workspaceVersionSchema).set({ bundle: { ...row!.bundle!, hashes: { ...row!.bundle!.hashes, seo: 'older-again' } } }).where(eq(workspaceVersionSchema.id, row!.id));
    await upgradeInstalledApps({ orgIds: [ORG] });

    expect(await copyText('internal-linking')).toBe(linksEdited());
    expect((await mountedFor('seo-writer'))['/playbooks/internal-linking/SKILL.md']).toContain(MORE_LINKS_IN);
  });
});
