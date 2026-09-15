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
 * Backwards compatibility: a manifest at the workspace root stamps
 * `_manifestDir === WORKSPACE_PATH`, so resolution is byte-for-byte what
 * it was. A source added through the UI picker has no manifest and no
 * `_manifestDir`, so it falls back to `WORKSPACE_PATH` then `cwd()` —
 * also unchanged.
 */

import path from 'node:path';
import process from 'node:process';

/** Config key holding the absolute directory of the declaring manifest. */
const MANIFEST_DIR_KEY = '_manifestDir';

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
 * The base directory a connector should resolve relative paths against:
 * the declaring manifest's directory when known, else `WORKSPACE_PATH`,
 * else the process cwd.
 * @param config - The stored source config (may carry `_manifestDir`).
 */
function sourceBaseDir(config: Record<string, unknown> | undefined): string {
  const declared = config?.[MANIFEST_DIR_KEY];
  if (typeof declared === 'string' && declared.length > 0) {
    return declared;
  }
  return process.env.WORKSPACE_PATH ?? process.cwd();
}

/**
 * Resolve a connector path option. Absolute paths pass through
 * untouched; relative ones resolve against `sourceBaseDir`.
 * @param filePath - The authored path (absolute or relative).
 * @param config - The stored source config (may carry `_manifestDir`).
 */
export function resolveSourcePath(filePath: string, config: Record<string, unknown> | undefined): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(sourceBaseDir(config), filePath);
}
