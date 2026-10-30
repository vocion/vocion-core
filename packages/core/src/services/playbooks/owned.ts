/**
 * A WORKSPACE WITH NO FOLDER OWNS ITS PLAYBOOKS, AS ARTIFACTS.
 *
 * A playbook is the workspace's own way of working: the SEO app's "how we
 * brief a page", a team's house voice. In a workspace applied from a folder
 * the file is the workspace's, and a same-slug file in it replaces the
 * plugin's (`libs/workspace/source.ts`, `WorkspaceSourceService`). A
 * workspace made in the app (every Vocion Cloud workspace) has no folder, so
 * until now a playbook an app brought was read from core's templates on every
 * turn and could not be changed at all.
 *
 * So an app install applies each playbook it ships ONCE into the workspace,
 * as the playbook's `source` mirror artifact (the same row a folder workspace
 * edits through: versions, restore, the pane, select-to-ask; principle 7).
 * From then on that copy is the workspace's:
 *
 * - **read** — the mount (`mount.ts`), `read_playbook` and the skills page read
 *   the copy's text instead of the template;
 * - **edited** — a person's Save in the pane, a Restore, and an agent's
 *   `write_playbook` once a person approves its diff all land on the copy
 *   (`WorkspaceSourceService.writeWorkspaceSource`);
 * - **kept** — when core ships new templates (`services/plugins/upgradeBundles.ts`)
 *   a copy nobody touched follows them, and a copy a person changed is kept
 *   and listed as kept on the upgrade's version row, the way an agent's
 *   edited prompt is (`libs/workspace/bundleTrack.ts`).
 *
 * Whether a copy was touched is read from what the bundle last left there: a
 * hash of its text on the install's version row (`AppBundleRecord.playbooks`).
 * A copy from before that record existed counts as touched when its last
 * version was not written by the system.
 *
 * A workspace applied from a folder never comes through here: its files are
 * its copies.
 */

import type { AuthorKind } from '@/services/ArtifactService';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { valueHash } from '@/libs/workspace/bundleTrack';
import { SOURCE_ROLE, sourceContentOf, splitFrontmatter, validateSourceText } from '@/libs/workspace/source';
import { artifactSchema, playbookSchema } from '@/models/Schema';

type CatalogRow = typeof playbookSchema.$inferSelect;

/**
 * Whether this workspace keeps its own playbook copies in the database: it
 * has never been applied from a folder (the same test an app install uses,
 * `appliedFromFolder`).
 * @param orgId - The workspace.
 */
export async function ownsPlaybookCopies(orgId: string): Promise<boolean> {
  const { appliedFromFolder } = await import('@/services/plugins/installBundle');
  return !(await appliedFromFolder(orgId));
}

/**
 * The hash a copy's text is recorded under. One definition, so an install,
 * an upgrade and a test agree on it.
 * @param text - The whole SKILL.md.
 */
export function playbookTextHash(text: string): string {
  return valueHash(text);
}

/**
 * The workspace's copies of these playbooks, by slug: the mirror rows with
 * their text and who wrote their last version.
 * @param orgId - The workspace.
 * @param slugs - Playbook slugs.
 */
async function copiesOf(orgId: string, slugs: readonly string[]): Promise<Map<string, { id: number; text: string; lastAuthorKind: AuthorKind; currentVersion: number }>> {
  if (slugs.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: artifactSchema.id, recordId: artifactSchema.recordId, spec: artifactSchema.spec, lastAuthorKind: artifactSchema.lastAuthorKind, currentVersion: artifactSchema.currentVersion })
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, orgId),
      eq(artifactSchema.kind, 'playbook'),
      eq(artifactSchema.recordType, 'playbook'),
      eq(artifactSchema.recordRole, SOURCE_ROLE),
      inArray(artifactSchema.recordId, [...slugs]),
    ));
  const out = new Map<string, { id: number; text: string; lastAuthorKind: AuthorKind; currentVersion: number }>();
  for (const row of rows) {
    const text = sourceContentOf(row.spec);
    // A skill mirrors under the same record type; only a playbook's copy is one.
    if (row.recordId && text !== null && row.spec.kind === 'playbook') {
      out.set(row.recordId, { id: row.id, text, lastAuthorKind: row.lastAuthorKind, currentVersion: row.currentVersion });
    }
  }
  return out;
}

/**
 * The text an agent reads for each of these playbooks when the workspace
 * owns its copies: the copy's, by slug. Empty for a workspace applied from a
 * folder, and for a playbook with no copy yet (the template is read then).
 * @param orgId - The workspace.
 * @param slugs - The playbooks being mounted.
 */
export async function ownedPlaybookTexts(orgId: string, slugs: readonly string[]): Promise<Map<string, string>> {
  const copies = await copiesOf(orgId, slugs);
  if (copies.size === 0 || !(await ownsPlaybookCopies(orgId))) {
    return new Map();
  }
  return new Map([...copies].map(([slug, c]) => [slug, c.text]));
}

/**
 * The catalog row of a playbook this workspace owns a copy of — a playbook
 * (not a skill) in a workspace with no folder — or null. What decides
 * whether an edit lands on the copy or on a file.
 * @param orgId - The workspace.
 * @param slug - The playbook.
 */
export async function ownedPlaybookRow(orgId: string, slug: string): Promise<CatalogRow | null> {
  const [row] = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, slug), eq(playbookSchema.kind, 'playbook')))
    .limit(1);
  if (!row || !(await ownsPlaybookCopies(orgId))) {
    return null;
  }
  return row;
}

/**
 * The text of the workspace's copy of a playbook: its mirror's, else what
 * the app shipped (a playbook installed before copies were kept). Null when
 * neither can be read.
 * @param orgId - The workspace.
 * @param row - The playbook's catalog row ({@link ownedPlaybookRow}).
 */
export async function ownedPlaybookText(orgId: string, row: CatalogRow): Promise<string | null> {
  const copy = (await copiesOf(orgId, [row.slug])).get(row.slug);
  if (copy) {
    return copy.text;
  }
  const { readByOrigin } = await import('./mount');
  return readByOrigin(row, 'SKILL.md', null);
}

/**
 * Keep the catalog row in step with the copy's text: the name and
 * description the skills page lists, and the body's hash. A text that does
 * not validate leaves the row as it is.
 * @param orgId - The workspace.
 * @param slug - The playbook.
 * @param text - The copy's whole SKILL.md.
 */
export async function syncOwnedCatalogRow(orgId: string, slug: string, text: string): Promise<void> {
  let name: string;
  let description: string | null;
  let body: string;
  try {
    const v = validateSourceText('playbook', slug, text);
    name = v.title;
    description = v.description;
    body = splitFrontmatter(text).body;
  } catch {
    return;
  }
  await db
    .update(playbookSchema)
    .set({ name, ...(description ? { description } : {}), contentSha: createHash('sha256').update(body, 'utf8').digest('hex') })
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, slug), eq(playbookSchema.kind, 'playbook')));
}

/** What applying an app's playbooks did to the workspace's copies. */
export type OwnedPlaybookSeed = {
  /** Slug → the hash to record as what the bundle last left there. */
  hashes: Record<string, string>;
  /** Copies created from the templates. */
  created: string[];
  /** Copies nobody had touched, moved to the new templates. */
  updated: string[];
  /** Copies a person changed, kept as they are. */
  kept: string[];
};

/**
 * Apply an app's playbooks into a workspace that owns its copies: create the
 * copy a playbook does not have yet, move an untouched copy to the template,
 * and keep a copy a person changed.
 * @param orgId - The workspace.
 * @param playbooks - The playbooks the bundle ships, each with its template file.
 * @param last - Slug → hash of what the bundle last left in each copy (`AppBundleRecord.playbooks`).
 */
export async function seedOwnedPlaybooks(orgId: string, playbooks: ReadonlyArray<{ slug: string; name: string; sourceFile: string }>, last: Readonly<Record<string, string>>): Promise<OwnedPlaybookSeed> {
  const out: OwnedPlaybookSeed = { hashes: {}, created: [], updated: [], kept: [] };
  if (playbooks.length === 0) {
    return out;
  }
  const { mirrorSource } = await import('@/services/workspace/WorkspaceSourceService');
  const copies = await copiesOf(orgId, playbooks.map(p => p.slug));
  const system = { kind: 'system' as const, id: null };
  for (const pb of playbooks) {
    const shipped = readFileSync(pb.sourceFile, 'utf8');
    const shippedHash = playbookTextHash(shipped);
    const copy = copies.get(pb.slug);
    if (!copy) {
      await mirrorSource({ orgId, kind: 'playbook', slug: pb.slug, title: pb.name, content: shipped, author: system, changeSummary: 'Added with the app' });
      out.hashes[pb.slug] = shippedHash;
      out.created.push(pb.slug);
      continue;
    }
    const before = last[pb.slug];
    const nowHash = playbookTextHash(copy.text);
    const touched = before ? nowHash !== before : copy.lastAuthorKind !== 'system';
    if (touched && nowHash !== shippedHash) {
      // The person's: the old hash is carried forward, so it stays theirs on
      // every later upgrade until they put it back. The applier just wrote
      // the template's name and description onto the row; put theirs back.
      out.hashes[pb.slug] = before ?? shippedHash;
      out.kept.push(pb.slug);
      await syncOwnedCatalogRow(orgId, pb.slug, copy.text);
      continue;
    }
    if (copy.text !== shipped) {
      await mirrorSource({ orgId, kind: 'playbook', slug: pb.slug, title: pb.name, content: shipped, author: system, changeSummary: 'Updated with the app' });
      out.updated.push(pb.slug);
    }
    out.hashes[pb.slug] = shippedHash;
  }
  return out;
}
