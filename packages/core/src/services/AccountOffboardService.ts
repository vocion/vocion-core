/**
 * Offboarding a client account: export everything it owns, then delete it,
 * and leave a manifest of exactly what went.
 *
 * Driven by `src/scripts/account-offboard.ts`. The order is fixed — plan,
 * export, delete — and each step checks the one before it: the export must
 * hold as many rows as the plan counted, and the delete must remove exactly
 * that many, inside one transaction, or nothing is deleted at all.
 *
 * ## What belongs to an account
 *
 * Read from the database's own catalog on every run, never from a list kept
 * here, so a table added next month is covered the day it lands:
 *
 *   - **direct** — a table with an `org_id`, `project_id` or `account_id`
 *     column, matched against the account's workspace ids (`org_id`,
 *     `project_id`) and the account id (`account_id`, and `org_id` for the
 *     account-wide budget row). A table with none of those whose own text `id`
 *     is a workspace's or the account's — `tenant_account` itself, and the
 *     legacy `organization` billing row — is direct on `id`.
 *   - **derived** — a table with no such column whose foreign key points at a
 *     direct or derived table: a conversation's messages, an eval run's
 *     scores, a group's members, an install's credentials.
 *   - **users** — the people whose only account this was. A person who also
 *     belongs to another account keeps their login and loses this account's
 *     rows; an operator (`VOCION_OPERATOR_EMAILS`) is never deleted; and a
 *     person still referenced from a row outside this account is kept, with
 *     the reference named, because deleting them would reach into that row.
 *   - **user-owned** — a table whose only link is to a deleted user: their
 *     sessions, sign-in links, push subscriptions.
 *   - Everything else is **untouched**, and listed as such.
 *
 * Credentials and their data keys are ordinary rows here: `api_token` and
 * `source_credential` are direct or derived, and so is `source_dek`, the
 * account's wrapped data-encryption keys. Deleting the wrapped key is what
 * makes any copy of the ciphertext unreadable, under `local` and `kms` alike.
 *
 * ## The other account is untouched
 *
 * Before anything is deleted, every foreign key into a row being deleted is
 * checked for rows that are NOT being deleted. A cascade would delete them, a
 * `SET NULL` would edit them, and a restrict would fail the transaction — all
 * three reach outside the account, so any such reference stops the offboard
 * and is named in the manifest instead. The tests prove the strong version:
 * after offboarding one of two accounts, every table is row-for-row what it
 * was before that account existed.
 *
 * ## The export
 *
 * One JSON Lines file per table (`tables/<table>.jsonl`), the account's
 * members as `members.json`, and every markdown or table artifact as the
 * page files `exportArtifactAsPage` already writes for a workspace
 * (`artifacts/<workspace>/<artifact id>/pages/…`). Secrets are not exported —
 * a credential's ciphertext, a wrapped key, a password hash, an invite or
 * session token are written as `"[redacted]"` — and neither are derived
 * columns (embeddings, search vectors), which are rebuilt from the content
 * that IS exported.
 */

import type { SQL } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { exportArtifactAsPage } from '@/libs/artifacts/exportPage';
import { db } from '@/libs/DB';
import { artifactSchema } from '@/models/Schema';
import { isOperator } from '@/services/operator';

/** Anything that runs raw SQL: the database, or a transaction on it. */
type Executor = Pick<typeof db, 'execute'>;

/**
 * Rows from a raw query, on either driver: node-postgres and PGlite both put
 * them on `.rows`.
 * @param executor - The database or a transaction.
 * @param query - The statement.
 */
async function rowsOf<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = await executor.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

/* ------------------------------------------------------------------ */
/* The catalog                                                         */
/* ------------------------------------------------------------------ */

type Column = { name: string; type: string };
type ForeignKey = { child: string; childColumns: string[]; parent: string; parentColumns: string[]; onDelete: string };
type Catalog = { tables: Map<string, Column[]>; foreignKeys: ForeignKey[] };

/**
 * Every base table in `public` with its columns, and every foreign key
 * between them, as the database reports them now.
 * @param executor - The database.
 */
async function readCatalog(executor: Executor): Promise<Catalog> {
  const columns = await rowsOf<{ table_name: string; column_name: string; data_type: string }>(executor, sql`
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position
  `);
  const tables = new Map<string, Column[]>();
  for (const row of columns) {
    const list = tables.get(row.table_name) ?? [];
    list.push({ name: row.column_name, type: row.data_type });
    tables.set(row.table_name, list);
  }
  const foreignKeys = await rowsOf<{ child: string; parent: string; on_delete: string; child_columns: string[]; parent_columns: string[] }>(executor, sql`
    select
      (select relname from pg_class where oid = con.conrelid)::text as child,
      (select relname from pg_class where oid = con.confrelid)::text as parent,
      con.confdeltype::text as on_delete,
      array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum, n)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.n)::text[] as child_columns,
      array(select a.attname::text from unnest(con.confkey) with ordinality k(attnum, n)
            join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum order by k.n)::text[] as parent_columns
    from pg_constraint con
    where con.contype = 'f' and con.connamespace = 'public'::regnamespace
    order by 1, 2
  `);
  return {
    tables,
    foreignKeys: foreignKeys.map(fk => ({
      child: fk.child,
      parent: fk.parent,
      onDelete: fk.on_delete,
      childColumns: fk.child_columns,
      parentColumns: fk.parent_columns,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Scope: which rows of which table are the account's                  */
/* ------------------------------------------------------------------ */

/** The auth.js users table — the one table name this module has to know. */
const USERS_TABLE = 'user';

/** How a table's rows are found to be the account's. */
export type TableScopeKind = 'direct' | 'derived' | 'users' | 'user-owned';

type Ids = { accountId: string; projectIds: string[]; userIds: string[] };

type Scope = { kind: TableScopeKind; via: string; predicate: SQL };

const ident = (name: string) => sql.identifier(name);
const qualified = (table: string, column: string) => sql`${ident(table)}.${ident(column)}`;

/**
 * `column in (…)`, or `false` for an empty list (`in ()` is not SQL).
 * @param column - The column, qualified.
 * @param values - The values.
 */
function inValues(column: SQL, values: readonly string[]): SQL {
  if (values.length === 0) {
    return sql`false`;
  }
  return sql`${column} in (${sql.join(values.map(value => sql`${value}`), sql`, `)})`;
}

/**
 * `(a, b) in (select x, y from parent where …)` for one foreign key.
 * @param fk - The key.
 * @param parentPredicate - Which parent rows.
 */
function referencesScoped(fk: ForeignKey, parentPredicate: SQL): SQL {
  const childCols = sql.join(fk.childColumns.map(column => qualified(fk.child, column)), sql`, `);
  const parentCols = sql.join(fk.parentColumns.map(column => qualified(fk.parent, column)), sql`, `);
  return sql`(${childCols}) in (select ${parentCols} from ${ident(fk.parent)} where ${parentPredicate})`;
}

/**
 * Work out every table's scope for one account. Tables that come back absent
 * are untouched.
 * @param catalog - The schema.
 * @param ids - The account, its workspaces, and the people being deleted.
 */
function scopesFor(catalog: Catalog, ids: Ids): Map<string, Scope> {
  const orgIds = [...ids.projectIds, ids.accountId];
  const scopes = new Map<string, Scope>();

  // Direct first: they need nothing else.
  for (const [table, columns] of catalog.tables) {
    if (table === USERS_TABLE) {
      continue;
    }
    const names = new Map(columns.map(column => [column.name, column.type]));
    const parts: SQL[] = [];
    const via: string[] = [];
    if (names.has('org_id')) {
      parts.push(inValues(qualified(table, 'org_id'), orgIds));
      via.push('org_id');
    }
    if (names.has('project_id')) {
      parts.push(inValues(qualified(table, 'project_id'), ids.projectIds));
      via.push('project_id');
    }
    if (names.has('account_id')) {
      parts.push(sql`${qualified(table, 'account_id')} = ${ids.accountId}`);
      via.push('account_id');
    }
    if (parts.length === 0 && names.get('id') === 'text') {
      // A row whose own id IS the workspace's or the account's.
      parts.push(inValues(qualified(table, 'id'), orgIds));
      via.push('id');
    }
    if (parts.length > 0) {
      scopes.set(table, { kind: 'direct', via: via.join(' | '), predicate: sql`(${sql.join(parts, sql` or `)})` });
    }
  }

  // Derived, to a fixed point: a table joins once a parent it points at has.
  for (let added = true; added;) {
    added = false;
    for (const table of catalog.tables.keys()) {
      if (scopes.has(table) || table === USERS_TABLE) {
        continue;
      }
      const keys = catalog.foreignKeys.filter(fk => fk.child === table && fk.parent !== table && scopes.has(fk.parent) && scopes.get(fk.parent)!.kind !== 'user-owned');
      if (keys.length === 0) {
        continue;
      }
      scopes.set(table, {
        kind: 'derived',
        via: keys.map(fk => `${fk.childColumns.join(',')} → ${fk.parent}`).join(' | '),
        predicate: sql`(${sql.join(keys.map(fk => referencesScoped(fk, scopes.get(fk.parent)!.predicate)), sql` or `)})`,
      });
      added = true;
    }
  }

  // The people, and what hangs off only them.
  if (catalog.tables.has(USERS_TABLE)) {
    scopes.set(USERS_TABLE, { kind: 'users', via: 'only member of this account', predicate: inValues(qualified(USERS_TABLE, 'id'), ids.userIds) });
    for (const table of catalog.tables.keys()) {
      if (scopes.has(table)) {
        continue;
      }
      const keys = catalog.foreignKeys.filter(fk => fk.child === table && fk.parent === USERS_TABLE && fk.childColumns.length === 1);
      if (keys.length === 0) {
        continue;
      }
      scopes.set(table, {
        kind: 'user-owned',
        via: keys.map(fk => `${fk.childColumns[0]} → user`).join(' | '),
        predicate: sql`(${sql.join(keys.map(fk => inValues(qualified(table, fk.childColumns[0]!), ids.userIds)), sql` or `)})`,
      });
    }
  }
  return scopes;
}

/**
 * The tables in an order that deletes every child before its parent, so a
 * restrict never fires and every table's count is its own rather than a
 * cascade's. Ties break alphabetically, so the order is the same every run.
 * @param tables - The tables being deleted from.
 * @param foreignKeys - The schema's keys.
 */
function deleteOrder(tables: readonly string[], foreignKeys: readonly ForeignKey[]): string[] {
  const inSet = new Set(tables);
  const children = new Map<string, Set<string>>(tables.map(table => [table, new Set<string>()]));
  for (const fk of foreignKeys) {
    if (fk.child !== fk.parent && inSet.has(fk.child) && inSet.has(fk.parent)) {
      children.get(fk.parent)!.add(fk.child);
    }
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const ready = tables.filter(table => !done.has(table) && [...children.get(table)!].every(child => done.has(child))).sort();
    if (ready.length === 0) {
      const stuck = tables.filter(table => !done.has(table)).sort();
      throw new Error(`Foreign keys form a cycle between ${stuck.join(', ')}; nothing was deleted.`);
    }
    for (const table of ready) {
      done.add(table);
      order.push(table);
    }
  }
  return order;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type OffboardTable = { table: string; scope: TableScopeKind; via: string; rows: number };

export type OffboardPlan = {
  account: { id: string; name: string; slug: string };
  workspaces: Array<{ id: string; slug: string; name: string; kind: string }>;
  /** Every table with rows of the account's, in the order they are deleted. */
  tables: OffboardTable[];
  users: {
    deleted: Array<{ id: string; email: string }>;
    kept: Array<{ id: string; email: string; reason: string }>;
  };
  /**
   * Rows outside the account that point at a row inside it. Any entry stops
   * the offboard: deleting would cascade into, null out, or fail on them.
   */
  crossReferences: Array<{ table: string; columns: string[]; references: string; rows: number }>;
  /** Tables with no rows of the account's, scoped or not. */
  untouched: string[];
};

/** A refusal written for the operator running the script. */
export class OffboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffboardError';
  }
}

type Working = { plan: OffboardPlan; scopes: Map<string, Scope>; catalog: Catalog };

/**
 * Find the account by id or slug.
 * @param executor - The database.
 * @param selector - `tenant_account.id` or `.slug`.
 */
async function findAccount(executor: Executor, selector: string) {
  const [account] = await rowsOf<{ id: string; name: string; slug: string }>(executor, sql`
    select id, name, slug from tenant_account where id = ${selector} or slug = ${selector}
    order by (id = ${selector}) desc limit 1
  `);
  if (!account) {
    throw new OffboardError(`No account with id or slug "${selector}".`);
  }
  return account;
}

/**
 * Who is deleted with the account and who is kept, and why.
 * @param executor - The database.
 * @param catalog - The schema.
 * @param accountId - The account.
 * @param projectIds - Its workspaces.
 */
async function resolveUsers(executor: Executor, catalog: Catalog, accountId: string, projectIds: string[]) {
  const candidates = await rowsOf<{ id: string; email: string }>(executor, sql`
    select u.id, u.email from "user" u
    where exists (select 1 from account_membership m where m.user_id = u.id and m.account_id = ${accountId})
      and not exists (select 1 from account_membership m where m.user_id = u.id and m.account_id <> ${accountId})
    order by u.email
  `);
  const kept: Array<{ id: string; email: string; reason: string }> = [];
  let remaining = candidates.filter((user) => {
    if (isOperator(user.email)) {
      kept.push({ ...user, reason: 'operates this deployment (VOCION_OPERATOR_EMAILS)' });
      return false;
    }
    return true;
  });

  // A person referenced from a row this offboard does not delete stays: their
  // deletion would reach into that row. Scopes without users are enough to
  // decide it — whether a row is the account's never depends on who is deleted.
  const scopes = scopesFor(catalog, { accountId, projectIds, userIds: [] });
  for (const fk of catalog.foreignKeys) {
    if (fk.parent !== USERS_TABLE || fk.childColumns.length !== 1 || remaining.length === 0) {
      continue;
    }
    const childScope = scopes.get(fk.child);
    if (!childScope || childScope.kind === 'user-owned' || childScope.kind === 'users') {
      continue; // a table that is only the person's goes with them
    }
    const column = qualified(fk.child, fk.childColumns[0]!);
    const referenced = await rowsOf<{ id: string }>(executor, sql`
      select distinct ${column} as id from ${ident(fk.child)}
      where ${inValues(column, remaining.map(user => user.id))} and not coalesce(${childScope.predicate}, false)
    `);
    const ids = new Set(referenced.map(row => row.id));
    remaining = remaining.filter((user) => {
      if (ids.has(user.id)) {
        kept.push({ ...user, reason: `still referenced by ${fk.child}.${fk.childColumns[0]} outside this account` });
        return false;
      }
      return true;
    });
  }
  return { deleted: remaining, kept };
}

/**
 * Count everything that would go, and everything that stops it going.
 * @param executor - The database.
 * @param selector - The account's id or slug.
 */
async function buildPlan(executor: Executor, selector: string): Promise<Working> {
  const account = await findAccount(executor, selector);
  const workspaces = await rowsOf<{ id: string; slug: string; name: string; kind: string }>(executor, sql`
    select id, slug, name, kind from project where account_id = ${account.id} order by slug
  `);
  const projectIds = workspaces.map(workspace => workspace.id);
  const catalog = await readCatalog(executor);
  const users = await resolveUsers(executor, catalog, account.id, projectIds);
  const scopes = scopesFor(catalog, { accountId: account.id, projectIds, userIds: users.deleted.map(user => user.id) });

  const counts = new Map<string, number>();
  for (const [table, scope] of scopes) {
    const [row] = await rowsOf<{ n: number | string }>(executor, sql`select count(*)::int as n from ${ident(table)} where ${scope.predicate}`);
    counts.set(table, Number(row?.n ?? 0));
  }

  const crossReferences: OffboardPlan['crossReferences'] = [];
  for (const fk of catalog.foreignKeys) {
    const parentScope = scopes.get(fk.parent);
    // References to people are settled in `resolveUsers`, which keeps the person instead.
    if (!parentScope || fk.parent === USERS_TABLE || (counts.get(fk.parent) ?? 0) === 0) {
      continue;
    }
    const childScope = scopes.get(fk.child);
    const outside = childScope ? sql`not coalesce(${childScope.predicate}, false)` : sql`true`;
    const nonNull = sql.join(fk.childColumns.map(column => sql`${qualified(fk.child, column)} is not null`), sql` and `);
    const [row] = await rowsOf<{ n: number | string }>(executor, sql`
      select count(*)::int as n from ${ident(fk.child)}
      where ${nonNull} and ${referencesScoped(fk, parentScope.predicate)} and ${outside}
    `);
    const rows = Number(row?.n ?? 0);
    if (rows > 0) {
      crossReferences.push({ table: fk.child, columns: fk.childColumns, references: fk.parent, rows });
    }
  }

  const withRows = [...scopes.keys()].filter(table => (counts.get(table) ?? 0) > 0);
  const order = deleteOrder(withRows, catalog.foreignKeys);
  const plan: OffboardPlan = {
    account,
    workspaces,
    tables: order.map(table => ({ table, scope: scopes.get(table)!.kind, via: scopes.get(table)!.via, rows: counts.get(table)! })),
    users,
    crossReferences,
    untouched: [...catalog.tables.keys()].filter(table => !withRows.includes(table)).sort(),
  };
  return { plan, scopes, catalog };
}

/**
 * What offboarding an account would remove, changing nothing.
 * @param selector - The account's id or slug.
 */
export async function planOffboard(selector: string): Promise<OffboardPlan> {
  return (await buildPlan(db, selector)).plan;
}

/* ------------------------------------------------------------------ */
/* The export                                                          */
/* ------------------------------------------------------------------ */

/**
 * Columns whose value is a secret: written as `"[redacted]"`. Our own column
 * names, so this is the schema describing itself, not a guess about content.
 */
const SECRET_COLUMNS = new Set([
  'access_token',
  'auth_tag',
  'ciphertext',
  'code',
  'code_challenge',
  'id_token',
  'keys',
  'nonce',
  'password_hash',
  'refresh_token',
  'secret_hash',
  'session_token',
  'token',
  'wrapped_dek',
]);

/** Column types that are derived from exported content and rebuilt from it: embeddings, search vectors. */
const DERIVED_TYPES = new Set(['USER-DEFINED', 'tsvector']);

/** Rows read per page while exporting, so a large table is never held whole. */
const EXPORT_PAGE = 1000;

/**
 * JSON for one row: a bigint as its digits, everything else as JSON has it.
 * @param row - A row from the driver.
 */
function rowJson(row: Record<string, unknown>): string {
  return JSON.stringify(row, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
}

export type OffboardExport = {
  dir: string;
  files: Array<{ path: string; rows: number }>;
  artifacts: { written: number; unsupported: Array<{ id: number; kind: string; reason: string }> };
};

/**
 * Write the account's rows, members and artifacts under `dir`, and check every
 * table's file holds the rows the plan counted.
 * @param working - The plan and the scopes it was counted with.
 * @param dir - Where to write.
 */
async function writeExport(working: Working, dir: string): Promise<OffboardExport> {
  const { plan, scopes, catalog } = working;
  await mkdir(path.join(dir, 'tables'), { recursive: true });
  const files: OffboardExport['files'] = [];

  for (const entry of plan.tables) {
    const columns = catalog.tables.get(entry.table)!.filter(column => !DERIVED_TYPES.has(column.type));
    const select = sql.join(columns.map(column => (SECRET_COLUMNS.has(column.name)
      ? sql`case when ${qualified(entry.table, column.name)} is null then null else '[redacted]' end as ${ident(column.name)}`
      : qualified(entry.table, column.name))), sql`, `);
    const lines: string[] = [];
    for (let offset = 0; ; offset += EXPORT_PAGE) {
      const page = await rowsOf<Record<string, unknown>>(db, sql`
        select ${select} from ${ident(entry.table)} where ${scopes.get(entry.table)!.predicate}
        order by ctid limit ${EXPORT_PAGE} offset ${offset}
      `);
      lines.push(...page.map(rowJson));
      if (page.length < EXPORT_PAGE) {
        break;
      }
    }
    if (lines.length !== entry.rows) {
      throw new OffboardError(`${entry.table} held ${entry.rows} rows when counted and ${lines.length} when exported — the account is still being written to. Nothing was deleted; stop its activity and run again.`);
    }
    const file = path.join('tables', `${entry.table}.jsonl`);
    await writeFile(path.join(dir, file), lines.length > 0 ? `${lines.join('\n')}\n` : '');
    files.push({ path: file, rows: lines.length });
  }

  const members = await rowsOf<Record<string, unknown>>(db, sql`
    select u.id as user_id, u.email, u.name, m.role, m.created_at as joined_at
    from account_membership m join "user" u on u.id = m.user_id
    where m.account_id = ${plan.account.id} order by u.email
  `);
  await writeFile(path.join(dir, 'members.json'), `${JSON.stringify(members, null, 2)}\n`);
  files.push({ path: 'members.json', rows: members.length });

  const artifacts = { written: 0, unsupported: [] as OffboardExport['artifacts']['unsupported'] };
  const slugById = new Map(plan.workspaces.map(workspace => [workspace.id, workspace.slug]));
  if (slugById.size > 0) {
    const rows = await db.select().from(artifactSchema).where(inArray(artifactSchema.orgId, [...slugById.keys()]));
    for (const artifact of rows) {
      const page = exportArtifactAsPage(artifact);
      if (page.unsupported) {
        artifacts.unsupported.push({ id: artifact.id, kind: page.unsupported.kind, reason: page.unsupported.reason });
        continue;
      }
      const base = path.join('artifacts', slugById.get(artifact.orgId) ?? artifact.orgId, String(artifact.id));
      for (const out of page.files) {
        await mkdir(path.join(dir, base, path.dirname(out.path)), { recursive: true });
        await writeFile(path.join(dir, base, out.path), out.content);
        files.push({ path: path.join(base, out.path), rows: 1 });
      }
      artifacts.written += 1;
    }
  }
  return { dir, files, artifacts };
}

/* ------------------------------------------------------------------ */
/* The delete                                                          */
/* ------------------------------------------------------------------ */

/**
 * Delete every planned row in one transaction, children first, and refuse —
 * rolling everything back — if any table's count moved since the plan.
 *
 * Then sweep what the delete itself wrote. Some tables announce a deletion by
 * trigger (the live stream's `live_notice` rows, `migrations/0155`), and those
 * notices carry the account's workspace ids. Only rows THIS transaction
 * inserted are swept (`xmin` is its own id), so a row anyone else wrote is
 * never touched — it would show up in `remaining` instead.
 * @param working - The plan and its scopes.
 * @returns Rows deleted per table, and the side effects swept per table.
 */
async function deleteRows(working: Working): Promise<{ deleted: Map<string, number>; swept: Map<string, number> }> {
  const deleted = new Map<string, number>();
  const swept = new Map<string, number>();
  await db.transaction(async (tx) => {
    for (const entry of working.plan.tables) {
      const [row] = await rowsOf<{ n: number | string }>(tx, sql`
        with gone as (delete from ${ident(entry.table)} where ${working.scopes.get(entry.table)!.predicate} returning 1)
        select count(*)::int as n from gone
      `);
      const n = Number(row?.n ?? 0);
      if (n !== entry.rows) {
        throw new OffboardError(`${entry.table}: ${entry.rows} rows were exported but ${n} matched at delete — the account changed in between. Nothing was deleted; run again.`);
      }
      deleted.set(entry.table, n);
    }
    for (const [table, scope] of working.scopes) {
      const [row] = await rowsOf<{ n: number | string }>(tx, sql`
        with gone as (delete from ${ident(table)} where ${scope.predicate} and xmin = pg_current_xact_id()::xid returning 1)
        select count(*)::int as n from gone
      `);
      const n = Number(row?.n ?? 0);
      if (n > 0) {
        swept.set(table, n);
      }
    }
  });
  return { deleted, swept };
}

/* ------------------------------------------------------------------ */
/* The whole run                                                       */
/* ------------------------------------------------------------------ */

/** What lives outside this database and so is not removed here. Listed in every manifest. */
export const NOT_COVERED = [
  'Langfuse traces tagged org:<workspace id> — delete them in Langfuse.',
  'AgentCore Memory sessions and long-term records for the account\'s conversations.',
  'Objects in the client\'s own S3 buckets or other connected systems — they are the client\'s.',
  'Durable-workflow state kept outside the public schema.',
  'The KMS key itself, which is shared; the account\'s wrapped data keys are deleted above, which makes its stored ciphertexts unreadable.',
];

export type OffboardManifest = {
  kind: 'vocion.account-offboard';
  version: 1;
  mode: 'dry-run' | 'offboard';
  startedAt: string;
  finishedAt: string;
  plan: OffboardPlan;
  /** Absent on a dry run. */
  export?: OffboardExport;
  /** Rows deleted per table; absent on a dry run. */
  deleted?: Record<string, number>;
  /**
   * Rows the delete's own triggers wrote under the account's ids and the same
   * transaction removed — deletion notices for the live stream. Never exported:
   * they say only that something was deleted.
   */
  sideEffects?: Record<string, number>;
  /** Rows of the account's left after the delete, for every table it could have rows in — every value 0. */
  remaining?: Record<string, number>;
  notCovered: string[];
};

/**
 * Offboard an account: plan, export to `outDir`, delete, and write
 * `manifest.json` beside the export. A dry run plans and writes the manifest
 * only. Refuses — before anything is deleted — when rows outside the account
 * reference it, when the export does not match the plan, or when the delete
 * would not match the export.
 * @param opts - What to offboard and where the export goes.
 * @param opts.account - `tenant_account.id` or `.slug`.
 * @param opts.outDir - The export directory; created if missing.
 * @param opts.dryRun - Plan only.
 */
export async function offboardAccount(opts: { account: string; outDir: string; dryRun: boolean }): Promise<OffboardManifest> {
  const startedAt = new Date().toISOString();
  const working = await buildPlan(db, opts.account);
  await mkdir(opts.outDir, { recursive: true });
  const manifest: OffboardManifest = {
    kind: 'vocion.account-offboard',
    version: 1,
    mode: opts.dryRun ? 'dry-run' : 'offboard',
    startedAt,
    finishedAt: startedAt,
    plan: working.plan,
    notCovered: NOT_COVERED,
  };
  const save = async () => {
    manifest.finishedAt = new Date().toISOString();
    await writeFile(path.join(opts.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  };

  if (opts.dryRun) {
    await save();
    return manifest;
  }
  if (working.plan.crossReferences.length > 0) {
    await save();
    const named = working.plan.crossReferences.map(ref => `${ref.rows} in ${ref.table}.${ref.columns.join(',')} → ${ref.references}`).join('; ');
    throw new OffboardError(`Rows outside the account point into it (${named}). Nothing was exported or deleted; see manifest.json.`);
  }

  manifest.export = await writeExport(working, opts.outDir);
  const { deleted, swept } = await deleteRows(working);
  manifest.deleted = Object.fromEntries(deleted);
  manifest.sideEffects = Object.fromEntries(swept);

  const remaining: Record<string, number> = {};
  for (const [table, scope] of working.scopes) {
    const [row] = await rowsOf<{ n: number | string }>(db, sql`select count(*)::int as n from ${ident(table)} where ${scope.predicate}`);
    remaining[table] = Number(row?.n ?? 0);
  }
  manifest.remaining = remaining;
  await save();
  const left = Object.entries(remaining).filter(([, n]) => n > 0);
  if (left.length > 0) {
    throw new OffboardError(`Deleted, but rows of the account appeared afterwards: ${left.map(([table, n]) => `${n} in ${table}`).join(', ')}. Something is still writing to it; see manifest.json and run again.`);
  }
  return manifest;
}
