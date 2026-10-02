import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * The workspace's front door: `defaults.home` in `workspace.yaml`, read from
 * `WORKSPACE_PATH` at request time like pages and tours are, so a workspace
 * can move its landing page without a deploy. Null when unset or unreadable;
 * the caller falls back to Chat.
 */
export function workspaceHome(): string | null {
  const ws = process.env.WORKSPACE_PATH ?? process.env.CONTEXT_PATH ?? null;
  if (!ws) {
    return null;
  }
  const file = ['workspace.yaml', 'workspace.yml'].map(n => join(/* turbopackIgnore: true */ ws, n)).find(existsSync);
  if (!file) {
    return null;
  }
  try {
    const manifest = parseYaml(readFileSync(file, 'utf8')) as { defaults?: { home?: unknown } } | null;
    const home = manifest?.defaults?.home;
    return typeof home === 'string' && home.startsWith('/dashboard') ? home : null;
  } catch {
    return null;
  }
}
