/**
 * Skill and playbook mount helper — produces the `initialFiles` map an
 * agent's deepagents runtime seeds into its virtual filesystem on each
 * turn.
 *
 * Skills mount at `/skills/<slug>/SKILL.md`, playbooks at
 * `/playbooks/<slug>/SKILL.md`, each plus sibling resources. Mounting
 * is BY NAME, never by tag:
 *   - an agent mounts the skills its `skills:` list names,
 *   - plus the playbooks its `playbooks:` list names,
 *   - plus every playbook attached to a mounted skill (the skill's own
 *     `playbooks:` frontmatter) — the playbook travels with the skill.
 *
 * Where a file is read FROM depends on the row's origin:
 *   - workspace: the project's own workspace (skills/ or playbooks/).
 *   - core: the base pack shipped inside vocion-core
 *     (packages/core/templates/base/...) or an enabled plugin
 *     (packages/core/templates/plugins/<slug>/...).
 *   - override: SKILL.md from the workspace; each sibling from the
 *     workspace when present, else from the base pack (merged by path).
 *
 * "The project's own workspace" is the database first: each apply stores
 * the folder's bodies and resources with the project (`workspace_file`,
 * `services/workspace/WorkspaceFileService.ts`), keyed by the same
 * `skills/<slug>/<file>` path this module used to open on disk. A project
 * with stored files reads them and nothing else; only a project with none
 * (not applied since the store existed) reads the folder on
 * `WORKSPACE_PATH`, exactly as before. So a sample workspace applied from
 * `templates/` mounts its skills on a host whose WORKSPACE_PATH is some
 * other folder, and a host with no folder at all mounts every body a
 * project was applied with. The base pack and plugins ship inside the
 * image and are always read from it.
 *
 * Per-tenant isolation is enforced by `orgId`-scoped DB queries.
 *
 * Workspace bodies get their `{{env.NAME}}` tokens resolved on the way
 * through (see `libs/workspace/template-vars.ts`), so an agent never
 * sees a raw token; an unresolvable one throws instead of mounting.
 * Base-pack bodies are served as shipped — every tenant gets the same
 * bytes, so they carry no per-box values.
 */

import type { StoredFiles } from '@/services/workspace/WorkspaceFileService';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { fromRepoRoot } from '@/libs/repo-root';
import { withSpecCompliantName } from '@/libs/skills/name';
import { pluginRoots } from '@/libs/workspace/plugins';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { substituteEnvTokens } from '@/libs/workspace/template-vars';
import { playbookSchema } from '@/models/Schema';
import { readStoredFiles } from '@/services/workspace/WorkspaceFileService';

const PACK_ROOT = 'packages/core/templates/base';

export type MountSkillsOptions = {
  orgId: string;
  /** Skill slugs from the agent's `skills:` list. */
  skillSlugs: string[];
  /** Playbook slugs from the agent's `playbooks:` list. */
  playbookSlugs: string[];
};

type CatalogRow = typeof playbookSchema.$inferSelect;

/**
 * Load the named skills + playbooks (and skill-attached playbooks) from
 * disk and return the `initialFiles` map for deepagents `StateBackend`:
 * `{ [path: string]: string }`.
 * @param opts
 */
export async function mountSkills(opts: MountSkillsOptions): Promise<Record<string, string>> {
  const wanted = new Set([...opts.skillSlugs, ...opts.playbookSlugs]);
  if (wanted.size === 0) {
    return {};
  }

  const rows = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, opts.orgId), inArray(playbookSchema.slug, [...wanted])));

  // Skill-attached playbooks travel with the skill. One extra fetch —
  // attachment is one level deep by design (playbooks attach nothing).
  const attached = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'skill') {
      for (const pb of row.attachedPlaybooks ?? []) {
        if (!wanted.has(pb)) {
          attached.add(pb);
        }
      }
    }
  }
  if (attached.size > 0) {
    const extra = await db
      .select()
      .from(playbookSchema)
      .where(and(eq(playbookSchema.orgId, opts.orgId), inArray(playbookSchema.slug, [...attached])));
    rows.push(...extra.filter(r => r.kind === 'playbook'));
  }

  // A slug can name a skill and only mounts as what it is: the agent's
  // skills list can't pull a playbook row and vice versa.
  const mounting = rows.filter((row) => {
    const requestedAsSkill = opts.skillSlugs.includes(row.slug);
    const requestedAsPlaybook = opts.playbookSlugs.includes(row.slug) || attached.has(row.slug);
    return !((row.kind === 'skill' && !requestedAsSkill) || (row.kind === 'playbook' && !requestedAsPlaybook));
  });

  // Every tenant file these rows could mount, from the store in one query.
  const tenantPaths = mounting
    .filter(row => row.origin !== 'core')
    .flatMap(row => ['SKILL.md', ...(row.sourceFiles ?? [])].map(rel => storedPath(row, rel)))
    .filter((path): path is string => path !== null);
  const stored = tenantPaths.length > 0 ? await readStoredFiles(opts.orgId, tenantPaths) : null;

  const out: Record<string, string> = {};
  for (const row of mounting) {
    mountRow(row, out, stored);
  }
  return out;
}

function mountRow(row: CatalogRow, out: Record<string, string>, stored: StoredFiles | null): void {
  const mountBase = row.kind === 'skill' ? `/skills/${row.slug}` : `/playbooks/${row.slug}`;
  const body = readWith(row, 'SKILL.md', stored);
  if (body === null) {
    // Row exists but its file is gone (renamed?). Skip silently —
    // workspace:apply should be re-run to clean up.
    return;
  }
  // deepagents parses this file's frontmatter and validates its `name`
  // against the Agent Skills specification, where `name` IS the identity.
  // Vocion's `name` is a human label ("Pipeline Health") and its `slug` is the
  // identity, so the mounted copy is handed the slug as `name` and keeps the
  // label as `title`. Without this the runtime logged a spec warning for every
  // mounted skill on every turn. See `libs/skills/name.ts`.
  out[`${mountBase}/SKILL.md`] = withSpecCompliantName(body, row.slug);
  for (const rel of row.sourceFiles ?? []) {
    const content = readWith(row, rel, stored);
    if (content !== null) {
      out[`${mountBase}/${rel}`] = content;
    }
  }
}

type PlaybookFileCandidate = {
  /** Folder that owns this row on disk. The file must stay inside it. */
  base: string;
  /** Where the requested resource lands, before any symlink is resolved. */
  path: string;
  /** Tenant files carry {{env.NAME}} tokens; the shared base pack does not. */
  isTenantFile: boolean;
};

/**
 * Resolve a candidate to a real path, or refuse it and say why.
 *
 * Two checks, because each catches what the other misses. Comparing the
 * path we built catches `../` walks and absolute paths, which `resolve()`
 * would otherwise honor outright. Resolving both sides for real catches a
 * symlink sitting inside the folder but pointing out of it — a tenant's
 * workspace is a git checkout, and git carries symlinks.
 *
 * Returns null when the file is absent or refused; a refusal is always
 * logged, since a quiet one is how an escape attempt stays invisible.
 * @param candidate - Where this origin thinks the file lives.
 * @param row - The catalog row being read, for the log.
 * @param resourcePath - What the caller asked for, for the log.
 */
function resolveInsideBase(candidate: PlaybookFileCandidate, row: Pick<CatalogRow, 'kind' | 'slug'>, resourcePath: string): string | null {
  const context = {
    slug: row.slug,
    kind: row.kind,
    requestedResource: resourcePath,
    resolvedPath: candidate.path,
    baseDirectory: candidate.base,
  };

  // Compared segment by segment, not as a string: a file legitimately
  // named "..notes.md" sits inside the folder, and a plain prefix test
  // would refuse it.
  const relativeToBase = relative(candidate.base, candidate.path);
  if (relativeToBase === '..' || relativeToBase.startsWith(`..${sep}`) || isAbsolute(relativeToBase)) {
    logger.warn('playbook resource path escaped its base directory, refusing to read', context);
    return null;
  }

  let realBase: string;
  let realPath: string;
  try {
    realBase = realpathSync(candidate.base);
    realPath = realpathSync(candidate.path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Ordinary: an override reads workspace-first and falls through to the
      // base pack, so a miss here is the normal path, not a problem. Still
      // worth a line naming the file — "why did my resource not mount" is
      // otherwise unanswerable without a debugger.
      logger.debug('playbook resource is not present at this origin, trying the next one', context);
    } else {
      // EACCES, ELOOP or ENOTDIR mean the mount is broken. Passing those off
      // as "the resource isn't there" is how a misconfiguration hides.
      logger.warn('playbook resource path could not be resolved on disk, refusing to read', { ...context, errorCode: code ?? 'unknown' });
    }
    return null;
  }

  if (!realPath.startsWith(realBase + sep)) {
    logger.warn('playbook resource pointed outside its base directory through a link, refusing to read', { ...context, resolvedPath: realPath, baseDirectory: realBase });
    return null;
  }
  return realPath;
}

/**
 * Where a tenant file of this row is stored: its path in the workspace folder,
 * `skills/<slug>/<file>` or `playbooks/<slug>/<file>`. Null when the resource
 * path is absolute, climbs out of the row's folder, or carries a NUL byte (no
 * file is named that, and Postgres refuses it as text) — the same refusals
 * the folder read makes, so neither store answers for another folder's file.
 * @param row - The catalog row.
 * @param resourcePath - Which file inside the row's folder.
 */
function storedPath(row: Pick<CatalogRow, 'kind' | 'slug'>, resourcePath: string): string | null {
  const base = `${row.kind === 'skill' ? 'skills' : 'playbooks'}/${row.slug}`;
  if (posix.isAbsolute(resourcePath) || isAbsolute(resourcePath) || resourcePath.includes('\0')) {
    return null;
  }
  const path = posix.normalize(`${base}/${resourcePath}`);
  return path.startsWith(`${base}/`) ? path : null;
}

/**
 * Read one file of a cataloged folder. A tenant file comes from the
 * project's stored workspace when it has one, else from the folder on
 * `WORKSPACE_PATH`; an inherited file from the base pack or a plugin.
 * Overrides read workspace-first with base-pack fallback per file (sibling
 * resources merged by path). Exported for the catalog read paths (MCP
 * playbook_get, detail pages, the voice guide, the document framework).
 *
 * `resourcePath` is caller-supplied — it is the MCP tool's `resource`
 * argument — so every candidate is checked to be inside the folder that
 * owns the row before anything is read.
 * @param row - The catalog row whose file is being read.
 * @param resourcePath - Which file inside the row's folder to read.
 */
export async function readByOrigin(row: Pick<CatalogRow, 'orgId' | 'kind' | 'origin' | 'slug'>, resourcePath: string): Promise<string | null> {
  if (row.origin === 'core' || resourcePath.trim() === '') {
    return readWith(row, resourcePath, null);
  }
  // Asked even for a path that will be refused: whether the project is
  // stored decides which refusal applies and where it is logged.
  const path = storedPath(row, resourcePath);
  return readWith(row, resourcePath, await readStoredFiles(row.orgId, path ? [path] : []));
}

/**
 * {@link readByOrigin} over files already fetched from the store — what
 * {@link mountSkills} uses so a whole roster costs one query.
 * @param row - The catalog row whose file is being read.
 * @param resourcePath - Which file inside the row's folder to read.
 * @param stored - The project's stored files, or null when none were asked for.
 */
function readWith(row: Pick<CatalogRow, 'kind' | 'origin' | 'slug'>, resourcePath: string, stored: StoredFiles | null): string | null {
  if (resourcePath.trim() === '') {
    // The MCP tool turns an omitted `resource` into 'SKILL.md' before it
    // gets here, so an empty string means the caller explicitly asked for
    // one — malformed input, not a request for the default.
    logger.warn('playbook resource path is empty, refusing to read', {
      slug: row.slug,
      kind: row.kind,
      requestedResource: resourcePath,
    });
    return null;
  }

  // The project's stored workspace answers for its own files, and when it is
  // stored it is the only answer: a file it lacks is absent, never read off
  // a mounted folder that may be another project's. An override still falls
  // through to the inherited layers below for the siblings it did not ship.
  if (row.origin !== 'core' && stored?.stored) {
    const path = storedPath(row, resourcePath);
    if (path === null) {
      logger.warn('playbook resource path escaped its folder, refusing to read', { slug: row.slug, kind: row.kind, requestedResource: resourcePath });
      return null;
    }
    const file = stored.files.get(path);
    if (file) {
      // Substitution failures are deliberately not caught — see below.
      return substituteEnvTokens(file.content, path);
    }
    if (row.origin === 'workspace') {
      logger.debug('playbook resource is not in the project\'s stored workspace', { slug: row.slug, kind: row.kind, requestedResource: resourcePath });
      return null;
    }
    return readFromFolders(row, resourcePath, false);
  }
  return readFromFolders(row, resourcePath, true);
}

/**
 * Read one file of a cataloged folder off disk, resolving the location from
 * the row's origin.
 * @param row - The catalog row whose file is being read.
 * @param resourcePath - Which file inside the row's folder to read.
 * @param withTenantFolder - Whether the folder on `WORKSPACE_PATH` may answer
 * for the tenant layer — false once the project's stored workspace has.
 */
function readFromFolders(row: Pick<CatalogRow, 'kind' | 'origin' | 'slug'>, resourcePath: string, withTenantFolder: boolean): string | null {
  const kindFolder = row.kind === 'skill' ? 'skills' : 'playbooks';
  const tenantCandidate = (): PlaybookFileCandidate | null => {
    const workspace = withTenantFolder ? getWorkspacePath() : null;
    if (!workspace) {
      return null;
    }
    const base = fromRepoRoot(workspace, kindFolder, row.slug);
    return { base, path: resolve(base, resourcePath), isTenantFile: true };
  };
  // An inherited (`core`) row came from the base pack OR from an enabled
  // plugin (`libs/workspace/plugins.ts`); both ship the same bytes to every
  // tenant. Plugins are tried first because a plugin may shadow a base slug.
  const inheritedCandidates = (): PlaybookFileCandidate[] => [
    ...pluginRoots().map((root) => {
      const base = resolve(root, kindFolder, row.slug);
      return { base, path: resolve(base, resourcePath), isTenantFile: false };
    }),
    (() => {
      const base = fromRepoRoot(PACK_ROOT, kindFolder, row.slug);
      return { base, path: resolve(base, resourcePath), isTenantFile: false };
    })(),
  ];

  // Only the tenant's own files carry {{env.NAME}} tokens, hence the flag —
  // substituting the shared base pack would let one shipped example break
  // everyone's apply.
  const candidates: Array<PlaybookFileCandidate | null> = row.origin === 'core'
    ? inheritedCandidates()
    : row.origin === 'override'
      ? [tenantCandidate(), ...inheritedCandidates()]
      : [tenantCandidate()];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const safePath = resolveInsideBase(candidate, row, resourcePath);
    if (safePath === null) {
      continue;
    }
    let contents: string;
    try {
      // turbopackIgnore: this path is only known at runtime, so the build must not
      // trace it, or Next copies the whole project into the image (next.config.ts, #832).
      contents = readFileSync(/* turbopackIgnore: true */ safePath, 'utf8');
    } catch (err) {
      // Surprising by the time we get here: the path resolved a moment ago,
      // so this is a permission problem, a race with workspace:apply, or a
      // file that vanished between the two calls. Name it — a row whose
      // file was renamed otherwise just quietly fails to mount.
      logger.warn('playbook resource resolved but could not be read, trying the next origin', {
        slug: row.slug,
        kind: row.kind,
        requestedResource: resourcePath,
        resolvedPath: safePath,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    // Substitution failures are deliberately not caught. A raw token
    // reaching a model is far harder to notice than a run that stops.
    return candidate.isTenantFile ? substituteEnvTokens(contents, candidate.path) : contents;
  }
  return null;
}
