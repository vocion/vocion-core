import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The file endpoints on a host that serves two companies.
 *
 * One deployment, two tenant accounts — Northwind and Kestrel Capital — each
 * with its own project. The folder on `WORKSPACE_PATH` is Northwind's
 * (its workspace.yaml names Northwind's project). Before this, the file
 * routes read and wrote that folder for whoever was signed in:
 *
 *   - `workspace.readPrimitive` handed a Kestrel member Northwind's agent
 *     prompts under any slug the two shared;
 *   - `workspace.writeFile` let any signed-in Kestrel user write into
 *     Northwind's folder, then applied Northwind's whole workspace onto
 *     Kestrel's project;
 *   - `teamReport.planConfig` showed Kestrel Northwind's workspace.yaml as
 *     "the file you are about to change", and `applyConfig` wrote it.
 *
 * Each refusal is proven from both sides: the other company is refused (and
 * nothing is read, written or applied), and the owner still gets through.
 * The session is the real `guardAuth`/`guardRole` over a mocked `auth()`,
 * so the admin gate on `writeFile` is the one the route actually calls.
 */

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ trackHeartbeat: vi.fn() }));
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
// The apply itself is the applier's business (and its own tests'); here it
// matters only WHICH folder is applied onto WHICH project, and whether it
// happens at all.
vi.mock('@/libs/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/workspace')>();
  return {
    ...actual,
    loadWorkspace: vi.fn((path: string) => ({ sha: `sha-of:${path}`, sourcePath: path, manifest: { orgId: null } })),
    applyWorkspace: vi.fn(async () => ({ versionId: 7, counts: {}, errors: [] })),
  };
});

const { db } = await import('@/libs/DB');
const { auth } = await import('@/libs/Auth');
const { applyWorkspace, loadWorkspace } = await import('@/libs/workspace');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');
const { NO_OWN_WORKSPACE_FOLDER } = await import('@/libs/workspace/mounted-project');
const { projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { readPrimitive, writeFile } = await import('./Workspace');
const { applyConfigRoute, planConfigRoute } = await import('./TeamReport');

const NORTHWIND = 'proj_tenant_northwind';
const KESTREL = 'proj_tenant_kestrel';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-tenant-files-'));
const NORTHWIND_DIR = join(ROOT, 'northwind');
const KESTREL_DIR = join(ROOT, 'kestrel-capital');

function seedFolder(dir: string, orgId: string, marker: string) {
  mkdirSync(join(dir, 'agents'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'account-brief'), { recursive: true });
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${orgId}\nname: ${marker}\ndescription: ${marker}-workspace-yaml\n`);
  writeFileSync(join(dir, 'agents', 'outreach.yaml'), `slug: outreach\nprompt: ${marker}-agent-prompt\n`);
  writeFileSync(join(dir, 'skills', 'account-brief', 'SKILL.md'), `# Brief\n\n${marker}-skill-body\n`);
}
seedFolder(NORTHWIND_DIR, NORTHWIND, 'northwind-only');
seedFolder(KESTREL_DIR, KESTREL, 'kestrel-own');

/**
 * Sign in as someone in one of the two projects.
 * @param projectId - The project they are working in.
 * @param role - Their role there.
 */
function signedInAs(projectId: string, role: 'admin' | 'member') {
  const accountId = projectId === NORTHWIND ? 'acct-tenant-northwind' : 'acct-tenant-kestrel';
  vi.mocked(auth).mockResolvedValue({ user: { id: `usr-${projectId}-${role}`, accountId, projectId, role, workspaceRole: role } } as never);
}

/**
 * Kestrel's answer names nothing of Northwind's: not its files, its project
 * id, its slug or name, nor where its folder is on the host.
 * @param outcome - What Kestrel got back.
 */
function expectNothingOfNorthwind(outcome: unknown) {
  const text = `${JSON.stringify(outcome)} ${(outcome as Error)?.message ?? ''}`.toLowerCase();

  expect(text).not.toContain('northwind');
  expect(text).not.toContain(NORTHWIND_DIR.toLowerCase());
  expect(text).not.toContain(ROOT.toLowerCase());
}

/**
 * Call a procedure's handler directly, the way `Workspace.test.ts` does.
 * @param route - The procedure.
 * @param input - Its input.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

const ENV_KEYS = ['WORKSPACE_PATH', 'VOCION_WORKSPACE_MAP'] as const;
const saved: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {};

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-tenant-northwind', name: 'Northwind', slug: 'northwind-tenant' },
    { id: 'acct-tenant-kestrel', name: 'Kestrel Capital', slug: 'kestrel-tenant' },
  ]);
  await db.insert(projectSchema).values([
    { id: NORTHWIND, accountId: 'acct-tenant-northwind', slug: 'northwind', name: 'Northwind' },
    { id: KESTREL, accountId: 'acct-tenant-kestrel', slug: 'kestrel-capital', name: 'Kestrel Capital' },
  ]);
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // The shared host: one folder mounted, and it is Northwind's.
  process.env.WORKSPACE_PATH = NORTHWIND_DIR;
  invalidateCurrentContextShaCache();
  vi.mocked(applyWorkspace).mockClear();
  vi.mocked(loadWorkspace).mockClear();
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
  // Put back anything a passing write changed.
  seedFolder(NORTHWIND_DIR, NORTHWIND, 'northwind-only');
  seedFolder(KESTREL_DIR, KESTREL, 'kestrel-own');
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('workspace.readPrimitive — whose folder', () => {
  it('refuses a Kestrel member the folder mounted on the host, which is Northwind\'s, and names nothing of Northwind\'s', async () => {
    signedInAs(KESTREL, 'member');

    const outcome = await call(readPrimitive, { kind: 'agent', slug: 'outreach' }).catch(err => err);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as { code?: string }).code).toBe('NOT_FOUND');
    expect(String((outcome as Error).message)).toBe(NO_OWN_WORKSPACE_FOLDER);

    expectNothingOfNorthwind(outcome);
  });

  it('answers the same whether Northwind\'s folder is mounted or nothing is, so the refusal says nothing about the host', async () => {
    signedInAs(KESTREL, 'member');
    const mounted = await call(readPrimitive, { kind: 'agent', slug: 'outreach' }).catch(err => err);
    delete process.env.WORKSPACE_PATH;
    invalidateCurrentContextShaCache();
    const nothing = await call(readPrimitive, { kind: 'agent', slug: 'outreach' }).catch(err => err);

    expect([(mounted as { code?: string }).code, (mounted as Error).message]).toEqual([(nothing as { code?: string }).code, (nothing as Error).message]);
  });

  it('refuses the skill branch the same way', async () => {
    signedInAs(KESTREL, 'admin');

    await expect(call(readPrimitive, { kind: 'skill', slug: 'account-brief' })).rejects.toThrow(NO_OWN_WORKSPACE_FOLDER);
  });

  it('still reads Northwind\'s own files for a Northwind member', async () => {
    signedInAs(NORTHWIND, 'member');

    const result = await call<{ files: Array<{ content: string }> }>(readPrimitive, { kind: 'agent', slug: 'outreach' });

    expect(result.files[0]?.content).toContain('northwind-only-agent-prompt');
  });

  it('reads each company\'s own folder when the host maps one per project', async () => {
    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND}:${NORTHWIND_DIR},${KESTREL}:${KESTREL_DIR}`;

    signedInAs(KESTREL, 'member');
    const kestrel = await call<{ files: Array<{ content: string }> }>(readPrimitive, { kind: 'agent', slug: 'outreach' });
    signedInAs(NORTHWIND, 'member');
    const northwind = await call<{ files: Array<{ content: string }> }>(readPrimitive, { kind: 'agent', slug: 'outreach' });

    expect(kestrel.files[0]?.content).toContain('kestrel-own-agent-prompt');
    expect(JSON.stringify(kestrel)).not.toContain('northwind-only');
    expect(northwind.files[0]?.content).toContain('northwind-only-agent-prompt');
  });

  it('says a project the map leaves out has no folder here, rather than falling back to the mount', async () => {
    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND}:${NORTHWIND_DIR}`;
    signedInAs(KESTREL, 'member');

    const outcome = await call(readPrimitive, { kind: 'agent', slug: 'outreach' }).catch(err => err);

    expect((outcome as { code?: string }).code).toBe('NOT_FOUND');
    expect(JSON.stringify(outcome)).not.toContain('northwind-only');
  });

  it('refuses a folder this project was last applied from elsewhere, even when the manifest is silent', async () => {
    // Kestrel's own record says its workspace came from its own folder; the
    // mount is a different folder, whatever its manifest says.
    writeFileSync(join(NORTHWIND_DIR, 'workspace.yaml'), 'version: 1\nname: unlabelled\n');
    await db.insert(workspaceVersionSchema).values({ orgId: KESTREL, projectId: KESTREL, sha: 'kestrelsha01', sourcePath: KESTREL_DIR, status: 'applied', appliedBy: 'cli' });
    invalidateCurrentContextShaCache();
    signedInAs(KESTREL, 'member');

    await expect(call(readPrimitive, { kind: 'agent', slug: 'outreach' })).rejects.toThrow(NO_OWN_WORKSPACE_FOLDER);
  });

  it('gives a project applied from an operator\'s checkout its mounted copy, when the copy names it', async () => {
    // Single-tenant self-host, applied from /home/ops/checkout with dev
    // dependencies (infra/aws/update.sh), mounted at WORKSPACE_PATH.
    await db.insert(workspaceVersionSchema).values({ orgId: NORTHWIND, projectId: NORTHWIND, sha: 'northwindsha1', sourcePath: join(ROOT, 'ops-checkout'), status: 'applied', appliedBy: 'cli' });
    invalidateCurrentContextShaCache();
    signedInAs(NORTHWIND, 'member');

    const result = await call<{ files: Array<{ content: string }> }>(readPrimitive, { kind: 'agent', slug: 'outreach' });

    expect(result.files[0]?.content).toContain('northwind-only-agent-prompt');
  });
});

describe('workspace.writeFile — whose folder, and who may write', () => {
  const target = join(NORTHWIND_DIR, 'skills', 'account-brief', 'SKILL.md');

  it('refuses a Kestrel admin: nothing written in Northwind\'s folder, nothing applied anywhere', async () => {
    signedInAs(KESTREL, 'admin');

    const outcome = await call(writeFile, { path: target, content: '# Overwritten by Kestrel\n' }).catch(err => err);

    expect((outcome as Error).message).toBe(NO_OWN_WORKSPACE_FOLDER);

    expectNothingOfNorthwind(outcome);

    expect(readFileSync(target, 'utf8')).toContain('northwind-only-skill-body');
    expect(applyWorkspace).not.toHaveBeenCalled();
    expect(await db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, KESTREL))).toEqual([]);
  });

  it('refuses a Kestrel admin who names a brand-new file in Northwind\'s folder', async () => {
    signedInAs(KESTREL, 'admin');
    const planted = join(NORTHWIND_DIR, 'skills', 'planted', 'SKILL.md');

    await expect(call(writeFile, { path: planted, content: '# planted\n' })).rejects.toThrow(NO_OWN_WORKSPACE_FOLDER);

    expect(existsSync(planted)).toBe(false);
  });

  it('refuses a Northwind member: a write is applied, and an apply is an admin\'s act', async () => {
    signedInAs(NORTHWIND, 'member');

    await expect(call(writeFile, { path: target, content: '# member edit\n' })).rejects.toThrow();

    expect(readFileSync(target, 'utf8')).toContain('northwind-only-skill-body');
    expect(applyWorkspace).not.toHaveBeenCalled();
  });

  it('lets a Northwind admin write their own folder, and applies exactly that folder onto Northwind', async () => {
    signedInAs(NORTHWIND, 'admin');

    const result = await call<{ applied: { versionId: number | null } }>(writeFile, { path: target, content: '# Brief\n\nrevised by northwind\n' });

    expect(readFileSync(target, 'utf8')).toContain('revised by northwind');
    expect(result.applied.versionId).toBe(7);
    expect(loadWorkspace).toHaveBeenCalledWith(NORTHWIND_DIR);
    expect(applyWorkspace).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyWorkspace).mock.calls[0]?.[1]).toMatchObject({ orgId: NORTHWIND });
  });

  it('with a folder per project, a Kestrel admin writes Kestrel\'s folder and cannot reach Northwind\'s', async () => {
    process.env.VOCION_WORKSPACE_MAP = `${NORTHWIND}:${NORTHWIND_DIR},${KESTREL}:${KESTREL_DIR}`;
    signedInAs(KESTREL, 'admin');

    // A path into the other company's folder escapes the caller's own.
    await expect(call(writeFile, { path: target, content: '# crossed\n' })).rejects.toThrow(/escapes/);
    expect(readFileSync(target, 'utf8')).toContain('northwind-only-skill-body');

    const own = join(KESTREL_DIR, 'skills', 'account-brief', 'SKILL.md');
    await call(writeFile, { path: own, content: '# Brief\n\nrevised by kestrel\n' });

    expect(readFileSync(own, 'utf8')).toContain('revised by kestrel');
    expect(loadWorkspace).toHaveBeenCalledWith(KESTREL_DIR);
    expect(vi.mocked(applyWorkspace).mock.calls.map(c => (c[1] as { orgId: string }).orgId)).toEqual([KESTREL]);
  });
});

describe('teamReport configure — whose workspace.yaml', () => {
  const input = { goal: 'Grow renewals', teams: [] };

  it('never shows Kestrel Northwind\'s workspace.yaml as the file it is about to change', async () => {
    signedInAs(KESTREL, 'admin');

    const plan = await call<{ files: Array<{ before: string | null }>; canApply: boolean }>(planConfigRoute, input);

    expect(JSON.stringify(plan)).not.toContain('northwind-only');
    expect(plan.canApply).toBe(false);
  });

  it('refuses Kestrel\'s apply: Northwind\'s workspace.yaml is untouched and nothing is applied', async () => {
    signedInAs(KESTREL, 'admin');

    await expect(call(applyConfigRoute, input)).rejects.toThrow(/no workspace folder/);

    expect(readFileSync(join(NORTHWIND_DIR, 'workspace.yaml'), 'utf8')).not.toContain('Grow renewals');
    expect(applyWorkspace).not.toHaveBeenCalled();
  });

  it('still plans against Northwind\'s own file for Northwind', async () => {
    signedInAs(NORTHWIND, 'admin');

    const plan = await call<{ files: Array<{ before: string | null }>; canApply: boolean }>(planConfigRoute, input);

    expect(plan.canApply).toBe(true);
    expect(plan.files[0]?.before).toContain('northwind-only-workspace-yaml');
  });
});
