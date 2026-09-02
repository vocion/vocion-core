/**
 * Optional dashboard surfaces (`workspace.yaml` `surfaces:`). The contract is
 * that config switches a core-registered surface ON and can never author a
 * route: an unknown id must fail at load rather than render a dead sidebar
 * link, and dropping an id must turn the surface back off.
 * DB is the PGlite mock; Temporal is stubbed unreachable.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in tests');
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');

const { eq } = await import('drizzle-orm');

const ORG = 'proj_surfaces';
const dirs: string[] = [];

/**
 * @param surfacesLine - the `surfaces:` line to write, or '' to omit the key
 */
function writeWorkspace(surfacesLine: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-surfaces-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: surfaces\n${surfacesLine}`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'revenue-lead.yaml'), 'slug: revenue-lead\nname: RevOps Lead\nsystemPrompt: You lead revenue ops.\n');
  return dir;
}

async function cleanDb() {
  for (const table of [agentSchema, projectSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
}

async function seedProject() {
  await cleanDb();
  await db.insert(tenantAccountSchema).values({ id: 'acct-sf', name: 'MetaCTO', slug: 'metacto-sf' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-sf', slug: 'surfaces', name: 'Surfaces' });
}

async function readEnabled(): Promise<string[]> {
  const [row] = await db
    .select({ enabledSurfaces: projectSchema.enabledSurfaces })
    .from(projectSchema)
    .where(eq(projectSchema.id, ORG))
    .limit(1);
  return row?.enabledSurfaces ?? [];
}

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  await cleanDb();
});

describe('workspace surfaces', () => {
  it('rejects an unknown surface id at load, naming what this core registers', () => {
    const dir = writeWorkspace('surfaces: [not-a-real-surface]\n');

    expect(() => loadWorkspace(dir)).toThrow(/unknown surface "not-a-real-surface"/);
    // The error has to be actionable, not just a rejection.
    expect(() => loadWorkspace(dir)).toThrow(/personalization/);
  });

  it('defaults to no surfaces when the key is omitted', () => {
    const loaded = loadWorkspace(writeWorkspace(''));

    expect(loaded.manifest.surfaces).toEqual([]);
  });

  it('applies enabled surfaces to the project, and dropping one turns it off', async () => {
    await seedProject();

    await applyWorkspace(loadWorkspace(writeWorkspace('surfaces: [personalization, discovery]\n')), { orgId: ORG });

    await expect(readEnabled()).resolves.toEqual(['personalization', 'discovery']);

    // Declarative: the YAML is the whole truth, so removing an id removes the
    // surface rather than leaving it stuck on from a previous apply.
    await applyWorkspace(loadWorkspace(writeWorkspace('surfaces: [personalization]\n')), { orgId: ORG });

    await expect(readEnabled()).resolves.toEqual(['personalization']);

    await applyWorkspace(loadWorkspace(writeWorkspace('')), { orgId: ORG });

    await expect(readEnabled()).resolves.toEqual([]);
  });
});
