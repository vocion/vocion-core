/**
 * Offboarding a client account: export everything it owns, then delete it,
 * and leave a manifest of exactly what went.
 *
 * Driven by `src/scripts/account-offboard.ts`. The order is fixed — plan,
 * export, delete — and each step checks the one before it. The plan and the
 * export read one `REPEATABLE READ` snapshot, so the export holds exactly the
 * rows the plan counted. The delete is one transaction that first asks again
 * whether anything outside the account points into it, then must remove
 * exactly the exported rows, or nothing is deleted at all. The account's
 * files on the deployment's own storage are copied out with the export and
 * removed once the rows' transaction has committed.
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
 * members as `members.json`, every markdown or table artifact as the page
 * files `exportArtifactAsPage` already writes for a workspace
 * (`artifacts/<workspace>/<artifact id>/pages/…`), and every file the
 * deployment stores for the account's workspaces — the artifact store's
 * `<workspace id>-<hash>.<ext>` and the recordings under `<workspace id>/` on
 * disk or in `VOCION_MEDIA_BUCKET` — under `files/<store>/…`. Secrets are not exported —
 * a credential's ciphertext, a wrapped key, a password hash, an invite or
 * session token are written as `"[redacted]"` — and neither are derived
 * columns (embeddings, search vectors), which are rebuilt from the content
 * that IS exported.
 */

import type { SQL } from 'drizzle-orm';
import type { Dirent } from 'node:fs';
import { copyFile, mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { exportArtifactAsPage } from '@/libs/artifacts/exportPage';
import { db } from '@/libs/DB';
import { mediaBucket, mediaDir, mediaOrgPrefix } from '@/libs/tools/artifacts/media';
import { artifactFileOrgId, artifactsDir } from '@/libs/tools/artifacts/store';
import { artifactSchema } from '@/models/Schema';
import { isOperator } from '@/services/operator';

/** Anything that runs raw SQL: the database, or a transaction on it. */
type Executor = Pick<typeof db, 'execute'>;

/** A transaction on the database. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
/** A primary key's columns, each with its exact type (`format_type`), so a key read as text casts back exactly. */
type PrimaryKey = Array<{ name: string; type: string }>;
type Catalog = { tables: Map<string, Column[]>; foreignKeys: ForeignKey[]; primaryKeys: Map<string, PrimaryKey> };

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
  const primaryKeys = await rowsOf<{ tbl: string; cols: string[]; types: string[] }>(executor, sql`
    select
      (select relname from pg_class where oid = con.conrelid)::text as tbl,
      array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum, n)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.n)::text[] as cols,
      array(select format_type(a.atttypid, a.atttypmod) from unnest(con.conkey) with ordinality k(attnum, n)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.n)::text[] as types
    from pg_constraint con
    where con.contype = 'p' and con.connamespace = 'public'::regnamespace
  `);
  return {
    tables,
    primaryKeys: new Map(primaryKeys.map(pk => [pk.tbl, pk.cols.map((name, index) => ({ name, type: pk.types[index]! }))])),
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

/** Where an account's files live outside the database. */
export type OffboardFileStoreName = 'artifacts' | 'media' | 'media-bucket';

export type OffboardFileStore = {
  store: OffboardFileStoreName;
  /** The directory, or `s3://bucket/`, the files were found under. */
  location: string;
  files: number;
  bytes: number;
};

/** A Stripe subscription row the account carries, and whether it still bills. */
export type OffboardBilling = {
  table: string;
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  /** True while Stripe can still charge it: the offboard stops until it is cancelled. */
  live: boolean;
};

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
  /** Stripe subscriptions on the account's rows. A live one stops the offboard. */
  billing: OffboardBilling[];
  /** The account's files on this deployment's own storage, per store. */
  files: OffboardFileStore[];
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

/* ------------------------------------------------------------------ */
/* Files outside the database                                          */
/* ------------------------------------------------------------------ */

/**
 * Where this deployment keeps files, and how to reach the bucket. The
 * defaults are the app's own (`libs/tools/artifacts/store.ts`, `media.ts`);
 * tests pass their own directories and a fake bucket.
 */
export type OffboardStorage = {
  /** `VOCION_ARTIFACTS_DIR`: generated images, charts, rendered pages — `<orgId>-<hash>.<ext>`. */
  artifactsDir: string;
  /** Recordings on disk: `<media dir>/<org>/<record>/<file>`. */
  mediaDir: string;
  /** `VOCION_MEDIA_BUCKET`: recordings under `<org>/<record>/<file>`; null when none is set. */
  bucket: { bucket: string; region: string | undefined } | null;
  s3: {
    list: (opts: { bucket: string; prefix: string; region?: string }) => Promise<Array<{ key: string; size: number }>>;
    get: (opts: { bucket: string; key: string; region?: string }) => Promise<Uint8Array>;
    remove: (opts: { bucket: string; keys: readonly string[]; region?: string }) => Promise<void>;
  };
};

/** The app's own storage, as it is configured now. */
function defaultStorage(): OffboardStorage {
  return {
    artifactsDir: artifactsDir(),
    mediaDir: mediaDir(),
    bucket: mediaBucket(),
    s3: {
      list: async opts => (await import('@/libs/aws/s3')).listKeys(opts),
      get: async opts => new Uint8Array((await (await import('@/libs/aws/s3')).getObjectBytes(opts)).bytes),
      remove: async opts => (await import('@/libs/aws/s3')).deleteObjects(opts),
    },
  };
}

/** One of the account's files: which store, where it is, and where its copy goes in the export. */
type StoredFile = { store: OffboardFileStoreName; ref: string; rel: string; bytes: number };

/**
 * Every file under a directory, recursively; nothing when it does not exist.
 * @param dir - The directory.
 */
async function walk(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * The account's files in every store, keyed by its workspace ids — the ids
 * every store names its files by. The artifacts directory is matched on the
 * exact org a file name carries (`artifactFileOrgId`), never on a prefix, so
 * one workspace never claims another's whose id begins the same way.
 * @param storage - Where to look.
 * @param projectIds - The account's workspaces.
 */
async function findFiles(storage: OffboardStorage, projectIds: readonly string[]): Promise<StoredFile[]> {
  const ids = new Set(projectIds);
  const files: StoredFile[] = [];

  let names: Dirent[] = [];
  try {
    names = await readdir(storage.artifactsDir, { withFileTypes: true });
  } catch { /* no directory: nothing stored */ }
  for (const entry of names) {
    const org = entry.isFile() ? artifactFileOrgId(entry.name) : null;
    if (org !== null && ids.has(org)) {
      const abs = path.join(storage.artifactsDir, entry.name);
      files.push({ store: 'artifacts', ref: abs, rel: entry.name, bytes: (await stat(abs)).size });
    }
  }

  for (const id of projectIds) {
    const prefix = mediaOrgPrefix(id);
    for (const abs of await walk(path.join(storage.mediaDir, prefix))) {
      files.push({ store: 'media', ref: abs, rel: path.relative(storage.mediaDir, abs), bytes: (await stat(abs)).size });
    }
    if (storage.bucket) {
      for (const object of await storage.s3.list({ bucket: storage.bucket.bucket, prefix, region: storage.bucket.region })) {
        files.push({ store: 'media-bucket', ref: object.key, rel: object.key, bytes: object.size });
      }
    }
  }
  return files;
}

/**
 * Files found, per store, for the plan.
 * @param storage - Where they were looked for.
 * @param files - What was found.
 */
function fileStores(storage: OffboardStorage, files: readonly StoredFile[]): OffboardFileStore[] {
  const location: Record<OffboardFileStoreName, string> = {
    'artifacts': storage.artifactsDir,
    'media': storage.mediaDir,
    'media-bucket': storage.bucket ? `s3://${storage.bucket.bucket}/` : '',
  };
  const stores: OffboardFileStoreName[] = storage.bucket ? ['artifacts', 'media', 'media-bucket'] : ['artifacts', 'media'];
  return stores.map((store) => {
    const mine = files.filter(file => file.store === store);
    return { store, location: location[store], files: mine.length, bytes: mine.reduce((sum, file) => sum + file.bytes, 0) };
  });
}

/**
 * Copy every file into `<dir>/files/<store>/…`.
 * @param storage - Where they are.
 * @param files - Which.
 * @param dir - The export directory.
 * @returns How many were copied.
 */
async function exportFiles(storage: OffboardStorage, files: readonly StoredFile[], dir: string): Promise<number> {
  for (const file of files) {
    const target = path.join(dir, 'files', file.store, file.rel);
    await mkdir(path.dirname(target), { recursive: true });
    if (file.store === 'media-bucket') {
      await writeFile(target, await storage.s3.get({ bucket: storage.bucket!.bucket, key: file.ref, region: storage.bucket!.region }));
    } else {
      await copyFile(file.ref, target);
    }
  }
  return files.length;
}

/**
 * Remove the account's files once its rows are gone, and the per-workspace
 * media directories they leave empty.
 * @param storage - Where they are.
 * @param files - Which.
 * @param projectIds - The account's workspaces.
 * @returns How many were removed.
 */
async function deleteFiles(storage: OffboardStorage, files: readonly StoredFile[], projectIds: readonly string[]): Promise<number> {
  const keys = files.filter(file => file.store === 'media-bucket').map(file => file.ref);
  if (keys.length > 0) {
    await storage.s3.remove({ bucket: storage.bucket!.bucket, keys, region: storage.bucket!.region });
  }
  for (const file of files.filter(file => file.store !== 'media-bucket')) {
    await rm(file.ref, { force: true });
  }
  for (const id of projectIds) {
    await rm(path.join(storage.mediaDir, mediaOrgPrefix(id)), { recursive: true, force: true });
  }
  return files.length;
}

/* ------------------------------------------------------------------ */
/* Reading the plan                                                    */
/* ------------------------------------------------------------------ */

type Working = { plan: OffboardPlan; scopes: Map<string, Scope>; catalog: Catalog; files: StoredFile[] };

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
 * Rows outside the account that point at a row this offboard deletes. Asked
 * at plan time, and again inside the delete's own transaction — a reference
 * made in between would otherwise be cascaded into or nulled out unreported.
 * @param executor - The database or a transaction.
 * @param catalog - The schema.
 * @param scopes - Which rows of which table are the account's.
 * @param deleting - Whether rows of a table are being deleted.
 */
async function findCrossReferences(executor: Executor, catalog: Catalog, scopes: Map<string, Scope>, deleting: (table: string) => boolean): Promise<OffboardPlan['crossReferences']> {
  const crossReferences: OffboardPlan['crossReferences'] = [];
  for (const fk of catalog.foreignKeys) {
    const parentScope = scopes.get(fk.parent);
    // References to people are settled in `resolveUsers`, which keeps the person instead.
    if (!parentScope || fk.parent === USERS_TABLE || !deleting(fk.parent)) {
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
  return crossReferences;
}

/** Stripe statuses after which a subscription can never charge again. */
const ENDED_SUBSCRIPTION = new Set(['canceled', 'incomplete_expired']);

/**
 * The Stripe subscriptions the account's rows carry: the account's own, and
 * the legacy `organization` billing row of each workspace. Deleting the row
 * does not cancel the subscription, so a live one stops the offboard.
 * @param executor - The database.
 * @param accountId - The account.
 * @param projectIds - Its workspaces.
 */
async function readBilling(executor: Executor, accountId: string, projectIds: string[]): Promise<OffboardBilling[]> {
  const rows = await rowsOf<{ tbl: string; id: string; customer_id: string | null; subscription_id: string | null; status: string | null }>(executor, sql`
    select 'tenant_account' as tbl, id, stripe_customer_id as customer_id, stripe_subscription_id as subscription_id, stripe_subscription_status as status
    from tenant_account where id = ${accountId}
    union all
    select 'organization', id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status
    from organization where ${inValues(sql`id`, projectIds)}
  `);
  return rows
    .filter(row => row.customer_id !== null || row.subscription_id !== null)
    .map(row => ({
      table: row.tbl,
      id: row.id,
      customerId: row.customer_id,
      subscriptionId: row.subscription_id,
      status: row.status,
      // A subscription with no status recorded is treated as live: nothing
      // here can tell it has stopped billing.
      live: row.subscription_id !== null && !ENDED_SUBSCRIPTION.has(row.status ?? ''),
    }));
}

/**
 * Count everything that would go, and everything that stops it going.
 * @param executor - The database, or the export's snapshot.
 * @param selector - The account's id or slug.
 * @param storage - Where the deployment keeps files.
 */
async function buildPlan(executor: Executor, selector: string, storage: OffboardStorage): Promise<Working> {
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

  const crossReferences = await findCrossReferences(executor, catalog, scopes, table => (counts.get(table) ?? 0) > 0);
  const files = await findFiles(storage, projectIds);

  const withRows = [...scopes.keys()].filter(table => (counts.get(table) ?? 0) > 0);
  const order = deleteOrder(withRows, catalog.foreignKeys);
  const plan: OffboardPlan = {
    account,
    workspaces,
    tables: order.map(table => ({ table, scope: scopes.get(table)!.kind, via: scopes.get(table)!.via, rows: counts.get(table)! })),
    users,
    crossReferences,
    billing: await readBilling(executor, account.id, projectIds),
    files: fileStores(storage, files),
    untouched: [...catalog.tables.keys()].filter(table => !withRows.includes(table)).sort(),
  };
  return { plan, scopes, catalog, files };
}

/**
 * The snapshot a plan and its export are read in: one `REPEATABLE READ READ
 * ONLY` transaction, so every count, every exported page and every file list
 * describe the same instant, whatever is written meanwhile.
 * @param fn - What to read.
 */
async function inSnapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async tx => fn(tx), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/**
 * What offboarding an account would remove, changing nothing.
 * @param selector - The account's id or slug.
 * @param storage - Where the deployment keeps files; the app's own by default.
 */
export async function planOffboard(selector: string, storage: Partial<OffboardStorage> = {}): Promise<OffboardPlan> {
  return (await inSnapshot(executor => buildPlan(executor, selector, { ...defaultStorage(), ...storage }))).plan;
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

/** Rows read per page while exporting; each page is appended to the file and let go. */
const EXPORT_PAGE = 1000;

/** The alias a page's key columns are read under, so a redacted key column still pages. */
const KEY_ALIAS_PREFIX = '__offboard_key_';
const keyAlias = (index: number) => `${KEY_ALIAS_PREFIX}${index}`;

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
 * One table's rows of the account's into a JSON Lines file, a page at a time.
 *
 * Pages follow the primary key (keyset: each page starts after the last key
 * of the one before), read as text and cast back to the key's own type so the
 * comparison is exact. A table with no primary key pages by offset in
 * physical order. Both are stable because every page reads the same snapshot.
 * @param executor - The export's snapshot.
 * @param working - The plan.
 * @param table - The table.
 * @param file - Where to write it.
 * @returns How many rows were written.
 */
async function exportTable(executor: Executor, working: Working, table: string, file: string): Promise<number> {
  const columns = working.catalog.tables.get(table)!.filter(column => !DERIVED_TYPES.has(column.type));
  const select = sql.join(columns.map(column => (SECRET_COLUMNS.has(column.name)
    ? sql`case when ${qualified(table, column.name)} is null then null else '[redacted]' end as ${ident(column.name)}`
    : qualified(table, column.name))), sql`, `);
  const predicate = working.scopes.get(table)!.predicate;
  const key = working.catalog.primaryKeys.get(table) ?? [];
  const handle = await open(file, 'w');
  let written = 0;
  try {
    let after: string[] | null = null;
    for (let offset = 0; ; offset += EXPORT_PAGE) {
      let page: Array<Record<string, unknown>>;
      if (key.length > 0) {
        const keyColumns = sql.join(key.map(part => qualified(table, part.name)), sql`, `);
        const keyText = sql.join(key.map((part, index) => sql`${qualified(table, part.name)}::text as ${ident(keyAlias(index))}`), sql`, `);
        const cursor = after
          ? sql` and (${keyColumns}) > (${sql.join(after.map((value, index) => sql`${value}::${sql.raw(key[index]!.type)}`), sql`, `)})`
          : sql``;
        page = await rowsOf<Record<string, unknown>>(executor, sql`
          select ${select}, ${keyText} from ${ident(table)} where ${predicate}${cursor}
          order by ${keyColumns} limit ${EXPORT_PAGE}
        `);
        const last = page.at(-1);
        after = last ? key.map((_, index) => String(last[keyAlias(index)])) : after;
        page = page.map(row => Object.fromEntries(Object.entries(row).filter(([name]) => !name.startsWith(KEY_ALIAS_PREFIX))));
      } else {
        page = await rowsOf<Record<string, unknown>>(executor, sql`
          select ${select} from ${ident(table)} where ${predicate}
          order by ctid limit ${EXPORT_PAGE} offset ${offset}
        `);
      }
      if (page.length > 0) {
        await handle.write(`${page.map(rowJson).join('\n')}\n`);
        written += page.length;
      }
      if (page.length < EXPORT_PAGE) {
        break;
      }
    }
  } finally {
    await handle.close();
  }
  return written;
}

/**
 * Write the account's rows, members and artifacts under `dir`, read from the
 * same snapshot the plan was counted in, and check every table's file holds
 * the rows the plan counted.
 * @param executor - The plan's snapshot.
 * @param working - The plan and the scopes it was counted with.
 * @param dir - Where to write.
 */
async function writeExport(executor: Tx, working: Working, dir: string): Promise<OffboardExport> {
  const { plan } = working;
  await mkdir(path.join(dir, 'tables'), { recursive: true });
  const files: OffboardExport['files'] = [];

  for (const entry of plan.tables) {
    const file = path.join('tables', `${entry.table}.jsonl`);
    const rows = await exportTable(executor, working, entry.table, path.join(dir, file));
    if (rows !== entry.rows) {
      throw new OffboardError(`${entry.table} held ${entry.rows} rows when counted and ${rows} when exported from the same snapshot. Nothing was deleted; report this.`);
    }
    files.push({ path: file, rows });
  }

  const members = await rowsOf<Record<string, unknown>>(executor, sql`
    select u.id as user_id, u.email, u.name, m.role, m.created_at as joined_at
    from account_membership m join "user" u on u.id = m.user_id
    where m.account_id = ${plan.account.id} order by u.email
  `);
  await writeFile(path.join(dir, 'members.json'), `${JSON.stringify(members, null, 2)}\n`);
  files.push({ path: 'members.json', rows: members.length });

  const artifacts = { written: 0, unsupported: [] as OffboardExport['artifacts']['unsupported'] };
  const slugById = new Map(plan.workspaces.map(workspace => [workspace.id, workspace.slug]));
  if (slugById.size > 0) {
    const rows = await executor.select().from(artifactSchema).where(inArray(artifactSchema.orgId, [...slugById.keys()]));
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
 * The SQLSTATE a database error carries, on the error or the driver error
 * drizzle wraps in it.
 * @param error - Whatever was thrown.
 */
function sqlStateOf(error: unknown): string | undefined {
  for (let current: unknown = error; current && typeof current === 'object'; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

/** Raised from inside the delete when rows outside the account came to point into it after the plan. */
class LateCrossReferenceError extends OffboardError {
  constructor(readonly references: OffboardPlan['crossReferences']) {
    super(`Rows outside the account came to point into it after the plan (${references.map(ref => `${ref.rows} in ${ref.table}.${ref.columns.join(',')} → ${ref.references}`).join('; ')}). Nothing was deleted; see manifest.json.`);
  }
}

/**
 * Delete every planned row in one `REPEATABLE READ` transaction, children
 * first, and refuse — rolling everything back — if anything moved since the
 * export.
 *
 * It starts by locking the account row, then asks again whether any row
 * outside the account points into it: the plan's answer is from before the
 * export, and a reference made since would be cascaded into or nulled out
 * with nobody told. Any table whose count moved stops it too. Past that
 * point, a row another session changes or a reference it adds makes Postgres
 * refuse the transaction (a serialization failure), which is reported the
 * same way: nothing deleted, run again.
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
  const planned = new Set(working.plan.tables.map(entry => entry.table));
  try {
    await db.transaction(async (tx) => {
      const [locked] = await rowsOf<{ id: string }>(tx, sql`select id from tenant_account where id = ${working.plan.account.id} for update`);
      if (!locked) {
        throw new OffboardError(`The account ${working.plan.account.id} was deleted by something else after the plan. Nothing was deleted here.`);
      }
      const late = await findCrossReferences(tx, working.catalog, working.scopes, table => planned.has(table));
      if (late.length > 0) {
        throw new LateCrossReferenceError(late);
      }
      for (const entry of working.plan.tables) {
        const [row] = await rowsOf<{ n: number | string }>(tx, sql`
          with gone as (delete from ${ident(entry.table)} where ${working.scopes.get(entry.table)!.predicate} returning 1)
          select count(*)::int as n from gone
        `);
        const n = Number(row?.n ?? 0);
        if (n !== entry.rows) {
          throw new OffboardError(`${entry.table}: ${entry.rows} rows were exported but ${n} matched at delete — the account changed in between. Nothing was deleted; stop its activity and run again.`);
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
    }, { isolationLevel: 'repeatable read' });
  } catch (error) {
    if (sqlStateOf(error) === '40001') {
      throw new OffboardError('The account changed while it was being deleted, so Postgres refused the transaction. Nothing was deleted; stop its activity and run again.');
    }
    throw error;
  }
  return { deleted, swept };
}

/* ------------------------------------------------------------------ */
/* The whole run                                                       */
/* ------------------------------------------------------------------ */

/** What lives outside this database and this deployment's own storage, and so is not removed here. Listed in every manifest. */
export const NOT_COVERED = [
  'Langfuse traces tagged org:<workspace id> — delete them in Langfuse.',
  'AgentCore Memory sessions and long-term records for the account\'s conversations.',
  'Objects in the client\'s own S3 buckets or other connected systems — they are the client\'s.',
  'Durable-workflow state kept outside the public schema.',
  'The KMS key itself, which is shared; the account\'s wrapped data keys are deleted above, which makes its stored ciphertexts unreadable.',
  'Earlier versions in a versioned media bucket, and any backup or CDN copy of the artifacts directory or the bucket: deleting writes delete markers and removes the live files only.',
  'The Stripe customer record. A live subscription stops the offboard until it is cancelled in Stripe; the customer itself stays there until deleted in Stripe.',
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
  /**
   * The account's files on this deployment's storage (`plan.files` says where
   * and how many): copied into `files/` before the delete, removed after the
   * rows are, and looked for again afterwards — `remaining` is 0. Absent on a
   * dry run.
   */
  files?: { exported: number; deleted: number; remaining: number };
  notCovered: string[];
};

/** Seams for tests: where files are kept, and a moment between the export and the delete. */
export type OffboardDeps = {
  storage?: Partial<OffboardStorage>;
  /** Runs after the export is written and before the delete starts. */
  beforeDelete?: () => Promise<void>;
};

/**
 * Offboard an account: plan, export to `outDir`, delete, and write
 * `manifest.json` beside the export. A dry run plans and writes the manifest
 * only. Refuses — before anything is deleted — when rows outside the account
 * reference it (at plan time or at delete time), when one of its Stripe
 * subscriptions is still live, when the export does not match the plan, or
 * when the delete would not match the export.
 *
 * The plan and the export are read from one snapshot; the account's files are
 * copied out after it, and removed only once the rows' transaction commits.
 * @param opts - What to offboard and where the export goes.
 * @param opts.account - `tenant_account.id` or `.slug`.
 * @param opts.outDir - The export directory; created if missing.
 * @param opts.dryRun - Plan only.
 * @param deps - Seams for tests.
 */
export async function offboardAccount(opts: { account: string; outDir: string; dryRun: boolean }, deps: OffboardDeps = {}): Promise<OffboardManifest> {
  const startedAt = new Date().toISOString();
  const storage = { ...defaultStorage(), ...deps.storage };
  await mkdir(opts.outDir, { recursive: true });

  const { working, exported } = await inSnapshot(async (executor) => {
    const plan = await buildPlan(executor, opts.account, storage);
    const stops = opts.dryRun || plan.plan.crossReferences.length > 0 || plan.plan.billing.some(entry => entry.live);
    return { working: plan, exported: stops ? undefined : await writeExport(executor, plan, opts.outDir) };
  });

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
  const live = working.plan.billing.filter(entry => entry.live);
  if (live.length > 0) {
    await save();
    const named = live.map(entry => `${entry.subscriptionId} (${entry.status ?? 'no status recorded'}) on ${entry.table} ${entry.id}`).join('; ');
    throw new OffboardError(`The account still has a live Stripe subscription: ${named}. Deleting its rows would not stop Stripe charging the client. Cancel it in Stripe, then run again. Nothing was exported or deleted.`);
  }

  manifest.export = exported!;
  const filesExported = await exportFiles(storage, working.files, opts.outDir);
  await deps.beforeDelete?.();

  let result: Awaited<ReturnType<typeof deleteRows>>;
  try {
    result = await deleteRows(working);
  } catch (error) {
    if (error instanceof LateCrossReferenceError) {
      manifest.plan.crossReferences = error.references;
    }
    await save();
    throw error;
  }
  manifest.deleted = Object.fromEntries(result.deleted);
  manifest.sideEffects = Object.fromEntries(result.swept);

  const remaining: Record<string, number> = {};
  for (const [table, scope] of working.scopes) {
    const [row] = await rowsOf<{ n: number | string }>(db, sql`select count(*)::int as n from ${ident(table)} where ${scope.predicate}`);
    remaining[table] = Number(row?.n ?? 0);
  }
  manifest.remaining = remaining;

  // The rows are gone; now the files. A store that refuses leaves the run
  // reporting exactly what is left, with the copies already in the export.
  const projectIds = working.plan.workspaces.map(workspace => workspace.id);
  let filesDeleted = 0;
  let fileError: unknown;
  try {
    filesDeleted = await deleteFiles(storage, working.files, projectIds);
  } catch (error) {
    fileError = error;
  }
  const filesLeft = await findFiles(storage, projectIds);
  manifest.files = { exported: filesExported, deleted: fileError ? 0 : filesDeleted, remaining: filesLeft.length };
  await save();

  if (fileError || filesLeft.length > 0) {
    const where = fileStores(storage, filesLeft).filter(store => store.files > 0).map(store => `${store.files} in ${store.location}`).join(', ');
    throw new OffboardError(`The account's rows are deleted, but ${filesLeft.length} of its files are still stored (${where})${fileError instanceof Error ? `: ${fileError.message}` : ''}. Their copies are in ${path.join(opts.outDir, 'files')}; remove the originals by hand. See manifest.json.`);
  }
  const left = Object.entries(remaining).filter(([, n]) => n > 0);
  if (left.length > 0) {
    throw new OffboardError(`Deleted, but rows of the account appeared afterwards: ${left.map(([table, n]) => `${n} in ${table}`).join(', ')}. Something is still writing to it; see manifest.json and run again.`);
  }
  return manifest;
}
