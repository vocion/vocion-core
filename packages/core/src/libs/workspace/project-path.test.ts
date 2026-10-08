import type { RuntimeContext } from '@/services/agents/types';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which folder a project may read and write as ITS workspace, on a host that
 * serves two companies — and every service that asks.
 *
 * The folder on `WORKSPACE_PATH` is Northwind's (its workspace.yaml names
 * Northwind's project). Kestrel Capital, the other tenant on the host, has no
 * folder of its own here. Before this, `workspacePathForProject` answered the
 * mount for every project, so each of these read or wrote Northwind's files
 * on Kestrel's behalf:
 *
 *   - `get_brand` — Kestrel's agent wrote documents in Northwind's colours,
 *     logo and voice;
 *   - the self-update writes (`playbook.write`, `agent.revise_prompt`) and the
 *     workspace-source edits — wrote into Northwind's folder and applied it
 *     onto Kestrel;
 *   - the operating intent — read and rewrote Northwind's standing
 *     instructions as Kestrel's.
 *
 * Each is checked from both sides: Kestrel is refused and Northwind's files
 * are untouched, and Northwind still gets its own.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { invalidateCurrentContextShaCache } = await import('./current-version');
const { NO_OWN_WORKSPACE_FOLDER } = await import('./mounted-project');
const { ownWorkspaceFolder, workspaceFolderForProject, workspacePathForProject } = await import('./project-path');

const NORTHWIND = 'proj_folder_northwind';
const KESTREL = 'proj_folder_kestrel';
const NORTHWIND_SALES = 'proj_folder_northwind_sales';
const KESTREL_SALES = 'proj_folder_kestrel_sales';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-project-folder-'));
const NORTHWIND_DIR = join(ROOT, 'northwind');
const KESTREL_DIR = join(ROOT, 'kestrel-capital');

function seed() {
  mkdirSync(join(NORTHWIND_DIR, 'playbooks', 'renewal-call'), { recursive: true });
  writeFileSync(join(NORTHWIND_DIR, 'workspace.yaml'), `version: 1\norgId: ${NORTHWIND}\nname: Northwind\n`);
  writeFileSync(join(NORTHWIND_DIR, 'brand.yaml'), 'name: Northwind Traders\npalette:\n  ink: "#0B3D2E"\nvoice:\n  - northwind-only voice rule\n');
  writeFileSync(join(NORTHWIND_DIR, 'operating-intent.yaml'), 'outcomes:\n  - statement: northwind-only outcome\n');
  writeFileSync(join(NORTHWIND_DIR, 'playbooks', 'renewal-call', 'SKILL.md'), '# Renewal call\n\nnorthwind-only playbook\n');
  mkdirSync(KESTREL_DIR, { recursive: true });
  writeFileSync(join(KESTREL_DIR, 'workspace.yaml'), `version: 1\norgId: ${KESTREL}\nname: Kestrel Capital\n`);
}
seed();

const ENV_KEYS = ['WORKSPACE_PATH', 'VOCION_WORKSPACE_MAP'] as const;
const saved: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {};

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-folder-northwind', name: 'Northwind', slug: 'northwind-folder' },
    { id: 'acct-folder-kestrel', name: 'Kestrel Capital', slug: 'kestrel-folder' },
  ]);
  await db.insert(projectSchema).values([
    { id: NORTHWIND, accountId: 'acct-folder-northwind', slug: 'northwind', name: 'Northwind' },
    { id: KESTREL, accountId: 'acct-folder-kestrel', slug: 'kestrel-capital', name: 'Kestrel Capital' },
    // Slugs are unique within an account, not across them: both companies
    // may call a workspace `sales`.
    { id: NORTHWIND_SALES, accountId: 'acct-folder-northwind', slug: 'sales', name: 'Sales' },
    { id: KESTREL_SALES, accountId: 'acct-folder-kestrel', slug: 'sales', name: 'Sales' },
  ]);
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.WORKSPACE_PATH = NORTHWIND_DIR;
  invalidateCurrentContextShaCache();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  await db.delete(workspaceVersionSchema);
  invalidateCurrentContextShaCache();
  seed();
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('ownWorkspaceFolder', () => {
  it('is the mount for the project the mount belongs to', async () => {
    expect(await ownWorkspaceFolder(NORTHWIND)).toEqual({ own: true, path: NORTHWIND_DIR, explicit: false });
    expect(await workspacePathForProject(NORTHWIND)).toBe(NORTHWIND_DIR);
  });

  it('is never another company\'s mount, and says whose it is not', async () => {
    const kestrel = await ownWorkspaceFolder(KESTREL);

    expect(kestrel.own).toBe(false);
    expect(kestrel.own ? null : kestrel.reason).toMatch(/not this project's/);
    expect(await workspacePathForProject(KESTREL)).toBeNull();
    // The mounted-folder question still has its answer, for the banner that names the owner.
    expect(await workspaceFolderForProject(KESTREL)).toEqual({ path: NORTHWIND_DIR, explicit: false });
  });

  it('is still the mount for a project applied from an operator\'s checkout at another path, when the mount names it', async () => {
    // A single-tenant install upgraded in place: applied with
    // `workspace:apply` from /home/ops/checkout, mounted at WORKSPACE_PATH.
    await db.insert(workspaceVersionSchema).values({ orgId: NORTHWIND, projectId: NORTHWIND, sha: 'northwindsha', sourcePath: join(ROOT, 'ops-checkout'), status: 'applied', appliedBy: 'cli' });
    invalidateCurrentContextShaCache();

    expect(await ownWorkspaceFolder(NORTHWIND)).toEqual({ own: true, path: NORTHWIND_DIR, explicit: false });
  });

  it('is not the mount once another project was applied from it, whatever its manifest says', async () => {
    // Northwind's admin rewrites workspace.yaml to name Kestrel, which was
    // never applied: the folder is still Northwind's, by the record.
    await db.insert(workspaceVersionSchema).values({ orgId: NORTHWIND, projectId: NORTHWIND, sha: 'northwindsha', sourcePath: NORTHWIND_DIR, status: 'applied', appliedBy: 'cli' });
    writeFileSync(join(NORTHWIND_DIR, 'workspace.yaml'), `version: 1\norgId: ${KESTREL}\nname: Planted\n`);
    invalidateCurrentContextShaCache();

    expect((await ownWorkspaceFolder(KESTREL)).own).toBe(false);
    expect(await workspacePathForProject(KESTREL)).toBeNull();
  });

  it('is each project\'s own folder when the host maps one per project id', async () => {
    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND}:${NORTHWIND_DIR},${KESTREL}:${KESTREL_DIR}`;

    expect(await workspacePathForProject(KESTREL)).toBe(KESTREL_DIR);
    expect(await workspacePathForProject(NORTHWIND)).toBe(NORTHWIND_DIR);
  });

  it('is nothing for a project the map leaves out, never the mount', async () => {
    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND}:${NORTHWIND_DIR}`;

    expect(await ownWorkspaceFolder(KESTREL)).toEqual({ own: false, path: null, reason: 'this project has no workspace folder on this host' });
  });
});

describe('VOCION_WORKSPACE_MAP on a host with several accounts', () => {
  const SALES_DIR = join(ROOT, 'sales');

  beforeEach(() => {
    mkdirSync(SALES_DIR, { recursive: true });
    writeFileSync(join(SALES_DIR, 'workspace.yaml'), `version: 1\norgId: ${NORTHWIND_SALES}\nname: Northwind sales\n`);
  });

  it('reads a bare project slug as no project, since both companies have a `sales`', async () => {
    process.env.VOCION_WORKSPACE_MAP = `sales:${SALES_DIR}`;

    expect(await workspacePathForProject(NORTHWIND_SALES)).toBeNull();
    expect(await workspacePathForProject(KESTREL_SALES)).toBeNull();
  });

  it('still reads a bare slug that one project alone carries, so existing maps keep working', async () => {
    process.env.VOCION_WORKSPACE_MAP = `northwind:${NORTHWIND_DIR},kestrel-capital:${KESTREL_DIR}`;

    expect(await workspacePathForProject(NORTHWIND)).toBe(NORTHWIND_DIR);
    expect(await workspacePathForProject(KESTREL)).toBe(KESTREL_DIR);
  });

  it('gives the folder only to the project the entry names, by account and slug or by id', async () => {
    process.env.VOCION_WORKSPACE_MAP = `northwind-folder/sales:${SALES_DIR}`;

    expect(await workspacePathForProject(NORTHWIND_SALES)).toBe(SALES_DIR);
    expect(await workspacePathForProject(KESTREL_SALES)).toBeNull();

    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND_SALES}:${SALES_DIR}`;

    expect(await workspacePathForProject(NORTHWIND_SALES)).toBe(SALES_DIR);
    expect(await workspacePathForProject(KESTREL_SALES)).toBeNull();
  });

  it('refuses a map entry that hands Kestrel a folder the record or the manifest gives to Northwind', async () => {
    // A wrong entry: Kestrel's `sales` mapped onto Northwind's sales folder.
    process.env.VOCION_WORKSPACE_MAP = `kestrel-folder/sales:${SALES_DIR}`;

    // Its workspace.yaml names Northwind's project, which exists here.
    expect(await workspacePathForProject(KESTREL_SALES)).toBeNull();

    // And once Northwind was applied from it, the record says so too.
    writeFileSync(join(SALES_DIR, 'workspace.yaml'), 'version: 1\nname: unlabelled\n');
    await db.insert(workspaceVersionSchema).values({ orgId: NORTHWIND_SALES, projectId: NORTHWIND_SALES, sha: 'salessha', sourcePath: SALES_DIR, status: 'applied', appliedBy: 'cli' });
    invalidateCurrentContextShaCache();

    expect(await workspacePathForProject(KESTREL_SALES)).toBeNull();
  });
});

describe('get_brand — whose brand', () => {
  async function brandFor(orgId: string): Promise<string> {
    const { getBrandTool } = await import('@/services/agents/tools/getBrand');
    return String(await getBrandTool({ orgId } as RuntimeContext).invoke({}));
  }

  it('gives Northwind\'s agent Northwind\'s brand', async () => {
    const text = await brandFor(NORTHWIND);

    expect(text).toContain('Brand: Northwind Traders');
    expect(text).toContain('northwind-only voice rule');
  });

  it('never gives Kestrel\'s agent Northwind\'s colours, name or voice', async () => {
    const text = await brandFor(KESTREL);

    expect(text).not.toContain('Northwind');
    expect(text).not.toContain('#0B3D2E');
    expect(text).not.toContain('northwind-only');
    expect(text).toContain('no brand.yaml');
  });

  it('reads Kestrel\'s own brand when it has its own folder', async () => {
    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND}:${NORTHWIND_DIR},${KESTREL}:${KESTREL_DIR}`;
    writeFileSync(join(KESTREL_DIR, 'brand.yaml'), 'name: Kestrel Capital\n');

    expect(await brandFor(KESTREL)).toContain('Brand: Kestrel Capital');
  });
});

describe('the operating intent — whose standing instructions', () => {
  it('reads nothing of Northwind\'s for Kestrel, and says why it cannot be edited here', async () => {
    const { readOperatingIntent } = await import('@/services/workspace/OperatingIntentService');

    const read = await readOperatingIntent(KESTREL);

    expect(read.text).toBeNull();
    expect(read.workspaceDir).toBeNull();
    // The fixed sentence: nothing that names Northwind or where its folder is.
    expect(read.blocker).toBe(NO_OWN_WORKSPACE_FOLDER);
    expect(JSON.stringify(read)).not.toContain(NORTHWIND);
    expect(JSON.stringify(read)).not.toContain(NORTHWIND_DIR);
  });

  it('refuses Kestrel\'s write, leaving Northwind\'s file exactly as it was', async () => {
    const { writeOperatingIntent } = await import('@/services/workspace/OperatingIntentService');

    await expect(writeOperatingIntent({ orgId: KESTREL, content: 'outcomes:\n  - statement: kestrel took over\n', appliedBy: 'user:kestrel' })).rejects.toThrow();

    expect(readFileSync(join(NORTHWIND_DIR, 'operating-intent.yaml'), 'utf8')).toContain('northwind-only outcome');
  });

  it('still reads Northwind\'s own', async () => {
    const { readOperatingIntent } = await import('@/services/workspace/OperatingIntentService');

    expect((await readOperatingIntent(NORTHWIND)).text).toContain('northwind-only outcome');
  });
});

describe('the file-backed self-updates and source edits — whose folder', () => {
  it('give Kestrel no folder to write, so the refusal names the workspace repo instead', async () => {
    const selfUpdate = await import('@/services/selfUpdate/workspaceDoc');
    const source = await import('@/services/workspace/WorkspaceSourceService');

    const dir = await selfUpdate.workspaceDirFor(KESTREL);

    expect(dir).toBeNull();
    expect(selfUpdate.workspaceDocBlocker(dir)).toMatch(/no workspace directory on this host/);
    expect(await source.workspaceDirFor(KESTREL)).toBeNull();
  });

  it('refuse a Kestrel source write before anything reaches Northwind\'s folder', async () => {
    const { writeWorkspaceSource } = await import('@/services/workspace/WorkspaceSourceService');

    await expect(writeWorkspaceSource({ orgId: KESTREL, kind: 'playbook', slug: 'renewal-call', content: '# Renewal call\n\nkestrel rewrite\n', author: { kind: 'user', id: 'usr-kestrel' } } as never)).rejects.toThrow(/no workspace directory/);

    expect(readFileSync(join(NORTHWIND_DIR, 'playbooks', 'renewal-call', 'SKILL.md'), 'utf8')).toContain('northwind-only playbook');
  });

  it('give Northwind its own folder', async () => {
    const selfUpdate = await import('@/services/selfUpdate/workspaceDoc');
    const source = await import('@/services/workspace/WorkspaceSourceService');

    expect(await selfUpdate.workspaceDirFor(NORTHWIND)).toBe(NORTHWIND_DIR);
    expect(await source.workspaceDirFor(NORTHWIND)).toBe(NORTHWIND_DIR);
  });
});
