/**
 * Wiki pages seeded from `wiki/<slug>.md` on apply.
 *
 * The file is the seed, not the source of truth: a page nobody has touched in
 * the app follows the file; a page a person or an agent edited is kept, and
 * the apply says so. Every write is an ordinary artifact version, so undo and
 * restore work. Real PGlite behind the DB mock; no LLM, no Temporal.
 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, artifactVersionSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { getWikiPage, listWikiPageRows, writeWikiPage } = await import('@/services/wiki/WikiService');
const { listArtifactVersions, updateArtifact } = await import('@/services/ArtifactService');
const { eq } = await import('drizzle-orm');

const ORG = 'proj_wiki_seed';
const VOICE = '---\ntitle: Voice\nsummary: How we sound.\norder: 10\n---\nPlain and short.\n';
const WHO = '---\ntitle: Who is who\norder: 20\n---\nChris owns the workspace.\n';

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-wiki-seed-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: wiki seed\n`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

async function apply(dir: string, dryRun = false) {
  return applyWorkspace(loadWorkspace(dir), { orgId: ORG, appliedBy: 'vitest', dryRun });
}

async function seedOf(slug: string) {
  const row = (await listWikiPageRows(ORG)).find(r => r.recordId === slug);
  return (row?.spec as { seed?: Record<string, unknown> } | undefined)?.seed;
}

beforeEach(async () => {
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
  await db.delete(workspaceVersionSchema);
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('seeding wiki pages from the repo', () => {
  it('creates a page per file plus the generated index, through the artifact save, and counts them', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE, 'wiki/who-is-who.md': WHO });

    const result = await apply(dir);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.counts.wikiPages).toEqual({ created: 3, updated: 0, unchanged: 0 });

    const voice = await getWikiPage(ORG, 'voice');

    expect(voice).toMatchObject({ title: 'Voice', md: 'Plain and short.', summary: 'How we sound.', version: 1, lastAuthorKind: 'system' });
    expect(await seedOf('voice')).toMatchObject({ path: 'wiki/voice.md', version: 1, managed: true, order: 10 });
    expect((await seedOf('voice'))!.sha).toMatch(/^[0-9a-f]{64}$/);

    const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.recordId, 'voice'));

    expect(row).toMatchObject({ kind: 'markdown', folder: 'wiki', recordType: 'wiki', recordRole: 'page', lastAuthorId: 'workspace-seed' });

    const versions = await listArtifactVersions({ orgId: ORG, artifactId: row!.id });

    expect(versions).toHaveLength(1);
    expect(versions[0]!.changeSummary).toMatch(/^Seeded from wiki\/voice\.md \([0-9a-f]{12}, workspace /);

    const index = await getWikiPage(ORG, 'index');

    expect(index!.md.split('\n').filter(l => l.startsWith('- '))).toEqual([
      '- **Voice** (`voice`) — How we sound.',
      '- **Who is who** (`who-is-who`) — Chris owns the workspace.',
    ]);
    expect(await seedOf('index')).toMatchObject({ path: '(generated from wiki/*.md)' });
  });

  it('a second apply of the same files changes nothing; a changed file writes a new version and refreshes the index', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE, 'wiki/who-is-who.md': WHO });
    await apply(dir);

    const again = await apply(dir);

    expect(again.counts.wikiPages).toEqual({ created: 0, updated: 0, unchanged: 3 });
    expect((await getWikiPage(ORG, 'voice'))!.version).toBe(1);

    writeFileSync(join(dir, 'wiki', 'voice.md'), VOICE.replace('How we sound.', 'How we write.').replace('Plain and short.', 'Plain, short, warm.'));
    const changed = await apply(dir);

    expect(changed.counts.wikiPages).toEqual({ created: 0, updated: 2, unchanged: 1 });

    const voice = await getWikiPage(ORG, 'voice');

    expect(voice).toMatchObject({ md: 'Plain, short, warm.', summary: 'How we write.', version: 2 });
    expect(await seedOf('voice')).toMatchObject({ version: 2 });
    expect((await getWikiPage(ORG, 'index'))!.md).toContain('How we write.');
  });

  it('keeps a page a person edited in the app, and names it with how to reconcile', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE });
    await apply(dir);
    const page = (await getWikiPage(ORG, 'voice'))!;
    await updateArtifact({ orgId: ORG, id: page.id, contentMarkdown: 'Plain and short — and never an exclamation mark.', author: { kind: 'human', id: 'usr-chris' } });

    writeFileSync(join(dir, 'wiki', 'voice.md'), VOICE.replace('Plain and short.', 'The file moved on.'));
    const result = await apply(dir);

    expect(result.counts.wikiPages).toEqual({ created: 0, updated: 0, unchanged: 1, kept: 1 });
    expect(result.warnings).toEqual([
      { resource: 'wikiPage', slug: 'voice', message: 'edited in the app since the last seed (v2 by a person); wiki/voice.md was not applied. Edit the file to match the page, or set managed: false to stop seeding it.' },
    ]);
    expect((await getWikiPage(ORG, 'voice'))!.md).toBe('Plain and short — and never an exclamation mark.');
  });

  it('keeps a page an agent revised through write_wiki_page too', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE });
    await apply(dir);
    await writeWikiPage(ORG, { slug: 'voice', title: 'Voice', md: 'Consolidated by the curator.', author: { kind: 'agent', id: 'agent:wiki-curator' }, reason: 'Friday consolidation' });

    writeFileSync(join(dir, 'wiki', 'voice.md'), VOICE.replace('Plain and short.', 'Changed in the repo.'));
    const result = await apply(dir);

    expect(result.counts.wikiPages.kept).toBe(1);
    expect(result.warnings[0]!.message).toContain('v2 by an agent');
    expect((await getWikiPage(ORG, 'voice'))!.md).toBe('Consolidated by the curator.');
  });

  it('managed: false seeds once and never again, even when the file changes', async () => {
    const dir = fixture({ 'wiki/glossary.md': '---\ntitle: Glossary\nmanaged: false\n---\nOpening — one selling slot.\n' });

    expect((await apply(dir)).counts.wikiPages).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect(await seedOf('glossary')).toMatchObject({ managed: false });

    writeFileSync(join(dir, 'wiki', 'glossary.md'), '---\ntitle: Glossary\nmanaged: false\n---\nRewritten in the repo.\n');
    const result = await apply(dir);

    expect(result.counts.wikiPages).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(result.warnings).toEqual([]);
    expect((await getWikiPage(ORG, 'glossary'))!.md).toBe('Opening — one selling slot.');
  });

  it('a deleted file keeps the page and warns once, as a system version that says why', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE, 'wiki/who-is-who.md': WHO });
    await apply(dir);
    unlinkSync(join(dir, 'wiki', 'who-is-who.md'));

    const first = await apply(dir);

    expect(first.warnings).toEqual([
      { resource: 'wikiPage', slug: 'who-is-who', message: 'wiki/who-is-who.md is gone from the workspace; the page is kept (v1). Delete it from the Wiki page if it should go, or restore the file to seed it again.' },
    ]);
    // The index no longer lists it; the page itself is still there.
    expect(first.counts.wikiPages).toEqual({ created: 0, updated: 1, unchanged: 1 });

    const who = (await getWikiPage(ORG, 'who-is-who'))!;

    expect(who.md).toBe('Chris owns the workspace.');
    expect(who.version).toBe(2);
    expect(await seedOf('who-is-who')).toMatchObject({ version: 2, orphanedAt: expect.any(String) });

    const versions = await listArtifactVersions({ orgId: ORG, artifactId: who.id });

    expect(versions[0]!.changeSummary).toBe('wiki/who-is-who.md was removed from the workspace; page kept');

    const second = await apply(dir);

    expect(second.warnings).toEqual([]);
    expect(second.counts.wikiPages).toEqual({ created: 0, updated: 0, unchanged: 2 });
  });

  it('a seeded wiki/index.md replaces the generated index', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE, 'wiki/index.md': '---\ntitle: Start here\n---\nRead Voice first.\n' });

    const result = await apply(dir);

    expect(result.counts.wikiPages).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect(await getWikiPage(ORG, 'index')).toMatchObject({ title: 'Start here', md: 'Read Voice first.' });
    expect(await seedOf('index')).toMatchObject({ path: 'wiki/index.md' });
  });

  it('a dry run with a database classifies and warns but writes nothing', async () => {
    const dir = fixture({ 'wiki/voice.md': VOICE, 'wiki/who-is-who.md': WHO });

    const before = await apply(dir, true);

    expect(before.dryRun).toBe(true);
    expect(before.database.reachable).toBe(true);
    expect(before.counts.wikiPages).toEqual({ created: 3, updated: 0, unchanged: 0 });
    expect(await listWikiPageRows(ORG)).toEqual([]);

    await apply(dir);
    const page = (await getWikiPage(ORG, 'voice'))!;
    await updateArtifact({ orgId: ORG, id: page.id, contentMarkdown: 'Edited here.', author: { kind: 'human', id: 'usr-chris' } });
    writeFileSync(join(dir, 'wiki', 'voice.md'), VOICE.replace('Plain and short.', 'Changed there.'));
    writeFileSync(join(dir, 'wiki', 'who-is-who.md'), WHO.replace('Chris owns', 'Chris still owns'));

    const after = await apply(dir, true);

    expect(after.counts.wikiPages).toEqual({ created: 0, updated: 2, unchanged: 0, kept: 1 });
    expect(after.warnings.map(w => w.slug)).toEqual(['voice']);
    expect((await getWikiPage(ORG, 'who-is-who'))!.version).toBe(1);
    expect(after.versionId).toBeNull();
  });

  it('a workspace with no wiki/ directory reports zeros and touches nothing', async () => {
    const result = await apply(fixture({}));

    expect(result.counts.wikiPages).toEqual({ created: 0, updated: 0, unchanged: 0 });
    expect(await listWikiPageRows(ORG)).toEqual([]);
  });
});
