/**
 * local-files `directory:` resolves against the workspace manifest that
 * declared the source, not against WORKSPACE_PATH — and never outside it.
 *
 * The bug this pins: a template ships sample data beside its manifest
 * (`<template>/data/*.md`) and a source that says `directory: data`.
 * Resolving that against WORKSPACE_PATH only found the data when the
 * template had been copied to the workspace root, so every starter
 * template documented the same limitation. These tests load a workspace
 * from a NON-root path and assert its sample data still syncs, that a
 * manifest which IS the workspace root behaves as before, and that a path
 * outside the declaring workspace reads nothing.
 */

import type { IngestDoc } from '@/services/IngestionService';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { workspaceVersionSchema } = await import('@/models/Schema');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');
const { localFilesConnector } = await import('@/libs/sources/localFiles');
const { withManifestDir } = await import('@/libs/sources/manifestDir');
const { loadWorkspace } = await import('@/libs/workspace/loader');
const { scaffoldWorkspace } = await import('@/libs/workspace/scaffold');

const ORG = 'proj_localfiles_northwind';

const scratches: string[] = [];
const priorWorkspacePath = process.env.WORKSPACE_PATH;

afterEach(async () => {
  for (const dir of scratches.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (priorWorkspacePath === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = priorWorkspacePath;
  }
  await db.delete(workspaceVersionSchema);
  invalidateCurrentContextShaCache();
});

/**
 * Build a workspace that ships sample data beside its manifest.
 * @param at - Absolute path the workspace directory is created at.
 * @param directory - The `directory:` value authored in the source YAML.
 */
function templateWorkspaceAt(at: string, directory = 'data'): void {
  scaffoldWorkspace({ name: 'starter-support', dest: at });
  mkdirSync(join(at, 'data'), { recursive: true });
  writeFileSync(
    join(at, 'data', 'refund-policy.md'),
    '---\nid: refund-policy\ntitle: Refund policy\n---\n\nRefunds are issued within 14 days.\n',
  );
  writeFileSync(
    join(at, 'sources', 'sample-data.yaml'),
    `slug: sample-data\nname: Bundled sample data\nkind: local-files\nconfig:\n  directory: ${directory}\n`,
  );
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-localfiles-'));
  scratches.push(dir);
  return dir;
}

async function collect(config: Record<string, unknown>): Promise<{ docs: IngestDoc[]; errors: string[] }> {
  const docs: IngestDoc[] = [];
  const errors: string[] = [];
  const onProgress = (e: { kind: string; message?: string }) => {
    if (e.kind === 'error') {
      errors.push(e.message ?? '');
    }
  };
  for await (const doc of localFilesConnector.sync({ sourceId: 1, orgId: ORG, config, onProgress })) {
    docs.push(doc);
  }
  return { docs, errors };
}

/**
 * The config the applier persists for a loaded source, and the apply record
 * it writes beside it.
 * @param workspacePath - Absolute path of the workspace to load.
 */
async function appliedConfig(workspacePath: string): Promise<Record<string, unknown>> {
  const loaded = loadWorkspace(workspacePath);
  const source = loaded.sources.find(s => s.slug === 'sample-data');

  expect(source).toBeDefined();

  await db.insert(workspaceVersionSchema).values({ orgId: ORG, projectId: null, sha: loaded.sha, sourcePath: loaded.sourcePath, status: 'applied', appliedBy: 'test' });
  invalidateCurrentContextShaCache();
  return withManifestDir({ ...source!.config, _connector: source!.kind }, source!.manifestDir);
}

describe('local-files directory resolution', () => {
  it('resolves sample data for a template workspace loaded from a non-root path', async () => {
    const root = scratch();
    const nested = join(root, 'templates', 'starter-support');
    mkdirSync(join(root, 'templates'), { recursive: true });
    templateWorkspaceAt(nested);
    // The process workspace root is the parent — there is no `data/`
    // directory there, so pre-fix resolution found nothing.
    process.env.WORKSPACE_PATH = root;

    const { docs } = await collect(await appliedConfig(nested));

    expect(docs.map(d => d.externalId)).toEqual(['refund-policy']);
    expect(docs[0]!.content).toContain('Refunds are issued within 14 days.');
  });

  it('behaves identically when the manifest IS the workspace root', async () => {
    const root = scratch();
    const ws = join(root, 'acme');
    templateWorkspaceAt(ws);
    process.env.WORKSPACE_PATH = ws;

    const { docs } = await collect(await appliedConfig(ws));

    expect(docs.map(d => d.externalId)).toEqual(['refund-policy']);
  });

  it('resolves a source with no declaring manifest against the project\'s own workspace folder', async () => {
    const root = scratch();
    const ws = join(root, 'acme');
    templateWorkspaceAt(ws);
    writeFileSync(join(ws, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: Northwind\n`);
    process.env.WORKSPACE_PATH = ws;

    // A source added through the UI picker: no `_manifestDir` key.
    const { docs } = await collect({ _connector: 'local-files', directory: 'data' });

    expect(docs.map(d => d.externalId)).toEqual(['refund-policy']);
  });

  it('reads nothing from a directory outside the workspace that declared the source, and says why', async () => {
    const root = scratch();
    const nested = join(root, 'templates', 'starter-support');
    mkdirSync(join(root, 'templates'), { recursive: true });
    templateWorkspaceAt(nested);
    mkdirSync(join(root, 'elsewhere'), { recursive: true });
    writeFileSync(join(root, 'elsewhere', 'note.md'), '---\nid: elsewhere\n---\n\nOutside the workspace.\n');
    process.env.WORKSPACE_PATH = root;
    const config = await appliedConfig(nested);

    for (const directory of [join(root, 'elsewhere'), '../../elsewhere', '/']) {
      const { docs, errors } = await collect({ ...config, directory });

      expect(docs).toEqual([]);
      expect(errors.join(' ')).toContain('outside the workspace');
    }
  });

  it('reads nothing through a symlink that leads out of the workspace', async () => {
    const root = scratch();
    const ws = join(root, 'acme');
    templateWorkspaceAt(ws);
    mkdirSync(join(root, 'elsewhere'), { recursive: true });
    writeFileSync(join(root, 'elsewhere', 'note.md'), '---\nid: elsewhere\n---\n\nOutside the workspace.\n');
    symlinkSync(join(root, 'elsewhere'), join(ws, 'linked'));
    process.env.WORKSPACE_PATH = ws;

    const { docs, errors } = await collect({ ...(await appliedConfig(ws)), directory: 'linked' });

    expect(docs).toEqual([]);
    expect(errors.join(' ')).toContain('outside the workspace');
  });
});
