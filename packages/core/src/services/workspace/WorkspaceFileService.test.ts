/**
 * Workspaces in the database, step 1: an apply stores the files the runtime
 * reads, and every reader asks the database first.
 *
 * The acceptance case is the one Vocion Cloud lives in: a project is applied
 * once, then the folder is gone and WORKSPACE_PATH is unset — and its agents
 * still mount every skill and playbook body, its pages still render with their
 * prose, get_brand still hands over the brand with its logo, and the agent
 * page still shows its source files. Then the two ways the folder must NOT be
 * read: a stored project never borrows from a mounted folder that is another
 * project's, and a project with nothing stored reads the folder as before.
 *
 * Real PGlite behind the DB mock, the real loader and applier, no model.
 */
import type { RuntimeContext } from '@/services/agents/types';
import { Buffer } from 'node:buffer';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { playbookSchema, workspaceFileSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('@/libs/workspace/applier');
const { loadWorkspace } = await import('@/libs/workspace/loader');
const { mountSkills } = await import('@/services/playbooks/mount');
const { readPageForOrg, readPageProse, readPagesForOrg } = await import('@/services/PluginService');
const { listStoredFiles, readBrandForOrg, readPrimitiveFilesForOrg, readStoredFiles, replaceStoredFiles } = await import('./WorkspaceFileService');
const { getBrandTool } = await import('@/services/agents/tools/getBrand');

const ORG = 'proj_kestrel_ws';
const OTHER = 'proj_contoso_ws';
const ROOT = mkdtempSync(join(tmpdir(), 'vocion-ws-files-'));
const MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';

const SKILL = '---\nslug: write-brief\nname: Write a brief\ndescription: One page on one account.\nplaybooks: [house-style]\n---\n\nPull the account from {{env.KESTREL_API_URL}}/accounts and write one page.\n';
const FILES: Record<string, string> = {
  'workspace.yaml': `version: 1\norgId: ${ORG}\nname: Kestrel Capital\n`,
  'skills/write-brief/SKILL.md': SKILL,
  'skills/write-brief/examples.md': 'One good brief, start to finish.',
  'playbooks/house-style/SKILL.md': '---\nslug: house-style\nname: House style\ndescription: How Kestrel writes.\n---\n\nShort sentences. Numbers first.\n',
  'agents/scout.yaml': 'slug: scout\nname: Scout\nsystemPromptFile: scout.system-prompt.md\nskills: [write-brief]\n',
  'agents/scout.system-prompt.md': 'You scout accounts for Kestrel Capital.',
  'pages/pipeline.yaml': 'slug: pipeline\ntitle: Pipeline\narchetype: markdown\n',
  'pages/pipeline.md': '# Pipeline\n\nRead from {{env.KESTREL_API_URL}}.',
  'pages/tour.yaml': 'steps:\n  - route: /dashboard\n    title: Hi\n    body: Hello\n',
  'brand.yaml': 'name: Kestrel Capital\npalette:\n  ink: "#101820"\nroles:\n  ink: ink\nlogos:\n  mark: brand/mark.svg\nvoice:\n  - Numbers before adjectives.\n',
  'brand/mark.svg': MARK_SVG,
};

const ORIGINAL = {
  WORKSPACE_PATH: process.env.WORKSPACE_PATH,
  WORKSPACE_TEMPLATE_VARS: process.env.WORKSPACE_TEMPLATE_VARS,
  KESTREL_API_URL: process.env.KESTREL_API_URL,
};

function restore(name: keyof typeof ORIGINAL): void {
  if (ORIGINAL[name] === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = ORIGINAL[name];
  }
}

let counter = 0;

/**
 * A fresh copy of the fixture workspace, optionally with changes.
 * @param changes - Path → content; null deletes the file.
 */
function workspace(changes: Record<string, string | null> = {}): string {
  const dir = join(ROOT, `ws-${counter++}`);
  for (const [rel, body] of Object.entries({ ...FILES, ...changes })) {
    if (body === null) {
      continue;
    }
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

async function apply(dir: string, opts: { dryRun?: boolean; orgId?: string } = {}) {
  return applyWorkspace(loadWorkspace(dir), { orgId: opts.orgId ?? ORG, appliedBy: 'vitest', dryRun: opts.dryRun });
}

async function storedPaths(orgId: string): Promise<string[]> {
  const rows = await db.select({ path: workspaceFileSchema.path }).from(workspaceFileSchema).where(eq(workspaceFileSchema.orgId, orgId));
  return rows.map(r => r.path).sort();
}

beforeEach(async () => {
  await db.delete(workspaceFileSchema);
  await db.delete(playbookSchema);
  await db.delete(workspaceVersionSchema);
  process.env.WORKSPACE_TEMPLATE_VARS = 'KESTREL_API_URL';
  process.env.KESTREL_API_URL = 'https://api.kestrel.example';
});

afterEach(() => {
  restore('WORKSPACE_PATH');
  restore('WORKSPACE_TEMPLATE_VARS');
  restore('KESTREL_API_URL');
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('an apply stores the workspace\'s files', () => {
  it('stores what the runtime reads, as authored, stamped with the apply\'s sha', async () => {
    const dir = workspace();

    const result = await apply(dir);

    expect(result.errors).toEqual([]);
    expect(await storedPaths(ORG)).toEqual([
      'agents/scout.system-prompt.md',
      'agents/scout.yaml',
      'brand.yaml',
      'brand/mark.svg',
      'pages/pipeline.md',
      'pages/pipeline.yaml',
      'pages/tour.yaml',
      'playbooks/house-style/SKILL.md',
      'skills/write-brief/SKILL.md',
      'skills/write-brief/examples.md',
      'workspace.yaml',
    ]);

    const [body] = await db.select().from(workspaceFileSchema).where(eq(workspaceFileSchema.path, 'skills/write-brief/SKILL.md'));

    // The token is stored as a token: a per-host value never lands in the table.
    expect(body?.content).toBe(SKILL);
    expect(body?.workspaceSha).toBe(result.sha);
  });

  it('a re-apply rewrites what changed, removes what the workspace deleted, and leaves the rest alone', async () => {
    await apply(workspace());
    const [before] = await db.select().from(workspaceFileSchema).where(eq(workspaceFileSchema.path, 'playbooks/house-style/SKILL.md'));

    const second = await apply(workspace({ 'skills/write-brief/examples.md': 'A better brief.', 'pages/pipeline.md': null }));

    expect(second.errors).toEqual([]);
    expect(await storedPaths(ORG)).not.toContain('pages/pipeline.md');

    const examples = await readStoredFiles(ORG, ['skills/write-brief/examples.md']);

    expect(examples.files.get('skills/write-brief/examples.md')?.content).toBe('A better brief.');

    const [after] = await db.select().from(workspaceFileSchema).where(eq(workspaceFileSchema.path, 'playbooks/house-style/SKILL.md'));

    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it('a dry run stores nothing', async () => {
    await apply(workspace(), { dryRun: true });

    expect(await storedPaths(ORG)).toEqual([]);
  });
});

describe('with WORKSPACE_PATH unset, a project applied once still has every body', () => {
  beforeEach(async () => {
    const dir = workspace();
    await apply(dir);
    // The folder is gone and nothing names one: only the database is left.
    rmSync(dir, { recursive: true, force: true });
    delete process.env.WORKSPACE_PATH;
  });

  it('its agents mount every skill and playbook body, tokens resolved', async () => {
    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-brief'], playbookSlugs: [] });

    expect(Object.keys(files).sort()).toEqual([
      '/playbooks/house-style/SKILL.md',
      '/skills/write-brief/SKILL.md',
      '/skills/write-brief/examples.md',
    ]);
    expect(files['/skills/write-brief/SKILL.md']).toContain('https://api.kestrel.example/accounts');
    expect(files['/skills/write-brief/SKILL.md']).not.toContain('{{env.');
    expect(files['/skills/write-brief/examples.md']).toBe('One good brief, start to finish.');
  });

  it('its pages list and render with their prose; the tour is not a page', async () => {
    const { pages, issues } = await readPagesForOrg(ORG);

    expect(issues).toEqual([]);
    expect(pages.map(p => p.slug)).toEqual(['pipeline']);
    expect(pages[0]).toMatchObject({ origin: 'workspace', storedIn: ORG });

    const page = await readPageForOrg('pipeline', ORG);

    await expect(readPageProse(page!, 'content')).resolves.toBe('# Pipeline\n\nRead from https://api.kestrel.example.');
    await expect(readPageProse(page!, 'methodology')).resolves.toBeNull();
  });

  it('get_brand hands over the brand with its logo inlined', async () => {
    const { brand, issues } = await readBrandForOrg(ORG);

    expect(issues).toEqual([]);
    expect(brand?.brand.name).toBe('Kestrel Capital');
    expect(brand?.logos.mark).toBe(`data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString('base64')}`);

    const text = await getBrandTool({ orgId: ORG } as RuntimeContext).invoke({});

    expect(text).toContain('Brand: Kestrel Capital');
    expect(text).toContain('--ink:var(--brand-ink);');
  });

  it('the agent page shows its source files, read-only since no folder here is the project\'s', async () => {
    const result = await readPrimitiveFilesForOrg(ORG, 'agent', 'scout');

    expect(result?.files.map(f => ({ path: f.path, layer: f.layer, editable: f.fullPath !== undefined }))).toEqual([
      { path: 'agents/scout.yaml', layer: 'workspace', editable: false },
      { path: 'agents/scout.system-prompt.md', layer: 'workspace', editable: false },
    ]);
    expect(result?.files[1]?.content).toBe('You scout accounts for Kestrel Capital.');
    expect(result?.editInGitPath).toBe('agents/scout.yaml');
    await expect(readPrimitiveFilesForOrg(ORG, 'agent', '../../etc/passwd')).resolves.toBeNull();
  });
});

describe('a stored project never reads another project\'s folder', () => {
  it('a mounted folder that is someone else\'s lends this project no body, no page and no brand', async () => {
    // This project's workspace has no brand, no pages and no house style.
    await apply(workspace({ 'brand.yaml': null, 'brand/mark.svg': null, 'pages/pipeline.yaml': null, 'pages/pipeline.md': null, 'pages/tour.yaml': null }));
    // The host mounts another project's folder, which has all three — and a
    // write-brief of its own.
    const theirs = join(ROOT, 'contoso');
    cpSync(workspace(), theirs, { recursive: true });
    writeFileSync(join(theirs, 'skills/write-brief/SKILL.md'), '---\nslug: write-brief\nname: x\ndescription: x\n---\n\nCONTOSO BODY\n');
    process.env.WORKSPACE_PATH = theirs;

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-brief'], playbookSlugs: [] });

    expect(files['/skills/write-brief/SKILL.md']).toContain('https://api.kestrel.example/accounts');
    expect(JSON.stringify(files)).not.toContain('CONTOSO BODY');
    expect((await readPagesForOrg(ORG)).pages).toEqual([]);
    expect(await readBrandForOrg(ORG)).toEqual({ brand: null, issues: [] });
  });

  it('a project with nothing stored reads the folder exactly as before', async () => {
    const dir = workspace();
    process.env.WORKSPACE_PATH = dir;
    // The rows of an apply from before the store existed: a catalog row, no files.
    await db.insert(playbookSchema).values({ orgId: OTHER, slug: 'house-style', name: 'House style', description: 'd', kind: 'playbook', origin: 'workspace', contentSha: 'x' });

    const files = await mountSkills({ orgId: OTHER, skillSlugs: [], playbookSlugs: ['house-style'] });

    expect(files['/playbooks/house-style/SKILL.md']).toContain('Short sentences. Numbers first.');
    expect((await readBrandForOrg(OTHER)).brand?.brand.name).toBe('Kestrel Capital');
    expect((await readPrimitiveFilesForOrg(OTHER, 'agent', 'scout'))?.files[0]?.fullPath).toBe(`${dir}/agents/scout.yaml`);
  });
});

describe('the store itself', () => {
  it('replacing one project\'s files never touches another\'s', async () => {
    const file = (path: string) => ({ path, content: path, encoding: 'utf8' as const, sha: path });
    await replaceStoredFiles(OTHER, [file('workspace.yaml'), file('pages/a.yaml')], 'sha-other');
    await replaceStoredFiles(ORG, [file('workspace.yaml')], 'sha-mine');
    await replaceStoredFiles(ORG, [], 'sha-mine-again');

    expect(await storedPaths(ORG)).toEqual([]);
    expect(await storedPaths(OTHER)).toEqual(['pages/a.yaml', 'workspace.yaml']);
  });

  it('a listing narrows to a folder and an extension, and says whether the project is stored', async () => {
    const file = (path: string) => ({ path, content: path, encoding: 'utf8' as const, sha: path });
    await replaceStoredFiles(ORG, [file('pages/a.yaml'), file('pages/a.md'), file('pages_old/b.yaml')], 'sha');

    const unstored = await listStoredFiles(ORG, 'pages/', ['.yaml']);

    expect(unstored.stored).toBe(false);
    expect([...unstored.files.keys()]).toEqual(['pages/a.yaml']);

    await replaceStoredFiles(ORG, [file('workspace.yaml'), file('pages/a.yaml'), file('pages/a.md')], 'sha');

    expect((await listStoredFiles(ORG, 'pages/', ['.yaml'])).stored).toBe(true);
  });
});

describe('a file the apply could not store', () => {
  it('is named in the warnings, and the rest still stores', async () => {
    const dir = workspace();
    const secret = join(ROOT, 'secret.env');
    writeFileSync(secret, 'DB_PASSWORD=leaked\n');
    symlinkSync(secret, join(dir, 'skills/write-brief/linked.md'));

    const result = await apply(dir);

    expect(result.warnings).toContainEqual({ resource: 'workspaceFile', slug: 'skills/write-brief/linked.md', message: expect.stringContaining('outside the workspace folder') });
    expect(await storedPaths(ORG)).toContain('skills/write-brief/SKILL.md');

    unlinkSync(join(dir, 'skills/write-brief/linked.md'));
  });
});
