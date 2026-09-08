/**
 * The migration convention check (issue #193).
 *
 * The rule being pinned: a `CREATE INDEX` against a table the same migration
 * did not create blocks writes to that table for the length of the build, so it
 * has to move to `migrations/concurrent/` and say `CONCURRENTLY`. The inverse
 * matters just as much — a concurrent build inside a numbered migration is
 * rejected by drizzle's per-file transaction and cannot run on PGlite at all,
 * so dev and the whole unit suite would break on it.
 *
 * Every case here works on SQL strings or on a scratch directory; nothing
 * touches a database.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  blankSqlComments,
  CONCURRENT_SUBDIR,
  findCreatedTables,
  findIndexBuildingConstraints,
  findIndexBuilds,
  findMigrationSafetyProblems,
  findStatements,
  FIRST_ENFORCED_MIGRATION_NUMBER,
  formatProblems,
  lineNumberAt,
  migrationNumberOf,
  MIGRATIONS_RELATIVE_DIR,
  readMigrationFiles,
  runCheck,
} from './check-migration-safety';

/** A migration number the rule applies to. */
const ENFORCED = String(FIRST_ENFORCED_MIGRATION_NUMBER).padStart(4, '0');

/** A migration number old enough to be exempt. */
const GRANDFATHERED = String(FIRST_ENFORCED_MIGRATION_NUMBER - 1).padStart(4, '0');

/**
 * Build a scratch migrations directory on disk.
 * @param regular - Filename to contents, for the numbered migrations.
 * @param concurrent - Filename to contents, for `concurrent/`.
 */
function writeMigrationsDirectory(
  regular: Record<string, string>,
  concurrent: Record<string, string> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'migration-check-'));
  for (const [name, sql] of Object.entries(regular)) {
    writeFileSync(join(root, name), sql, 'utf-8');
  }
  if (Object.keys(concurrent).length > 0) {
    mkdirSync(join(root, CONCURRENT_SUBDIR));
    for (const [name, sql] of Object.entries(concurrent)) {
      writeFileSync(join(root, CONCURRENT_SUBDIR, name), sql, 'utf-8');
    }
  }
  return root;
}

describe('blankSqlComments', () => {
  it('blanks a line comment but keeps the offsets and the newline', () => {
    const blanked = blankSqlComments('-- note\nSELECT 1;');

    expect(blanked).toBe('       \nSELECT 1;');
  });

  it('blanks a block comment across lines', () => {
    const blanked = blankSqlComments('/* one\ntwo */SELECT 1;');

    expect(blanked).toBe('      \n      SELECT 1;');
  });

  it('blanks an unterminated block comment to the end of the file', () => {
    const blanked = blankSqlComments('SELECT 1; /* trailing');

    expect(blanked).toBe('SELECT 1;            ');
  });

  it('leaves a double dash inside a string literal alone', () => {
    const sql = 'INSERT INTO t VALUES (\'a -- b\');';

    expect(blankSqlComments(sql)).toBe(sql);
  });

  it('leaves a double dash inside a quoted identifier alone', () => {
    const sql = 'CREATE INDEX ON "od--d" (id);';

    expect(blankSqlComments(sql)).toBe(sql);
  });

  it('leaves a double dash inside a dollar-quoted body alone', () => {
    const sql = 'DO $$ BEGIN RAISE NOTICE \'a -- b\'; END $$;';

    expect(blankSqlComments(sql)).toBe(sql);
  });

  it('leaves a block comment marker inside a tagged dollar quote alone', () => {
    const sql = 'DO $body$ BEGIN RAISE NOTICE \'/* not a comment\'; END $body$;';

    expect(blankSqlComments(sql)).toBe(sql);
  });

  it('still blanks a comment after a dollar-quoted body closes', () => {
    const blanked = blankSqlComments('DO $$ BEGIN END $$; -- done');

    expect(blanked).toBe('DO $$ BEGIN END $$;        ');
  });

  it('treats a lone dollar sign as ordinary text', () => {
    const blanked = blankSqlComments('SELECT col$x FROM t; -- note');

    expect(blanked).toBe('SELECT col$x FROM t;        ');
  });

  it('treats drizzle statement breakpoints as comments', () => {
    const blanked = blankSqlComments('SELECT 1;--> statement-breakpoint\nSELECT 2;');

    expect(blanked).not.toContain('statement-breakpoint');
    expect(findStatements(blanked).map(statement => statement.text)).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('lineNumberAt', () => {
  it('counts newlines before the offset', () => {
    expect(lineNumberAt('a\nb\nc', 4)).toBe(3);
  });

  it('clamps an offset past the end of the text', () => {
    expect(lineNumberAt('a\nb', 999)).toBe(2);
  });
});

describe('findCreatedTables', () => {
  it('finds quoted, unquoted, schema-qualified and unlogged tables', () => {
    const created = findCreatedTables(`
      CREATE TABLE IF NOT EXISTS "conversation" (id text);
      CREATE TABLE plain_table (id text);
      CREATE UNLOGGED TABLE public."Scratch" (id text);
    `);

    expect([...created].sort()).toEqual(['conversation', 'plain_table', 'scratch']);
  });
});

describe('findIndexBuilds', () => {
  it('reads the target table off every index form', () => {
    const builds = findIndexBuilds(`
      CREATE INDEX IF NOT EXISTS "a_idx" ON "thing" USING btree ("id");
      CREATE UNIQUE INDEX b_idx ON ONLY public.other (id);
      CREATE INDEX CONCURRENTLY c_idx ON third (id);
      CREATE INDEX ON fourth (id);
    `);

    expect(builds.map(build => build.table)).toEqual(['thing', 'other', 'third', 'fourth']);
    expect(builds.map(build => build.isConcurrent)).toEqual([false, false, true, false]);
    expect(builds.map(build => build.isUnique)).toEqual([false, true, false, false]);
    expect(builds.map(build => build.isIfNotExists)).toEqual([true, false, false, false]);
  });
});

describe('findIndexBuildingConstraints', () => {
  it('finds UNIQUE and PRIMARY KEY additions, named or anonymous', () => {
    const constraints = findIndexBuildingConstraints(`
      ALTER TABLE "thing" ADD CONSTRAINT "thing_slug_key" UNIQUE ("slug");
      ALTER TABLE ONLY public.other ADD PRIMARY KEY (id);
    `);

    expect(constraints.map(constraint => [constraint.table, constraint.keyword])).toEqual([
      ['thing', 'UNIQUE'],
      ['other', 'PRIMARY KEY'],
    ]);
  });

  it('ignores a foreign key, which builds no index', () => {
    const constraints = findIndexBuildingConstraints(
      'ALTER TABLE "thing" ADD CONSTRAINT "thing_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id");',
    );

    expect(constraints).toEqual([]);
  });

  it('attributes the constraint to its own statement, not an earlier ALTER', () => {
    const constraints = findIndexBuildingConstraints(
      'ALTER TABLE "first" ADD COLUMN "x" text;\nALTER TABLE "second" ADD CONSTRAINT "s_key" UNIQUE ("x");',
    );

    expect(constraints.map(constraint => constraint.table)).toEqual(['second']);
  });
});

describe('findStatements', () => {
  it('drops blank chunks and reports the offset of real content', () => {
    const statements = findStatements('  SELECT 1;\n\n  SELECT 2;  ;');

    expect(statements.map(statement => statement.text)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(statements[0]!.offset).toBe(2);
  });
});

describe('migrationNumberOf', () => {
  it('reads the leading digits of a migration filename', () => {
    expect(migrationNumberOf('packages/core/migrations/0073_x.sql')).toBe(73);
  });

  it('returns null when the name does not start with digits', () => {
    expect(migrationNumberOf('adhoc.sql')).toBeNull();
  });
});

describe('findMigrationSafetyProblems — numbered migrations', () => {
  it('accepts an index on a table the same migration creates', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_new_table.sql`,
      sql: 'CREATE TABLE "anchored_comment" (id text);\nCREATE INDEX IF NOT EXISTS "ac_idx" ON "anchored_comment" ("id");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toEqual([]);
  });

  it('rejects an index on a pre-existing table, pointing at the concurrent directory', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_scope.sql`,
      sql: 'ALTER TABLE "conversation" ADD COLUMN "scope_ref" text;\nCREATE INDEX IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]!.rule).toBe('blocking-index');
    expect(problems[0]!.line).toBe(2);
    expect(problems[0]!.message).toContain(`${CONCURRENT_SUBDIR}/${ENFORCED}_<name>.sql`);
  });

  it('exempts migrations written before the rule landed', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${GRANDFATHERED}_older.sql`,
      sql: 'CREATE INDEX IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toEqual([]);
  });

  it('enforces the rule on a file with no migration number', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/hand_written.sql`,
      sql: 'CREATE INDEX "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain(`${CONCURRENT_SUBDIR}/NNNN_<name>.sql`);
  });

  it('rejects a concurrent build inside a numbered migration', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_scope.sql`,
      sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]!.rule).toBe('concurrent-build-in-transactional-migration');
    expect(problems[0]!.message).toContain('PGlite');
  });

  it('names the concurrent target generically when the file has no number', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/hand_written.sql`,
      sql: 'CREATE INDEX CONCURRENTLY "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: false,
    }]);

    expect(problems[0]!.message).toContain(`${CONCURRENT_SUBDIR}/NNNN_<name>.sql`);
  });

  it('rejects a UNIQUE constraint added to a pre-existing table', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_unique.sql`,
      sql: 'ALTER TABLE "conversation" ADD CONSTRAINT "conversation_slug_key" UNIQUE ("slug");',
      isConcurrentBuild: false,
    }]);

    expect(problems.map(problem => problem.rule)).toEqual(['blocking-constraint']);
    expect(problems[0]!.message).toContain('ADD UNIQUE');
    expect(problems[0]!.message).toContain('expand-and-contract');
  });

  it('accepts a PRIMARY KEY on a table the same migration creates', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_new.sql`,
      sql: 'CREATE TABLE "fresh" (id text);\nALTER TABLE "fresh" ADD PRIMARY KEY ("id");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toEqual([]);
  });

  it('exempts a constraint in a migration written before the rule landed', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${GRANDFATHERED}_unique.sql`,
      sql: 'ALTER TABLE "conversation" ADD CONSTRAINT "conversation_slug_key" UNIQUE ("slug");',
      isConcurrentBuild: false,
    }]);

    expect(problems).toEqual([]);
  });

  it('ignores an index build that only appears in a comment', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_notes.sql`,
      sql: '-- CREATE INDEX "c_idx" ON "conversation" ("org_id");\nALTER TABLE "conversation" ADD COLUMN "x" text;',
      isConcurrentBuild: false,
    }]);

    expect(problems).toEqual([]);
  });
});

describe('findMigrationSafetyProblems — the concurrent directory', () => {
  /**
   * A concurrent build is only ever applied after the numbered migration
   * sharing its number, so every case here ships that sibling too.
   * @param concurrentSql - Contents of the file under `concurrent/`.
   */
  function withNumberedSibling(concurrentSql: string) {
    return findMigrationSafetyProblems([
      {
        file: `${MIGRATIONS_RELATIVE_DIR}/${ENFORCED}_scope.sql`,
        sql: 'ALTER TABLE "conversation" ADD COLUMN "scope_ref" text;',
        isConcurrentBuild: false,
      },
      {
        file: `${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/${ENFORCED}_scope_index.sql`,
        sql: concurrentSql,
        isConcurrentBuild: true,
      },
    ]);
  }

  it('accepts a concurrent build alongside a defensive index drop', () => {
    const problems = withNumberedSibling(
      'DROP INDEX IF EXISTS "c_idx";\nCREATE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
    );

    expect(problems).toEqual([]);
  });

  it('rejects a plain index build in the concurrent directory', () => {
    const problems = withNumberedSibling('CREATE INDEX IF NOT EXISTS "c_idx" ON "conversation" ("org_id");');

    expect(problems.map(problem => problem.rule)).toEqual(['non-concurrent-index-in-concurrent-dir']);
  });

  it('rejects a statement that is not an index build or drop', () => {
    const problems = withNumberedSibling(
      'ALTER TABLE "conversation" ADD COLUMN "x" text;\nCREATE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("x");',
    );

    expect(problems.map(problem => problem.rule)).toEqual(['non-index-statement-in-concurrent-dir']);
    expect(problems[0]!.line).toBe(1);
  });

  it('rejects a concurrent build with no IF NOT EXISTS', () => {
    const problems = withNumberedSibling('CREATE INDEX CONCURRENTLY "c_idx" ON "conversation" ("org_id");');

    expect(problems.map(problem => problem.rule)).toEqual(['non-concurrent-index-in-concurrent-dir']);
    expect(problems[0]!.message).toContain('relation already exists');
  });

  it('rejects a UNIQUE concurrent build, which dev and test would not enforce', () => {
    const problems = withNumberedSibling(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
    );

    expect(problems.map(problem => problem.rule)).toEqual(['unique-index-in-concurrent-dir']);
  });

  it('rejects a number that is not exactly four digits', () => {
    const problems = findMigrationSafetyProblems([
      {
        file: `${MIGRATIONS_RELATIVE_DIR}/081_scope.sql`,
        sql: 'ALTER TABLE "conversation" ADD COLUMN "scope_ref" text;',
        isConcurrentBuild: false,
      },
      {
        file: `${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/081_scope_index.sql`,
        sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
        isConcurrentBuild: true,
      },
    ]);

    expect(problems.map(problem => problem.rule)).toEqual(['orphan-concurrent-build']);
    expect(problems[0]!.message).toContain('exactly four digits');
  });

  it('rejects a concurrent build whose number matches no migration', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/9999_orphan.sql`,
      sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: true,
    }]);

    expect(problems.map(problem => problem.rule)).toEqual(['orphan-concurrent-build']);
    expect(problems[0]!.message).toContain('never run it');
  });

  it('rejects a concurrent build with no number at all', () => {
    const problems = findMigrationSafetyProblems([{
      file: `${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/orphan.sql`,
      sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "c_idx" ON "conversation" ("org_id");',
      isConcurrentBuild: true,
    }]);

    expect(problems.map(problem => problem.rule)).toEqual(['orphan-concurrent-build']);
  });
});

describe('readMigrationFiles', () => {
  it('reads the numbered migrations and skips non-SQL files', () => {
    const root = writeMigrationsDirectory({
      '0001_first.sql': 'CREATE TABLE a (id text);',
      'notes.md': 'not sql',
    });

    const files = readMigrationFiles(root);

    expect(files.map(file => file.file)).toEqual([`${MIGRATIONS_RELATIVE_DIR}/0001_first.sql`]);
  });

  it('reads the concurrent directory too, and marks those files', () => {
    const root = writeMigrationsDirectory(
      { '0001_first.sql': 'CREATE TABLE a (id text);' },
      { '0001_first_index.sql': 'CREATE INDEX CONCURRENTLY i ON a (id);', 'README.md': 'x' },
    );

    const files = readMigrationFiles(root);

    expect(files.map(file => file.isConcurrentBuild)).toEqual([false, true]);
  });
});

describe('formatProblems', () => {
  it('uses the singular for one problem', () => {
    const output = formatProblems([{ file: 'a.sql', line: 1, rule: 'blocking-index', message: 'nope' }]);

    expect(output).toContain('1 migration convention problem:');
  });

  it('uses the plural for several', () => {
    const problem = { file: 'a.sql', line: 1, rule: 'blocking-index' as const, message: 'nope' };
    const output = formatProblems([problem, problem]);

    expect(output).toContain('2 migration convention problems:');
  });
});

describe('runCheck', () => {
  it('returns 0 and reports the file count when the directory is clean', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = writeMigrationsDirectory({
      '0001_first.sql': 'CREATE TABLE a (id text);\nCREATE INDEX i ON a (id);',
    });

    expect(runCheck(root)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 migration files'));

    log.mockRestore();
  });

  it('returns 1 and prints the rule when a migration takes the lock', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = writeMigrationsDirectory({
      [`${ENFORCED}_index.sql`]: 'CREATE INDEX i ON conversation (org_id);',
    });

    expect(runCheck(root)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('blocking-index'));

    error.mockRestore();
  });

  it('defaults to this repository, which follows its own rule', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(runCheck()).toBe(0);

    log.mockRestore();
  });
});
