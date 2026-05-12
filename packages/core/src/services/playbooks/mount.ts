/**
 * Playbook mount helper — produces the `initialFiles` map an agent's
 * deepagents runtime seeds into its virtual filesystem on each turn.
 *
 * The deepagents `createSkillsMiddleware` looks for files named
 * `SKILL.md` under any path passed in its `skills` option. We mount
 * every playbook the calling agent has access to at
 * `/playbooks/<slug>/SKILL.md` plus every sibling resource at
 * `/playbooks/<slug>/<resource-path>`. Bodies are read from disk on
 * demand (not cached in the DB row) so edits flow through immediately
 * in dev.
 *
 * An agent selects which playbooks to mount via its `playbookTags`
 * field on the `agent` table:
 *   - `null` or empty array: mount every playbook in the org.
 *   - non-empty array: mount only playbooks whose `tags` intersect.
 *
 * Per-tenant isolation is enforced by `orgId`-scoped DB queries; the
 * caller passes the resolved orgId.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { playbookSchema } from '@/models/Schema';

export type PlaybookMountFile = {
  /** Virtual-FS path (e.g. `/playbooks/discovery-followup/SKILL.md`). */
  path: string;
  /** File body text. */
  content: string;
};

export type MountPlaybooksOptions = {
  orgId: string;
  /**
   * Tag filter from `agent.playbookTags`. `null` or empty array means
   * "mount everything." Otherwise the agent only sees playbooks
   * whose tag list intersects this set.
   */
  agentTags?: string[] | null;
};

/**
 * Load playbook bodies + sibling resources from disk and return the
 * `initialFiles` map for deepagents `StateBackend`.
 *
 * Returned shape matches deepagents's expected `FilesRecord` —
 * `{ [path: string]: string }` — so it can be spread directly into the
 * agent's input `files`.
 * @param opts
 */
export async function mountPlaybooks(opts: MountPlaybooksOptions): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(playbookSchema)
    .where(eq(playbookSchema.orgId, opts.orgId));

  const selected = filterByTags(rows, opts.agentTags ?? null);

  const out: Record<string, string> = {};
  for (const row of selected) {
    const skillMdAbsPath = locateSkillMdFromContext(row.orgId, row.slug);
    if (!skillMdAbsPath) {
      // Playbook row exists but the on-disk file is gone (renamed?).
      // Skip silently — context:apply should be re-run to clean up.
      continue;
    }
    const playbookFolder = dirname(skillMdAbsPath);
    try {
      out[`/playbooks/${row.slug}/SKILL.md`] = readFileSync(skillMdAbsPath, 'utf8');
    } catch {
      continue;
    }
    for (const rel of row.sourceFiles ?? []) {
      const abs = join(playbookFolder, rel);
      try {
        out[`/playbooks/${row.slug}/${rel}`] = readFileSync(abs, 'utf8');
      } catch {
        // Missing sibling resource — log via caller if needed.
      }
    }
  }
  return out;
}

/**
 * Determine whether a playbook is mounted for a given agent tag filter.
 * Pure function, exposed for tests and the catalog UI.
 * @param playbookTags
 * @param agentTags
 */
export function isPlaybookMounted(playbookTags: string[], agentTags: string[] | null): boolean {
  if (agentTags === null || agentTags.length === 0) {
    return true;
  }
  if (playbookTags.length === 0) {
    return false;
  }
  return playbookTags.some(t => agentTags.includes(t));
}

function filterByTags<T extends { tags: string[] }>(rows: T[], agentTags: string[] | null): T[] {
  if (agentTags === null || agentTags.length === 0) {
    return rows;
  }
  return rows.filter(r => isPlaybookMounted(r.tags ?? [], agentTags));
}

/**
 * Resolve the on-disk path of a playbook's SKILL.md from the org's
 * context directory. Resolution rule: `context/<org-slug>/playbooks/<slug>/SKILL.md`
 * where `<org-slug>` is the directory under `context/` that owns this
 * org. For multi-tenant deployments where one org maps to one folder,
 * we read the path from `CONTEXT_PATH` env (defaulting to
 * `context/metacto`).
 *
 * This is a v0.2 simplification — a future phase will write the file
 * path onto the `playbook` row at apply time so we don't have to
 * recompute it.
 * @param _orgId
 * @param slug
 */
function locateSkillMdFromContext(_orgId: string, slug: string): string | null {
  const contextPath = process.env.CONTEXT_PATH || 'context/metacto';
  const candidate = join(process.cwd(), contextPath, 'playbooks', slug, 'SKILL.md');
  try {
    readFileSync(candidate, 'utf8');
    return candidate;
  } catch {
    return null;
  }
}
