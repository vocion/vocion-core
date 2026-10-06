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
  const home = readDefaults()?.home;
  return typeof home === 'string' && home.startsWith('/dashboard') ? home : null;
}

export type WorkspaceBrand = { name: string; mark?: string; by?: { name: string; mark?: string } };

/**
 * The sidebar's chrome from `defaults` in `workspace.yaml`: whose name and
 * mark sit at the top (`brand`), and what the heading over the workspace's
 * own pages says (`nav.pagesLabel`), and whether the sidebar starts as the
 * icon rail (`nav.collapsed`). Read at request time like `home`, so a
 * rename needs no deploy. Everything optional; the caller keeps the product's
 * own branding and wording for whatever is unset.
 */
export function workspaceChrome(): { brand: WorkspaceBrand | null; pagesLabel: string | null; collapsed: boolean } {
  const d = readDefaults();
  const b = d?.brand as Partial<WorkspaceBrand> | undefined;
  const brand = b && typeof b.name === 'string' && b.name
    ? {
        name: b.name,
        ...(typeof b.mark === 'string' ? { mark: b.mark } : {}),
        ...(b.by && typeof b.by.name === 'string' ? { by: { name: b.by.name, ...(typeof b.by.mark === 'string' ? { mark: b.by.mark } : {}) } } : {}),
      }
    : null;
  const nav = d?.nav as { pagesLabel?: unknown; collapsed?: unknown } | undefined;
  const label = nav?.pagesLabel;
  return { brand, pagesLabel: typeof label === 'string' && label ? label : null, collapsed: nav?.collapsed === true };
}

function readDefaults(): Record<string, unknown> | null {
  const ws = process.env.WORKSPACE_PATH ?? process.env.CONTEXT_PATH ?? null;
  if (!ws) {
    return null;
  }
  const file = ['workspace.yaml', 'workspace.yml'].map(n => join(/* turbopackIgnore: true */ ws, n)).find(existsSync);
  if (!file) {
    return null;
  }
  try {
    const manifest = parseYaml(readFileSync(file, 'utf8')) as { defaults?: Record<string, unknown> } | null;
    return manifest?.defaults ?? null;
  } catch {
    return null;
  }
}
