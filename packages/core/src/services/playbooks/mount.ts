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
 * File bodies are read from disk on demand. Where they are read FROM
 * depends on the row's origin:
 *   - workspace: the workspace directory (skills/ or playbooks/).
 *   - core: the base pack shipped inside vocion-core
 *     (packages/core/templates/base/...).
 *   - override: SKILL.md from the workspace; each sibling from the
 *     workspace when present, else from the base pack (merged by path).
 *
 * Per-tenant isolation is enforced by `orgId`-scoped DB queries.
 */

import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { playbookSchema } from '@/models/Schema';

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

  const out: Record<string, string> = {};
  for (const row of rows) {
    // A slug can name a skill and only mounts as what it is: the agent's
    // skills list can't pull a playbook row and vice versa.
    const requestedAsSkill = opts.skillSlugs.includes(row.slug);
    const requestedAsPlaybook = opts.playbookSlugs.includes(row.slug) || attached.has(row.slug);
    if ((row.kind === 'skill' && !requestedAsSkill) || (row.kind === 'playbook' && !requestedAsPlaybook)) {
      continue;
    }
    mountRow(row, out);
  }
  return out;
}

function mountRow(row: CatalogRow, out: Record<string, string>): void {
  const mountBase = row.kind === 'skill' ? `/skills/${row.slug}` : `/playbooks/${row.slug}`;
  const body = readByOrigin(row, 'SKILL.md');
  if (body === null) {
    // Row exists but the on-disk file is gone (renamed?). Skip silently —
    // workspace:apply should be re-run to clean up.
    return;
  }
  out[`${mountBase}/SKILL.md`] = body;
  for (const rel of row.sourceFiles ?? []) {
    const content = readByOrigin(row, rel);
    if (content !== null) {
      out[`${mountBase}/${rel}`] = content;
    }
  }
}

/**
 * Read one file of a cataloged folder, resolving the on-disk location
 * from the row's origin. Overrides read workspace-first with base-pack
 * fallback per file (sibling resources merged by path). Exported for
 * the catalog read paths (MCP playbook_get, detail pages).
 * @param row
 * @param rel
 */
export function readByOrigin(row: Pick<CatalogRow, 'kind' | 'origin' | 'slug'>, rel: string): string | null {
  const dirName = row.kind === 'skill' ? 'skills' : 'playbooks';
  const workspaceFile = (): string | null => {
    const ws = getWorkspacePath();
    return ws ? fromRepoRoot(ws, dirName, row.slug, rel) : null;
  };
  const packFile = (): string => fromRepoRoot(PACK_ROOT, dirName, row.slug, rel);

  const candidates = row.origin === 'core'
    ? [packFile()]
    : row.origin === 'override'
      ? [workspaceFile(), packFile()]
      : [workspaceFile()];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  return null;
}
