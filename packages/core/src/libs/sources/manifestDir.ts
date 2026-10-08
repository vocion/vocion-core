/**
 * Where a workspace-declared source was declared, and how a connector
 * resolves a relative path against it.
 *
 * A source authored in a workspace manifest carries relative paths that
 * mean "next to the manifest that declared me" — a template's bundled
 * sample data lives at `<template>/data/`, and its `sources/*.yaml`
 * says `directory: data`. Resolving that against `WORKSPACE_PATH` (the
 * process's workspace root) only works when the manifest *is* the
 * workspace root, which is why every starter template used to document
 * "copy this to your workspace root or the sample data will not sync".
 *
 * The applier stamps the declaring manifest's directory into the stored
 * `config_json` under `_manifestDir` (the same convention as
 * `_connector`), so a connector can resolve against it at sync time
 * without knowing anything about workspaces.
 *
 * A file source reads only inside the workspace that declared it. One host
 * serves several companies, so the folder is the project's own — the
 * declaring manifest's directory when an apply to this project recorded it,
 * else the project's own workspace folder (`workspacePathForProject`), and
 * never the host's `WORKSPACE_PATH` as such, the process cwd, or a path that
 * climbs or links out of that folder. Otherwise any account admin could add a
 * `local-files` source over another company's workspace or `/proc/self` and
 * read it back through chat.
 *
 * Backwards compatibility: a manifest at the workspace root stamps
 * `_manifestDir === WORKSPACE_PATH`, so resolution is byte-for-byte what
 * it was for the project that owns the mount.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fromRepoRoot } from '@/libs/repo-root';
import { isInsideText, realPathInside } from '@/libs/workspace/contained';

/** Config key holding the absolute directory of the declaring manifest. */
const MANIFEST_DIR_KEY = '_manifestDir';

/**
 * Whether a config key is one of the reserved, `_`-prefixed keys that say
 * what a source IS (`_connector`, `_manifestDir`, `_processor`, `_name`)
 * rather than how it is configured. Only the server writes them: the
 * applier, and the writers that take each from a named field.
 * @param key - A config key.
 */
export function isReservedConfigKey(key: string): boolean {
  return key.startsWith('_');
}

/**
 * A config as a client sent it, with every reserved key dropped. A config
 * from the Connectors page, chat or the API never carries one legitimately;
 * one that does is choosing what the row is — `_manifestDir` above all, which
 * picks the folder a file source reads.
 * @param config - The config the caller sent.
 */
export function withoutReservedKeys(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !isReservedConfigKey(key)));
}

/**
 * Attach the declaring manifest's directory to a source config blob.
 * @param config - The authored `config:` block from the source manifest.
 * @param manifestDir - Absolute path of the workspace directory that declared the source.
 */
export function withManifestDir(
  config: Record<string, unknown>,
  manifestDir: string | undefined,
): Record<string, unknown> {
  return manifestDir ? { ...config, [MANIFEST_DIR_KEY]: manifestDir } : { ...config };
}

/**
 * Whether a stored source was declared in a workspace file. The applier
 * stamps every source it writes with `_manifestDir` and no other writer does,
 * so a source without it was added from the Connectors page, chat or the API.
 * The file owns a declared source: the next apply rewrites its config and its
 * schedules from the file, so a change saved anywhere else would not last.
 * @param config - The stored source config.
 */
export function isDeclaredInWorkspaceFile(config: Record<string, unknown> | null | undefined): boolean {
  const declared = config?.[MANIFEST_DIR_KEY];
  return typeof declared === 'string' && declared.length > 0;
}

/** A connector path, resolved inside its workspace — or why it may not be read. */
export type ResolvedSourcePath = { ok: true; path: string } | { ok: false; reason: string };

/**
 * The folder a source's relative paths resolve against: the declaring
 * manifest's directory when an apply to this project came from it, else the
 * project's own workspace folder. Never the host's mount for a project that
 * does not own it, and never the cwd.
 * @param orgId - The project the source belongs to.
 * @param config - The stored source config (may carry `_manifestDir`).
 */
async function sourceBaseDir(orgId: string, config: Record<string, unknown> | undefined): Promise<ResolvedSourcePath> {
  // Loaded on use: the connector registry imports this module, and nothing
  // else in it needs the database.
  const [{ orgWasAppliedFrom }, { workspacePathForProject }] = await Promise.all([
    import('@/libs/workspace/current-version'),
    import('@/libs/workspace/project-path'),
  ]);
  const declared = config?.[MANIFEST_DIR_KEY];
  if (typeof declared === 'string' && declared.length > 0) {
    // The stamp is the applier's, but the row is not proof of that on its own:
    // a client could write the key before the writers dropped it. The apply
    // record is: the folder counts only when an apply to this project came
    // from it.
    if (await orgWasAppliedFrom(orgId, declared)) {
      return { ok: true, path: declared };
    }
    return { ok: false, reason: 'this source names a workspace folder that no apply to this project came from. Apply the workspace that declares it, then sync again' };
  }
  const own = await workspacePathForProject(orgId);
  if (!own) {
    return { ok: false, reason: 'this project has no workspace folder of its own on this host, so a file source has nothing to read. Declare it in the workspace\'s sources/ folder and apply' };
  }
  return { ok: true, path: fromRepoRoot(own) };
}

/**
 * Resolve a connector path option inside the workspace that owns the source
 * ({@link sourceBaseDir}). A path that leaves that folder — absolute
 * elsewhere, climbing with `..`, or through a symlink — is refused with the
 * reason, and nothing is read.
 * @param filePath - The authored path, relative to the workspace (or absolute inside it).
 * @param ctx - The source being synced.
 * @param ctx.orgId - The project it belongs to.
 * @param ctx.config - Its stored config (may carry `_manifestDir`).
 */
export async function resolveSourcePath(
  filePath: string,
  ctx: { orgId: string; config: Record<string, unknown> | undefined },
): Promise<ResolvedSourcePath> {
  const base = await sourceBaseDir(ctx.orgId, ctx.config);
  if (!base.ok) {
    return base;
  }
  const target = path.resolve(base.path, filePath);
  const outside = { ok: false as const, reason: `"${filePath}" is outside the workspace that declared this source; a file source reads only inside its own workspace` };
  if (!isInsideText(base.path, target)) {
    return outside;
  }
  // Nothing there yet: the connector says "not accessible" the way it always has.
  if (!existsSync(/* turbopackIgnore: true */ target)) {
    return { ok: true, path: target };
  }
  return realPathInside(base.path, target) ? { ok: true, path: target } : outside;
}
