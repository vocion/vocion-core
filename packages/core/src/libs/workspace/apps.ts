/**
 * Apps — what a person picks in the dashboard's left rail.
 *
 * An app is a directory at `packages/core/templates/apps/<id>/` holding one
 * `app.yaml` (`AppManifestSchema`): a name, an icon, the plugins it is made of
 * and the nav sections their rows sit in. It ships no capability of its own,
 * so it needs no apply and no column: a workspace has an app exactly when one
 * of the app's plugins (or surfaces) is on there, which
 * `features/navigation/apps.ts` resolves from `project.enabled_plugins`.
 *
 * This module is the filesystem half, shaped like `plugins.ts`: which apps
 * exist and what each declares. Pure reads, no DB.
 */

import type { AppManifest } from './schemas';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { AppManifestSchema } from './schemas';

/** Where the shipped apps live, relative to the repo root. */
export const APPS_REL = 'packages/core/templates/apps';

function appsRoot(): string {
  return fromRepoRoot(APPS_REL);
}

/** Ids of every shipped app (its directory name), A–Z. A directory without an `app.yaml` is skipped. */
export function listAppIds(): string[] {
  const root = appsRoot();
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .sort()
    .filter(name => statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'app.yaml')));
}

/**
 * Read and validate one app's manifest. Throws with the file named when the
 * id is unknown, the manifest fails the schema, or its `id` disagrees with
 * its directory — the same rules a plugin is held to.
 * @param id - The app id (its directory name).
 */
export function loadApp(id: string): AppManifest {
  const dir = join(appsRoot(), id);
  const file = join(dir, 'app.yaml');
  if (!existsSync(file)) {
    const known = listAppIds();
    throw new Error(`unknown app "${id}" — this core ships: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }
  const result = AppManifestSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
  if (!result.success) {
    const messages = result.error.issues.map(i => `${i.path.length > 0 ? i.path.map(String).join('.') : '(root)'}: ${i.message}`);
    throw new Error(`app manifest validation failed at ${file}:\n  - ${messages.join('\n  - ')}`);
  }
  if (result.data.id !== id) {
    throw new Error(`app at ${dir} declares id "${result.data.id}" but lives in a directory named "${id}" — the two must agree`);
  }
  return result.data;
}

/**
 * Every shipped app, in rail order (`order`, then id). Throws when no app or
 * more than one sets `core: true` — the rail needs exactly one home.
 */
export function listApps(): AppManifest[] {
  const apps = listAppIds().map(loadApp).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const core = apps.filter(a => a.core);
  if (core.length !== 1) {
    throw new Error(`exactly one app must set core: true — found ${core.length > 0 ? core.map(a => a.id).join(', ') : 'none'}`);
  }
  return apps;
}

/** The app catalogue, or nothing — a broken app.yaml must never take the shell down. */
export function safeListApps(): AppManifest[] {
  try {
    return listApps();
  } catch (error) {
    console.warn('apps: could not read the app catalogue', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
