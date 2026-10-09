import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '@/libs/testing/migratedDatabaseSnapshot';

/**
 * MIGRATION 0022 CANNOT MINT A GHOST WORKSPACE (2026-10-09).
 *
 * 0022 backfilled one project per distinct `org_id`, as `proj-<org_id>`. Run
 * on a database whose `org_id` already held workspace ids, it created
 * `proj-proj-<id>` — "Project proj-<id>" in the picker — and pointed that
 * workspace's content at it. This builds the schema 0022 ran on (0000–0021),
 * puts content on a real workspace id and on a legacy org id, then runs 0022
 * twice: the workspace gets no project of its own, the legacy org still gets
 * one, and a second run changes nothing.
 */

const TARGET = '0022_backfill_default_project';
let dir: string;
let pg: PGlite;
let statements: string[];

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(text, params)).rows;
}

async function run0022(): Promise<void> {
  for (const statement of statements) {
    await pg.exec(statement);
  }
}

beforeAll(async () => {
  // A migrations folder holding everything BEFORE 0022, so the database is
  // the one 0022 was written against.
  dir = await mkdtemp(path.join(tmpdir(), 'mig0022-'));
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
  const cut = journal.entries.findIndex(e => e.tag === TARGET);
  const before = journal.entries.slice(0, cut);
  await mkdir(path.join(dir, 'meta'));
  await writeFile(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));
  for (const e of before) {
    await copyFile(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  }
  pg = new PGlite({ extensions: { vector } });
  await migrate(drizzle(pg), { migrationsFolder: dir });
  statements = (await readFile(path.join(MIGRATIONS_FOLDER, `${TARGET}.sql`), 'utf8')).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

  // A real workspace, and content that names it by id (the shape every
  // database has had since workspaces existed)...
  await q(`insert into tenant_account (id, name, slug) values ('acct-northwind', 'Northwind', 'northwind')`);
  await q(`insert into project (id, account_id, slug, name) values ('proj-northwind-5f3a9c', 'acct-northwind', 'northwind', 'Northwind')`);
  await q(`insert into agent (org_id, slug, name, system_prompt) values ('proj-northwind-5f3a9c', 'workspace-lead', 'Lead', 'fixture')`);
  await q(`insert into playbook (org_id, slug, name, description, content_sha) values ('proj-northwind-5f3a9c', 'setup', 'Setup', 'fixture', 'sha')`);
  // ...and content on a legacy org id, the case 0022 was written for.
  await q(`insert into agent (org_id, slug, name, system_prompt) values ('org_legacy_kestrel', 'workspace-lead', 'Lead', 'fixture')`);
});

afterAll(async () => {
  await pg?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('migration 0022', () => {
  it('backfills legacy orgs and leaves a workspace id alone', async () => {
    await run0022();

    const projects = await q<{ id: string }>(`select id from project order by id`);

    expect(projects.map(p => p.id)).toEqual(['proj-northwind-5f3a9c', 'proj-org_legacy_kestrel']);

    const agents = await q<{ org_id: string; project_id: string }>(`select org_id, project_id from agent order by org_id`);

    expect(agents).toEqual([
      { org_id: 'org_legacy_kestrel', project_id: 'proj-org_legacy_kestrel' },
      { org_id: 'proj-northwind-5f3a9c', project_id: 'proj-northwind-5f3a9c' },
    ]);
  });

  it('a second run, after new content arrives, mints nothing', async () => {
    await q(`insert into conversation (org_id, agent_slug, title) values ('proj-northwind-5f3a9c', 'workspace-lead', 'later')`);
    await run0022();

    const ghosts = await q(`select id from project where id like 'proj-proj-%' or name like 'Project proj-%'`);

    expect(ghosts).toEqual([]);

    const [conv] = await q<{ project_id: string }>(`select project_id from conversation`);

    expect(conv!.project_id).toBe('proj-northwind-5f3a9c');
  });
});
