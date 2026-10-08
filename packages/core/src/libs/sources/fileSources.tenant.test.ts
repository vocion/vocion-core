import type { IngestDoc } from '@/services/IngestionService';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * File sources on a host that serves two companies.
 *
 * Northwind's workspace is the folder mounted on `WORKSPACE_PATH`; Kestrel
 * Capital, the other account on the host, has no folder here. Before this,
 * `local-files` and `file-import` resolved a relative path against that
 * mount and passed an absolute one straight through, and the source writers
 * stored whatever config the caller sent, `_manifestDir` included. So a
 * Kestrel admin could:
 *
 *   - add `local-files` over `directory: '.'` and copy Northwind's agent
 *     prompts and skills into Kestrel's knowledge base;
 *   - add it over `/proc/self` with `extensions: ['']` and read the worker's
 *     environment (database URL, auth secret, API keys) back through chat;
 *   - send `_manifestDir` to choose the base folder outright.
 *
 * Each is refused here, through the same route the Connectors page posts
 * to, and Northwind's own manifest-declared source still syncs.
 */

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/connect/newSourceSync', () => ({ startSourceSyncing: vi.fn(async () => null) }));

const { db } = await import('@/libs/DB');
const { clerkAuth } = await import('@/libs/Auth');
const { knowledgeSourceSchema, projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');
const { applyWorkspace } = await import('@/libs/workspace/applier');
const { loadWorkspace } = await import('@/libs/workspace/loader');
const { localFilesConnector } = await import('./localFiles');
const { fileImportConnector } = await import('./fileImport');
const { upsertSourceRow } = await import('./upsert');
const { updateSourceConfig } = await import('@/services/SourceSyncService');
const { POST } = await import('@/app/[locale]/rpc/sources/route');

const NORTHWIND = 'proj_files_northwind';
const KESTREL = 'proj_files_kestrel';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-file-sources-'));
const NORTHWIND_DIR = join(ROOT, 'northwind');

function seedNorthwind() {
  for (const dir of ['notes', 'sources', 'data']) {
    mkdirSync(join(NORTHWIND_DIR, dir), { recursive: true });
  }
  writeFileSync(join(NORTHWIND_DIR, 'workspace.yaml'), `version: 1\norgId: ${NORTHWIND}\nname: Northwind\n`);
  // Stands in for the agent prompts and skill bodies a workspace holds.
  writeFileSync(join(NORTHWIND_DIR, 'notes', 'outreach-prompt.md'), '# Outreach\n\nnorthwind-only agent prompt\n');
  writeFileSync(join(NORTHWIND_DIR, 'data', 'renewals.md'), '---\nid: renewals\n---\n\nRenewals are reviewed every quarter.\n');
  writeFileSync(join(NORTHWIND_DIR, 'data', 'tickets.jsonl'), '{"id":"t1","subject":"Late delivery","body":"Order arrived two days late."}\n');
  writeFileSync(join(NORTHWIND_DIR, 'sources', 'handbook.yaml'), 'slug: handbook\nname: Handbook\nkind: local-files\nconfig:\n  directory: data\n  extensions: [".md"]\n');
}
seedNorthwind();

function signedInAs(projectId: string) {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: `usr-${projectId}`, orgId: projectId, accountId: null, projectId, role: 'admin', workspaceRole: 'admin', has: () => true } as never);
}

/**
 * POST /rpc/sources as the signed-in admin, the way the Add-Source dialog does.
 * @param body
 */
async function addViaRoute(body: Record<string, unknown>) {
  const res = await POST(new Request('https://app.example/rpc/sources', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() as { source?: { id: number; slug: string }; error?: string } };
}

async function storedConfig(orgId: string, slug: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ configJson: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, slug)));
  return row!.configJson as Record<string, unknown>;
}

/**
 * Run a connector over a stored config the way the sync runner does, collecting what it yields and why it stopped.
 * @param connector
 * @param orgId
 * @param config
 */
async function sync(connector: typeof localFilesConnector | typeof fileImportConnector, orgId: string, config: Record<string, unknown>) {
  const docs: IngestDoc[] = [];
  const errors: string[] = [];
  for await (const doc of connector.sync({ sourceId: 1, orgId, config, onProgress: (e) => {
    if (e.kind === 'error') {
      errors.push(e.message ?? '');
    }
  } })) {
    docs.push(doc);
  }
  return { docs, errors, text: JSON.stringify(docs) };
}

const savedPath = process.env.WORKSPACE_PATH;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-files-northwind', name: 'Northwind', slug: 'northwind-files' },
    { id: 'acct-files-kestrel', name: 'Kestrel Capital', slug: 'kestrel-files' },
  ]);
  await db.insert(projectSchema).values([
    { id: NORTHWIND, accountId: 'acct-files-northwind', slug: 'northwind', name: 'Northwind' },
    { id: KESTREL, accountId: 'acct-files-kestrel', slug: 'kestrel-capital', name: 'Kestrel Capital' },
  ]);
});

beforeEach(() => {
  process.env.WORKSPACE_PATH = NORTHWIND_DIR;
  invalidateCurrentContextShaCache();
});

afterEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.delete(workspaceVersionSchema);
  invalidateCurrentContextShaCache();
});

afterAll(() => {
  if (savedPath === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = savedPath;
  }
  rmSync(ROOT, { recursive: true, force: true });
});

describe('a Kestrel admin adding a file source', () => {
  it('over "." reads nothing of Northwind\'s mounted workspace', async () => {
    signedInAs(KESTREL);
    const added = await addViaRoute({ kind: 'local-files', slug: 'dot', configJson: { directory: '.', extensions: ['.md', '.yaml'] } });

    expect(added.status).toBe(200);

    const run = await sync(localFilesConnector, KESTREL, await storedConfig(KESTREL, 'dot'));

    expect(run.docs).toEqual([]);
    expect(run.text).not.toContain('northwind-only');
    expect(run.errors.join(' ')).toContain('no workspace folder of its own');
  });

  it('over "/" or /proc/self reads nothing off the host', async () => {
    signedInAs(KESTREL);
    await addViaRoute({ kind: 'local-files', slug: 'root', configJson: { directory: '/', extensions: ['.md'] } });
    await addViaRoute({ kind: 'local-files', slug: 'proc', configJson: { directory: '/proc/self', extensions: ['.md'] } });

    for (const slug of ['root', 'proc']) {
      const run = await sync(localFilesConnector, KESTREL, await storedConfig(KESTREL, slug));

      expect(run.docs).toEqual([]);
    }
  });

  it('cannot ask for files with no extension at all', async () => {
    signedInAs(KESTREL);
    const added = await addViaRoute({ kind: 'local-files', slug: 'environ', configJson: { directory: '/proc/self', extensions: [''] } });

    expect(added.status).toBe(400);
    expect(await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, KESTREL))).toEqual([]);
  });

  it('cannot choose the base folder by sending _manifestDir, on add, on edit, or through the API writer', async () => {
    signedInAs(KESTREL);
    const added = await addViaRoute({ kind: 'local-files', slug: 'planted', configJson: { directory: '.', extensions: ['.md'], _manifestDir: NORTHWIND_DIR } });

    expect(await storedConfig(KESTREL, 'planted')).not.toHaveProperty('_manifestDir');

    await updateSourceConfig({ orgId: KESTREL, sourceId: added.body.source!.id, configJson: { directory: 'data', extensions: ['.md'], _manifestDir: NORTHWIND_DIR } });

    expect(await storedConfig(KESTREL, 'planted')).not.toHaveProperty('_manifestDir');

    await upsertSourceRow(KESTREL, { slug: 'api-planted', kind: 'local-files', config: { directory: 'data', _manifestDir: NORTHWIND_DIR }, enabled: true }, { known: { learningSteps: new Set(), agentSlugs: new Set() } });

    expect(await storedConfig(KESTREL, 'api-planted')).not.toHaveProperty('_manifestDir');

    for (const slug of ['planted', 'api-planted']) {
      expect((await sync(localFilesConnector, KESTREL, await storedConfig(KESTREL, slug))).docs).toEqual([]);
    }
  });

  it('gets nothing from a row that already names Northwind\'s folder, written before the writers dropped the key', async () => {
    await db.insert(knowledgeSourceSchema).values({ orgId: KESTREL, slug: 'old-plant', kind: 'plugin', configJson: { _connector: 'local-files', directory: 'data', _manifestDir: NORTHWIND_DIR } });

    // The folder counts only when an apply to Kestrel came from it, and none did.
    const run = await sync(localFilesConnector, KESTREL, await storedConfig(KESTREL, 'old-plant'));

    expect(run.docs).toEqual([]);
    expect(run.errors.join(' ')).toContain('no apply to this project came from');
  });

  it('cannot point file-import at Northwind\'s data or the worker\'s environment', async () => {
    signedInAs(KESTREL);
    await addViaRoute({ kind: 'file-import', slug: 'tickets', configJson: { path: 'data/tickets.jsonl' } });
    await addViaRoute({ kind: 'file-import', slug: 'environ', configJson: { path: '/proc/self/environ', format: 'csv' } });

    for (const slug of ['tickets', 'environ']) {
      const run = await sync(fileImportConnector, KESTREL, await storedConfig(KESTREL, slug));

      expect(run.docs).toEqual([]);
      expect(run.text).not.toContain('Late delivery');
    }
  });
});

describe('Northwind\'s own file sources', () => {
  it('still sync the source its workspace declares, after an apply', async () => {
    await applyWorkspace(loadWorkspace(NORTHWIND_DIR), { orgId: NORTHWIND, appliedBy: 'test' });

    const config = await storedConfig(NORTHWIND, 'handbook');
    const run = await sync(localFilesConnector, NORTHWIND, config);

    expect(config._manifestDir).toBe(NORTHWIND_DIR);
    expect(run.docs.map(d => d.externalId)).toEqual(['renewals']);
  });

  it('still read a file-import inside its own folder, and nothing outside it', async () => {
    signedInAs(NORTHWIND);
    await addViaRoute({ kind: 'file-import', slug: 'tickets', configJson: { path: 'data/tickets.jsonl' } });
    await addViaRoute({ kind: 'file-import', slug: 'climb', configJson: { path: '../../etc/hosts', format: 'csv' } });

    expect((await sync(fileImportConnector, NORTHWIND, await storedConfig(NORTHWIND, 'tickets'))).docs.map(d => d.externalId)).toEqual(['t1']);

    const climb = await sync(fileImportConnector, NORTHWIND, await storedConfig(NORTHWIND, 'climb'));

    expect(climb.docs).toEqual([]);
    expect(climb.errors.join(' ')).toContain('outside the workspace');
  });
});
