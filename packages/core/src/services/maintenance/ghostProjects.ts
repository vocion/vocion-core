/**
 * GHOST WORKSPACES: find them, fold them into the workspace they shadow, and
 * archive them (2026-10-09).
 *
 * Migration 0022 backfilled one project per distinct `org_id`, as
 * `proj-<org_id>`, named `Project <org_id>`, slug `org-<org_id>`. It was
 * written for legacy org ids. Run (or re-run) on a database whose `org_id`
 * already held real workspace ids, it minted a second, "ghost" project for
 * every workspace — `proj-proj-<id>`, "Project proj-<id>" — and pointed
 * `project_id` on that workspace's content at the ghost. The picker then
 * listed the ghost beside the real one, and because every `project_id`
 * foreign key cascades, deleting the ghost would delete the real workspace's
 * agents, conversations and knowledge with it.
 *
 * {@link repairGhostProjects} undoes that without deleting a workspace:
 *
 * 1. A ghost is a project whose id is `proj-<R>` and slug `org-<R>`, where
 *    `<R>` is another project's id. Nothing else matches that shape.
 * 2. Every column that holds a workspace id — each foreign key to
 *    `project.id`, each `org_id`, each `workspace_ids` array — is repointed
 *    from the ghost to the real workspace. Columns no unique key covers move
 *    in one statement.
 * 3. Columns a unique key covers move row by row. A row that would collide
 *    with a row the real workspace already has (the ghost's own
 *    `workspace-lead` agent, a budget for the same scope and period) is
 *    merged into it: anything referencing the ghost's row is repointed to the
 *    real row, spend counters are added together, and the duplicate row is
 *    removed. Every merge is reported.
 * 4. The ghost is archived and renamed "Archived duplicate of <name>". It is
 *    never deleted, so nothing cascades.
 *
 * One transaction per Org. Dry run by default: the whole repair runs, the
 * counts are read, and it rolls back. A second run finds nothing to do.
 *
 * Written against a bare `query(text, params)` client, not the app's drizzle
 * instance, so the same code runs in a unit test (PGlite), from the CLI
 * (`src/scripts/repair-ghost-projects.ts`), and bundled into one file inside
 * a production container that has no TypeScript toolchain.
 */

export type SqlClient = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type Ghost = {
  ghostId: string;
  realId: string;
  accountId: string;
  realName: string;
  ghostName: string;
  archived: boolean;
};

/** A column that can hold a workspace id. */
type RefColumn = { table: string; column: string; array: boolean; unique: boolean };

export type TableCount = { table: string; column: string; ghostBefore: number; ghostAfter: number; realBefore: number; realAfter: number };

export type Merge = { table: string; column: string; action: 'merged-into-existing' | 'summed-into-existing' };

export type GhostReport = {
  ghost: Ghost;
  counts: TableCount[];
  moved: number;
  merges: Merge[];
  archived: boolean;
  nothingToDo: boolean;
};

export type RepairResult = { applied: boolean; orgs: Array<{ accountId: string; ghosts: GhostReport[]; error?: string }> };

/**
 * Columns whose values are spend, added together when a ghost's row merges
 * into the real workspace's row for the same key. Anything else keeps the
 * real workspace's value.
 */
const SUM_ON_MERGE: Record<string, string[]> = {
  agent_budget: ['current_tokens', 'current_cents', 'current_micro_cents'],
};

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Every ghost project, optionally limited to one Org.
 * @param client - Database client.
 * @param opts - Filters.
 * @param opts.accountId - Only ghosts whose real workspace is in this Org.
 */
export async function findGhosts(client: SqlClient, opts: { accountId?: string } = {}): Promise<Ghost[]> {
  const { rows } = await client.query<{ ghost_id: string; real_id: string; account_id: string; real_name: string; ghost_name: string; archived: boolean }>(
    `select g.id as ghost_id, r.id as real_id, r.account_id, r.name as real_name, g.name as ghost_name, (g.archived_at is not null) as archived
       from project g
       join project r on g.id = 'proj-' || r.id and g.slug = 'org-' || r.id
      where ($1::text is null or r.account_id = $1)
      order by r.account_id, r.id`,
    [opts.accountId ?? null],
  );
  return rows.map(r => ({ ghostId: r.ghost_id, realId: r.real_id, accountId: r.account_id, realName: r.real_name, ghostName: r.ghost_name, archived: r.archived }));
}

/**
 * Every column in the schema that can hold a workspace id, read from the
 * catalog rather than listed, so a table added next month is covered.
 * @param client - Database client.
 */
export async function workspaceIdColumns(client: SqlClient): Promise<RefColumn[]> {
  const { rows } = await client.query<{ table_name: string; column_name: string; is_array: boolean; is_unique: boolean }>(
    `with cols as (
       -- every foreign key to project(id)
       select c.conrelid as relid, a.attname as column_name
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.confrelid = 'project'::regclass and cardinality(c.conkey) = 1
       union
       -- org_id is the workspace id on content tables (CLAUDE.md, Multi-Tenancy)
       select a.attrelid, a.attname
         from pg_attribute a join pg_class t on t.oid = a.attrelid join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relkind = 'r' and not a.attisdropped
          and a.attname in ('org_id', 'project_id', 'workspace_ids')
          and a.atttypid in ('text'::regtype, 'text[]'::regtype)
     )
     select t.relname as table_name, cols.column_name,
            (a.atttypid = 'text[]'::regtype) as is_array,
            exists (select 1 from pg_index i where i.indrelid = cols.relid and i.indisunique and a.attnum = any (i.indkey)) as is_unique
       from cols
       join pg_class t on t.oid = cols.relid
       join pg_attribute a on a.attrelid = cols.relid and a.attname = cols.column_name
      where t.relname <> 'project'
      order by 1, 2`,
  );
  return rows.map(r => ({ table: r.table_name, column: r.column_name, array: r.is_array, unique: r.is_unique }));
}

async function countRefs(client: SqlClient, col: RefColumn, ghostId: string, realId: string): Promise<{ ghost: number; real: number }> {
  const t = ident(col.table);
  const c = ident(col.column);
  const sqlText = col.array
    ? `select count(*) filter (where $1 = any (${c}))::int as ghost, count(*) filter (where $2 = any (${c}))::int as real from ${t} where ${c} && array[$1, $2]::text[]`
    : `select count(*) filter (where ${c} = $1)::int as ghost, count(*) filter (where ${c} = $2)::int as real from ${t} where ${c} in ($1, $2)`;
  const { rows } = await client.query<{ ghost: number; real: number }>(sqlText, [ghostId, realId]);
  return { ghost: Number(rows[0]?.ghost ?? 0), real: Number(rows[0]?.real ?? 0) };
}

function isUniqueViolation(error: unknown): { constraint: string } | null {
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint) {
      return { constraint: err.constraint };
    }
  }
  return null;
}

/**
 * The row the ghost's row collided with: same key in the violated index, with
 * the ghost's workspace id swapped for the real one. Reads the index's own key
 * expressions and predicate, so expression and partial indexes match exactly.
 * @param client
 * @param col
 * @param ghostCtid
 * @param realId
 * @param constraint
 */
async function collidingRow(client: SqlClient, col: RefColumn, ghostCtid: string, realId: string, constraint: string): Promise<string | null> {
  const t = ident(col.table);
  const { rows: idx } = await client.query<{ keys: string[]; pred: string | null }>(
    `select array(select pg_get_indexdef(i.indexrelid, k, true) from generate_series(1, i.indnkeyatts) k) as keys,
            pg_get_expr(i.indpred, i.indrelid, true) as pred
       from pg_index i join pg_class ic on ic.oid = i.indexrelid
      where ic.relname = $1 and i.indrelid = $2::regclass`,
    [constraint, col.table],
  );
  const index = idx[0];
  if (!index) {
    return null;
  }
  const where: string[] = [];
  for (const key of index.keys) {
    const bare = key.replace(/^"|"$/g, '');
    where.push(bare === col.column ? `${ident(col.column)} = $2` : `(${key}) is not distinct from (select ${key} from ${t} where ctid = $1::tid)`);
  }
  if (index.pred) {
    where.push(`(${index.pred})`);
  }
  const { rows } = await client.query<{ ctid: string }>(`select ctid::text as ctid from ${t} where ${where.join(' and ')} and ctid <> $1::tid limit 1`, [ghostCtid, realId]);
  return rows[0]?.ctid ?? null;
}

/**
 * Fold the ghost's row into the real workspace's row it collided with: add
 * spend, repoint whatever references the ghost's row, remove the duplicate.
 * @param client
 * @param col
 * @param ghostCtid
 * @param realCtid
 */
async function mergeInto(client: SqlClient, col: RefColumn, ghostCtid: string, realCtid: string): Promise<Merge['action']> {
  const t = ident(col.table);
  const sums = SUM_ON_MERGE[col.table] ?? [];
  if (sums.length > 0) {
    const set = sums.map(c => `${ident(c)} = ${t}.${ident(c)} + g.${ident(c)}`).join(', ');
    await client.query(`update ${t} set ${set} from ${t} g where ${t}.ctid = $1::tid and g.ctid = $2::tid`, [realCtid, ghostCtid]);
  }
  // Anything pointing at the ghost's row now points at the real one, so the
  // delete below cascades into nothing.
  const { rows: fks } = await client.query<{ ref_table: string; ref_cols: string[]; cols: string[] }>(
    `select c.conrelid::regclass::text as ref_table,
            array(select a.attname from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as ref_cols,
            array(select a.attname from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as cols
       from pg_constraint c where c.contype = 'f' and c.confrelid = $1::regclass`,
    [col.table],
  );
  for (const fk of fks) {
    const refCols = fk.ref_cols.map(ident).join(', ');
    const cols = fk.cols.map(ident).join(', ');
    await client.query(
      `update ${ident(fk.ref_table.replace(/^"|"$/g, ''))} set (${refCols}) = (select ${cols} from ${t} where ctid = $1::tid)
        where (${refCols}) = (select ${cols} from ${t} where ctid = $2::tid)`,
      [realCtid, ghostCtid],
    );
  }
  await client.query(`delete from ${t} where ctid = $1::tid`, [ghostCtid]);
  return sums.length > 0 ? 'summed-into-existing' : 'merged-into-existing';
}

async function repointColumn(client: SqlClient, col: RefColumn, ghostId: string, realId: string, merges: Merge[]): Promise<number> {
  const t = ident(col.table);
  const c = ident(col.column);
  if (col.array) {
    const { rows } = await client.query<{ n: number }>(
      `with u as (update ${t} set ${c} = array(select distinct unnest(array_replace(${c}, $1, $2))) where $1 = any (${c}) returning 1) select count(*)::int as n from u`,
      [ghostId, realId],
    );
    return Number(rows[0]?.n ?? 0);
  }
  if (!col.unique) {
    const { rows } = await client.query<{ n: number }>(`with u as (update ${t} set ${c} = $2 where ${c} = $1 returning 1) select count(*)::int as n from u`, [ghostId, realId]);
    return Number(rows[0]?.n ?? 0);
  }
  // A unique key covers this column: one row at a time, so a collision is
  // merged instead of failing the whole Org.
  const { rows: targets } = await client.query<{ ctid: string }>(`select ctid::text as ctid from ${t} where ${c} = $1`, [ghostId]);
  let moved = 0;
  for (const { ctid } of targets) {
    await client.query('savepoint ghost_row');
    try {
      await client.query(`update ${t} set ${c} = $2 where ctid = $1::tid`, [ctid, realId]);
      await client.query('release savepoint ghost_row');
      moved++;
    } catch (error) {
      await client.query('rollback to savepoint ghost_row');
      await client.query('release savepoint ghost_row');
      const violation = isUniqueViolation(error);
      if (!violation) {
        throw error;
      }
      const into = await collidingRow(client, col, ctid, realId, violation.constraint);
      if (!into) {
        throw new Error(`${col.table}.${col.column}: a ghost row collides on ${violation.constraint} and its twin could not be found`);
      }
      merges.push({ table: col.table, column: col.column, action: await mergeInto(client, col, ctid, into) });
    }
  }
  return moved;
}

async function repairOne(client: SqlClient, ghost: Ghost, columns: RefColumn[]): Promise<GhostReport> {
  // One query at a time: a single connection runs them in order anyway, and
  // node-postgres refuses to queue them from 9.0.
  const before: Array<{ col: RefColumn; ghost: number; real: number }> = [];
  for (const col of columns) {
    before.push({ col, ...(await countRefs(client, col, ghost.ghostId, ghost.realId)) });
  }
  const stillReferenced = before.some(b => b.ghost > 0);
  if (!stillReferenced && ghost.archived) {
    return { ghost, counts: [], moved: 0, merges: [], archived: false, nothingToDo: true };
  }
  const merges: Merge[] = [];
  let moved = 0;
  // Foreign keys first (no unique key covers project_id), then org_id: the
  // ghost's own rows, which can collide with the real workspace's.
  const ordered = [...columns].sort((a, b) => Number(a.unique) - Number(b.unique));
  for (const col of ordered) {
    if (before.find(b => b.col === col)!.ghost > 0) {
      moved += await repointColumn(client, col, ghost.ghostId, ghost.realId, merges);
    }
  }
  await client.query(
    `update project set archived_at = coalesce(archived_at, now()), name = $2, updated_at = now() where id = $1`,
    [ghost.ghostId, `Archived duplicate of ${ghost.realName}`],
  );
  const counts: TableCount[] = [];
  for (const b of before) {
    const after = await countRefs(client, b.col, ghost.ghostId, ghost.realId);
    if (b.ghost > 0 || b.real > 0 || after.ghost > 0) {
      counts.push({ table: b.col.table, column: b.col.column, ghostBefore: b.ghost, ghostAfter: after.ghost, realBefore: b.real, realAfter: after.real });
    }
  }
  return { ghost, counts, moved, merges, archived: !ghost.archived, nothingToDo: false };
}

/**
 * Find and repair every ghost project. Dry run unless `apply` is set.
 * @param client - A single connection (transactions span its queries).
 * @param opts - Options.
 * @param opts.apply - Commit; otherwise every Org's transaction is rolled back.
 * @param opts.accountId - Only this Org.
 */
export async function repairGhostProjects(client: SqlClient, opts: { apply?: boolean; accountId?: string } = {}): Promise<RepairResult> {
  const ghosts = await findGhosts(client, { accountId: opts.accountId });
  const columns = await workspaceIdColumns(client);
  const byOrg = new Map<string, Ghost[]>();
  for (const g of ghosts) {
    byOrg.set(g.accountId, [...(byOrg.get(g.accountId) ?? []), g]);
  }
  const result: RepairResult = { applied: Boolean(opts.apply), orgs: [] };
  for (const [accountId, list] of byOrg) {
    await client.query('begin');
    try {
      const reports: GhostReport[] = [];
      for (const g of list) {
        reports.push(await repairOne(client, g, columns));
      }
      await client.query(opts.apply ? 'commit' : 'rollback');
      result.orgs.push({ accountId, ghosts: reports });
    } catch (error) {
      await client.query('rollback');
      result.orgs.push({ accountId, ghosts: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/**
 * The report as plain text: one table per ghost.
 * @param result - What {@link repairGhostProjects} returned.
 */
export function formatRepairReport(result: RepairResult): string {
  const lines: string[] = [result.applied ? 'APPLIED' : 'DRY RUN (rolled back; nothing changed)'];
  if (result.orgs.length === 0) {
    lines.push('No ghost projects found.');
  }
  for (const org of result.orgs) {
    lines.push('', `Org ${org.accountId}${org.error ? ` — FAILED, rolled back: ${org.error}` : ''}`);
    for (const r of org.ghosts) {
      lines.push(`  ${r.ghost.ghostId} -> ${r.ghost.realId} (${r.ghost.realName})`);
      if (r.nothingToDo) {
        lines.push('    nothing to do: already archived, nothing references it');
        continue;
      }
      lines.push(`    ${'table.column'.padEnd(40)} ${'ghost before'.padStart(12)} ${'ghost after'.padStart(11)} ${'real before'.padStart(11)} ${'real after'.padStart(10)}`);
      for (const c of r.counts) {
        lines.push(`    ${`${c.table}.${c.column}`.padEnd(40)} ${String(c.ghostBefore).padStart(12)} ${String(c.ghostAfter).padStart(11)} ${String(c.realBefore).padStart(11)} ${String(c.realAfter).padStart(10)}`);
      }
      const merged = new Map<string, number>();
      for (const m of r.merges) {
        const key = `${m.table}.${m.column} ${m.action}`;
        merged.set(key, (merged.get(key) ?? 0) + 1);
      }
      lines.push(`    rows moved: ${r.moved}; merged duplicates: ${r.merges.length}${merged.size ? ` (${[...merged].map(([k, n]) => `${k} x${n}`).join(', ')})` : ''}; ghost ${r.archived ? 'archived' : 'already archived'}`);
    }
  }
  return lines.join('\n');
}
