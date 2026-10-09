/**
 * A NEW SHARED WORKSPACE, MADE FROM THE APP (founder, 2026-10-09: the All
 * workspaces page had "no way to create a workspace").
 *
 * An Org admin names it; the address is made from the name, unique within
 * the Org (`-2`, `-3`, … when taken), and must be one the router can open
 * (`projectSlugProblem`). It opens on its lead, who sets it up with the person
 * in chat (#1246): the lead is seeded here, the same `ensureWorkspaceLead` the
 * chat calls lazily. The person who made it holds it as an admin, so it is
 * theirs with workspace access enforced too.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, like, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSlugProblem } from '@/libs/links';
import { projectMemberSchema, projectSchema } from '@/models/Schema';
import { ensureWorkspaceLead } from '@/services/workspace/workspaceLead';

export class WorkspaceNameError extends Error {}

const MAX_NAME = 80;
const SLUG_MAX = 36;

/**
 * An address from a name: "Kestrel Ops" → `kestrel-ops`.
 * @param name - What the person typed.
 */
export function slugFromName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return base.length >= 2 ? base : `workspace${base ? `-${base}` : ''}`;
}

/**
 * The first free address: the base, else `base-2`, `base-3`, …, skipping any
 * the router would refuse.
 * @param base - From {@link slugFromName}.
 * @param taken - Addresses already used in this Org.
 */
export function freeSlug(base: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate) && projectSlugProblem(candidate) === null) {
      return candidate;
    }
  }
}

/**
 * Create a shared workspace in an Org, held by the person who made it.
 * @param input - Who, where and what.
 * @param input.userId - The person creating it (an Org admin; the router checks).
 * @param input.accountId - The Org it belongs to.
 * @param input.name - Its name.
 */
export async function createSharedWorkspace(input: { userId: string; accountId: string; name: string }): Promise<{ id: string; slug: string; name: string }> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new WorkspaceNameError('Give the workspace a name.');
  }
  if (name.length > MAX_NAME) {
    throw new WorkspaceNameError(`Keep the name under ${MAX_NAME} characters.`);
  }
  const base = slugFromName(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const taken = new Set((await db
      .select({ slug: projectSchema.slug })
      .from(projectSchema)
      .where(and(eq(projectSchema.accountId, input.accountId), or(eq(projectSchema.slug, base), like(projectSchema.slug, `${base.slice(0, SLUG_MAX - 3)}%`)))))
      .map(r => r.slug));
    const slug = freeSlug(base, taken);
    const id = `proj-${randomUUID()}`;
    const inserted = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(projectSchema)
        .values({ id, accountId: input.accountId, slug, name, kind: 'shared' })
        .onConflictDoNothing()
        .returning({ id: projectSchema.id });
      if (rows.length === 0) {
        return false;
      }
      await tx.insert(projectMemberSchema).values({ projectId: id, userId: input.userId, role: 'admin', source: 'direct', addedBy: input.userId }).onConflictDoNothing();
      return true;
    });
    if (inserted) {
      // Opens on its lead. A failure here is healed by the chat's own lazy call.
      await ensureWorkspaceLead(id).catch(() => false);
      return { id, slug, name };
    }
    // Someone took that address at the same moment: read again and retry.
  }
  throw new WorkspaceNameError('Another workspace took that name at the same moment. Try again.');
}
