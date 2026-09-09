/**
 * local-files `directory:` resolves against the workspace manifest that
 * declared the source, not against WORKSPACE_PATH.
 *
 * The bug this pins: a template ships sample data beside its manifest
 * (`<template>/data/*.md`) and a source that says `directory: data`.
 * Resolving that against WORKSPACE_PATH only found the data when the
 * template had been copied to the workspace root, so every starter
 * template documented the same limitation. These tests load a workspace
 * from a NON-root path and assert its sample data still syncs — plus the
 * two paths that must not change: absolute `directory`, and a manifest
 * that IS the workspace root.
 */

import type { IngestDoc } from '@/services/IngestionService';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { localFilesConnector } from '@/libs/sources/localFiles';
import { withManifestDir } from '@/libs/sources/manifestDir';
import { loadWorkspace } from '@/libs/workspace/loader';
import { scaffoldWorkspace } from '@/libs/workspace/scaffold';

const scratches: string[] = [];
const priorWorkspacePath = process.env.WORKSPACE_PATH;

afterEach(() => {
  for (const dir of scratches.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (priorWorkspacePath === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = priorWorkspacePath;
  }
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

async function collect(config: Record<string, unknown>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const doc of localFilesConnector.sync({ sourceId: 1, orgId: 'org_1', config })) {
    out.push(doc);
  }
  return out;
}

/**
 * The config the applier persists for a loaded source.
 * @param workspacePath - Absolute path of the workspace to load.
 */
function storedConfig(workspacePath: string): Record<string, unknown> {
  const loaded = loadWorkspace(workspacePath);
  const source = loaded.sources.find(s => s.slug === 'sample-data');

  expect(source).toBeDefined();

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

    const docs = await collect(storedConfig(nested));

    expect(docs.map(d => d.externalId)).toEqual(['refund-policy']);
    expect(docs[0]!.content).toContain('Refunds are issued within 14 days.');
  });

  it('behaves identically when the manifest IS the workspace root', async () => {
    const root = scratch();
    const ws = join(root, 'acme');
    templateWorkspaceAt(ws);
    process.env.WORKSPACE_PATH = ws;

    const docs = await collect(storedConfig(ws));

    expect(docs.map(d => d.externalId)).toEqual(['refund-policy']);
  });

  it('keeps resolving against WORKSPACE_PATH for a source with no declaring manifest', async () => {
    const root = scratch();
    const ws = join(root, 'acme');
    templateWorkspaceAt(ws);
    process.env.WORKSPACE_PATH = ws;

    // A source added through the UI picker: no `_manifestDir` key.
    const docs = await collect({ _connector: 'local-files', directory: 'data' });

    expect(docs.map(d => d.externalId)).toEqual(['refund-policy']);
  });

  it('uses an absolute directory as given, whatever the manifest says', async () => {
    const root = scratch();
    const nested = join(root, 'templates', 'starter-support');
    mkdirSync(join(root, 'templates'), { recursive: true });
    templateWorkspaceAt(nested);
    mkdirSync(join(root, 'elsewhere'), { recursive: true });
    writeFileSync(join(root, 'elsewhere', 'note.md'), '---\nid: elsewhere\n---\n\nAbsolute wins.\n');
    process.env.WORKSPACE_PATH = root;

    const docs = await collect({
      ...storedConfig(nested),
      directory: join(root, 'elsewhere'),
    });

    expect(docs.map(d => d.externalId)).toEqual(['elsewhere']);
  });
});
