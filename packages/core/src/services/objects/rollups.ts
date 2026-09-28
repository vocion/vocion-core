import type { Rollup } from '@/libs/workspace/schemas';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { enabledPluginsFromWorkspaceDir, loadPlugin } from '@/libs/workspace/plugins';
import { RollupSchema } from '@/libs/workspace/schemas';
import { businessObjectSchema, businessObjectTypeSchema, projectSchema } from '@/models/Schema';

/**
 * Rollups — figures one object type carries that are COMPUTED from another
 * type's rows: a request's `actualCents` is the sum over its tasks, a
 * release's is the sum over the tasks it shipped, a request's `taskCount` is
 * how many tasks it became.
 *
 * A page's stats compute over their own rows, so a cross-type sum cannot be a
 * page stat; and a figure a person reads on the record itself — on
 * `/dashboard/objects/<id>`, in `objects_get`, in release notes — has to be ON
 * the record. So the roll-up is MATERIALISED: when a child's figures change
 * (today: when a worker run writes its cost onto the record it ran for), every
 * rollup that reaches that child is recomputed from all of the parent's
 * children and written onto the parent, stamped `rollupsUpdatedAt`.
 *
 * What rolls up to what is the plugin's meaning, declared in
 * `objects/<slug>/type.yaml` (`rollups:` — `RollupSchema`), and read here from
 * the type files of the plugins the org has on, the same way workspace pages
 * are read: filesystem only, nothing in the database schema.
 */

export type RollupDeclaration = {
  /** The object type the figure is written on. */
  parentType: string;
  rollup: Rollup;
};

export type RollupWrite = {
  type: string;
  id: number;
  /** A sum or a count is a number; a `min` over a date key is an ISO string. */
  fields: Record<string, number | string>;
};

/** Only the two keys the roll-up needs; a type file that fails its full schema still declares. */
const DeclaringTypeSchema = z.object({ slug: z.string(), rollups: z.array(RollupSchema).optional() });

function readTypeDir(objectsDir: string, into: RollupDeclaration[], seenTypes: Set<string>): void {
  if (!existsSync(objectsDir)) {
    return;
  }
  for (const name of readdirSync(objectsDir).sort()) {
    const file = ['type.yaml', 'type.yml'].map(f => join(objectsDir, name, f)).find(f => existsSync(f));
    if (!file) {
      continue;
    }
    try {
      const parsed = DeclaringTypeSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
      if (!parsed.success || seenTypes.has(parsed.data.slug)) {
        continue;
      }
      seenTypes.add(parsed.data.slug);
      for (const rollup of parsed.data.rollups ?? []) {
        into.push({ parentType: parsed.data.slug, rollup });
      }
    } catch {
      // A type file that does not parse declares nothing; the loader reports it at apply.
    }
  }
}

/**
 * Every rollup the org's object types declare — the mounted workspace's own
 * `objects/` first, then the plugins its `workspace.yaml` turns on, then the
 * plugins on the org's project row. A type the workspace authors wins over a
 * plugin's of the same slug, as everywhere else.
 * @param orgId - Tenant / project id.
 */
export async function readRollupDeclarations(orgId: string): Promise<RollupDeclaration[]> {
  const out: RollupDeclaration[] = [];
  const seenTypes = new Set<string>();
  const seenPlugins = new Set<string>();
  const ws = process.env.WORKSPACE_PATH ?? process.env.CONTEXT_PATH ?? null;
  if (ws && existsSync(ws)) {
    readTypeDir(join(ws, 'objects'), out, seenTypes);
    for (const plugin of enabledPluginsFromWorkspaceDir(ws)) {
      seenPlugins.add(plugin.manifest.slug);
      readTypeDir(join(plugin.sourcePath, 'objects'), out, seenTypes);
    }
  }
  // The project's own list (`project.enabled_plugins`), read directly rather
  // than through PluginService so the worker-run path does not pull the
  // workspace applier along with it.
  const [row] = await db.select({ enabledPlugins: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  for (const slug of row?.enabledPlugins ?? []) {
    if (seenPlugins.has(slug)) {
      continue;
    }
    seenPlugins.add(slug);
    try {
      readTypeDir(join(loadPlugin(slug).sourcePath, 'objects'), out, seenTypes);
    } catch {
      // A plugin this core no longer ships declares nothing.
    }
  }
  return out;
}

type ObjectRow = typeof businessObjectSchema.$inferSelect;

/**
 * `metadata ->> 'key'`, key inlined — the schema's grammar is what makes the literal safe.
 * @param key - A metadata key that passed `MetaKeySchema`.
 */
function metaText(key: string) {
  return sql`${businessObjectSchema.metadata} ->> ${sql.raw(`'${key}'`)}`;
}

function numberOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function idsOf(v: unknown): number[] {
  return Array.isArray(v) ? v.map(x => (typeof x === 'number' ? x : Number(x))).filter(n => Number.isInteger(n) && n > 0) : [];
}

async function typeIdOf(orgId: string, slug: string): Promise<number | null> {
  const row = await db.query.businessObjectTypeSchema.findFirst({ where: and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, slug)) });
  return row?.id ?? null;
}

/**
 * The parents one child reaches through one link.
 * @param orgId - Tenant.
 * @param parentTypeId - The parent type's row id.
 * @param child - The child that changed.
 * @param rollup - The link to follow.
 */
async function parentsOf(orgId: string, parentTypeId: number, child: ObjectRow, rollup: Rollup): Promise<ObjectRow[]> {
  const scope = [eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, parentTypeId)];
  if (rollup.from.by) {
    const raw = (child.metadata ?? {})[rollup.from.by];
    if (rollup.from.match) {
      // The child names the parent by a value the parent carries (a slug),
      // not by its row id.
      const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
      if (value === '') {
        return [];
      }
      return db.select().from(businessObjectSchema).where(and(...scope, eq(metaText(rollup.from.match), value)));
    }
    const parentId = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return [];
    }
    return db.select().from(businessObjectSchema).where(and(...scope, eq(businessObjectSchema.id, parentId)));
  }
  if (rollup.from.inList) {
    const ids = idsOf((child.metadata ?? {})[rollup.from.inList]);
    if (ids.length === 0) {
      return [];
    }
    return db.select().from(businessObjectSchema).where(and(...scope, inArray(businessObjectSchema.id, ids)));
  }
  return db.select().from(businessObjectSchema).where(and(...scope, sql`${businessObjectSchema.metadata} -> ${sql.raw(`'${rollup.from.ids}'`)} @> ${JSON.stringify([child.id])}::jsonb`));
}

/**
 * Every child of one parent through one link.
 * @param orgId - Tenant.
 * @param childTypeId - The child type's row id.
 * @param parent - The parent being recomputed.
 * @param rollup - The link to follow.
 */
async function childrenOf(orgId: string, childTypeId: number, parent: ObjectRow, rollup: Rollup): Promise<ObjectRow[]> {
  const scope = [eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, childTypeId)];
  if (rollup.from.by) {
    if (rollup.from.match) {
      const raw = (parent.metadata ?? {})[rollup.from.match];
      const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
      if (value === '') {
        return [];
      }
      return db.select().from(businessObjectSchema).where(and(...scope, eq(metaText(rollup.from.by), value)));
    }
    return db.select().from(businessObjectSchema).where(and(...scope, eq(metaText(rollup.from.by), String(parent.id))));
  }
  if (rollup.from.inList) {
    return db.select().from(businessObjectSchema).where(and(...scope, sql`${businessObjectSchema.metadata} -> ${sql.raw(`'${rollup.from.inList}'`)} @> ${JSON.stringify([parent.id])}::jsonb`));
  }
  const ids = idsOf((parent.metadata ?? {})[rollup.from.ids!]);
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(businessObjectSchema).where(and(...scope, inArray(businessObjectSchema.id, ids)));
}

/**
 * The children one rollup counts. `status` reads the object's own column
 * (a task's `accepted` or `rejected` is a status, not metadata), and anything
 * else reads the metadata key of that name.
 * @param children - Every child through the link.
 * @param where - The declaration's filter, or undefined for all of them.
 */
function qualifying(children: ObjectRow[], where: Rollup['where']): ObjectRow[] {
  if (!where) {
    return children;
  }
  return children.filter((c) => {
    const v = where.field === 'status' ? c.status : (c.metadata ?? {})[where.field];
    return typeof v === 'string' && where.in.includes(v);
  });
}

/**
 * The earliest of a date key over these children, as an ISO string, or
 * undefined when not one of them carries a readable date. Undefined is left
 * unwritten rather than written as null: a request that has not shipped has
 * no ship date, and an empty field says that more honestly than a null does.
 * @param children - The qualifying children.
 * @param key - The child's date metadata key.
 */
function earliestOf(children: ObjectRow[], key: string): string | undefined {
  let best: number | null = null;
  for (const c of children) {
    const raw = (c.metadata ?? {})[key];
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      continue;
    }
    const t = new Date(raw).getTime();
    if (Number.isFinite(t) && (best === null || t < best)) {
      best = t;
    }
  }
  return best === null ? undefined : new Date(best).toISOString();
}

/**
 * The LATEST of a date key across children, as an ISO string; undefined when
 * no child carries a readable date. The mirror of {@link earliestOf}: a
 * product's `lastReleaseAt` is the newest release that names it.
 * @param children - The qualifying children.
 * @param key - The child's metadata date key.
 */
function latestOf(children: ObjectRow[], key: string): string | undefined {
  let best: number | null = null;
  for (const c of children) {
    const raw = (c.metadata ?? {})[key];
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      continue;
    }
    const t = new Date(raw).getTime();
    if (!Number.isNaN(t) && (best === null || t > best)) {
      best = t;
    }
  }
  return best === null ? undefined : new Date(best).toISOString();
}

/**
 * A child's figures changed: recompute every rollup that reaches it, over all
 * of each parent's children, and write the results onto the parents.
 *
 * Recomputed from scratch rather than incremented, so a retried write lands
 * the same figure and a child that moved between parents leaves the new
 * parent right (the old one is recomputed the next time one of its own
 * children changes). Parents that cannot be found — no such type applied for
 * this org, a `by` field that names nothing — are skipped, never invented.
 * @param opts - The child that changed.
 * @param opts.orgId - Tenant.
 * @param opts.childType - The child's object type slug.
 * @param opts.childId - The child's object id.
 * @param opts.declarations - Override the declarations read from the type files (tests).
 * @param opts.now - The clock, injectable for tests.
 * @returns What was written, per parent.
 */
export async function recomputeRollups(opts: { orgId: string; childType: string; childId: number; declarations?: RollupDeclaration[]; now?: Date }): Promise<RollupWrite[]> {
  const declarations = (opts.declarations ?? await readRollupDeclarations(opts.orgId)).filter(d => d.rollup.from.type === opts.childType);
  if (declarations.length === 0) {
    return [];
  }
  const childTypeId = await typeIdOf(opts.orgId, opts.childType);
  if (childTypeId === null) {
    return [];
  }
  const child = await db.query.businessObjectSchema.findFirst({ where: and(eq(businessObjectSchema.orgId, opts.orgId), eq(businessObjectSchema.typeId, childTypeId), eq(businessObjectSchema.id, opts.childId)) });
  if (!child) {
    return [];
  }
  const now = opts.now ?? new Date();
  const byParentType = new Map<string, Rollup[]>();
  for (const d of declarations) {
    byParentType.set(d.parentType, [...(byParentType.get(d.parentType) ?? []), d.rollup]);
  }

  const written: RollupWrite[] = [];
  for (const [parentType, rollups] of byParentType) {
    const parentTypeId = await typeIdOf(opts.orgId, parentType);
    if (parentTypeId === null) {
      continue;
    }
    const parents = new Map<number, ObjectRow>();
    for (const rollup of rollups) {
      for (const p of await parentsOf(opts.orgId, parentTypeId, child, rollup)) {
        parents.set(p.id, p);
      }
    }
    for (const parent of parents.values()) {
      const fields: Record<string, number | string> = {};
      for (const rollup of rollups) {
        const children = qualifying(await childrenOf(opts.orgId, childTypeId, parent, rollup), rollup.where);
        if (rollup.min) {
          const earliest = earliestOf(children, rollup.min);
          if (earliest !== undefined) {
            fields[rollup.field] = earliest;
          }
          continue;
        }
        if (rollup.max) {
          const latest = latestOf(children, rollup.max);
          if (latest !== undefined) {
            fields[rollup.field] = latest;
          }
          continue;
        }
        fields[rollup.field] = rollup.sum
          ? children.reduce((acc, c) => acc + numberOf((c.metadata ?? {})[rollup.sum!]), 0)
          : children.length;
      }
      await db.update(businessObjectSchema)
        .set({ metadata: { ...(parent.metadata ?? {}), ...fields, rollupsUpdatedAt: now.toISOString() } })
        .where(eq(businessObjectSchema.id, parent.id));
      written.push({ type: parentType, id: parent.id, fields });
    }
  }
  return written;
}

/**
 * A record was written through the objects API: recompute every rollup that
 * reaches it, as if its cost had moved.
 *
 * A worker run ending is not the only thing that changes a parent's figures.
 * A release record written when a deploy lands is what tells a request WHEN
 * it shipped, and a task moving to `rejected` is what tells a request how
 * much of its spend was rework, and neither goes through the run cost path. So
 * every write on an object is treated as a change to a possible child.
 *
 * Best effort by design, and silent when the record's type declares nothing:
 * a rollup that cannot be recomputed must not fail the write that a person
 * or an agent just made.
 * @param orgId - Tenant.
 * @param objectId - The record that was written.
 * @param now - The clock, injectable for tests.
 * @returns What was written on the parents, empty when nothing reached one.
 */
export async function recomputeRollupsForObject(orgId: string, objectId: number, now?: Date): Promise<RollupWrite[]> {
  try {
    const row = await db.select({ slug: businessObjectTypeSchema.slug })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectSchema.typeId, businessObjectTypeSchema.id))
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, objectId)))
      .limit(1);
    const slug = row[0]?.slug;
    return slug === undefined ? [] : await recomputeRollups({ orgId, childType: slug, childId: objectId, now });
  } catch {
    // The write stands whatever the rollup did; the next write recomputes.
    return [];
  }
}
