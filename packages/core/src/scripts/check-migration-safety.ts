/**
 * check:migrations — fail the build on a migration that locks a populated table.
 *
 * Why this exists: a plain `CREATE INDEX` holds a lock that blocks every write
 * to the table until the build finishes. On a table with real volume that is a
 * self-inflicted outage in the middle of a deploy. Postgres' answer is
 * `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block.
 *
 * Two things make that awkward in this repo:
 *
 *   1. Local dev, the unit-test fixtures and the demos all migrate through
 *      PGlite, which cannot run `CREATE INDEX CONCURRENTLY` at all — it answers
 *      `tuple concurrently updated` (verified against PGlite on 2026-09-08).
 *   2. drizzle's migrator applies each migration file inside one transaction,
 *      so a concurrent build in a journal-listed migration is rejected outright.
 *
 * So concurrent index builds live in their own directory,
 * `packages/core/migrations/concurrent/`, which drizzle never reads (its
 * migrator only opens the files named in `meta/_journal.json`) and which
 * `infra/aws/apply-migrations.sh` applies against production outside any
 * transaction. Dev and test then run without those indexes, which only ever
 * mattered for production query plans.
 *
 * The convention this enforces — plus the expand-and-contract rule for column
 * changes, which is documentation only and not checked here — is written in
 * `packages/core/migrations/CONVENTIONS.md`.
 *
 * Run: npm run check:migrations
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fromRepoRoot } from '../libs/repo-root';

/** Migrations directory, relative to the repo root. */
export const MIGRATIONS_RELATIVE_DIR = 'packages/core/migrations';

/** Subdirectory holding the production-only concurrent index builds. */
export const CONCURRENT_SUBDIR = 'concurrent';

/**
 * Migrations numbered below this are exempt.
 *
 * An applied migration is immutable: rewriting one that production has already
 * recorded means the change never runs there, and drizzle decides what to apply
 * from the journal timestamp rather than the file contents, so the edit passes
 * unnoticed. 0000-0080 predate this rule and several of them do index a
 * pre-existing table — they were built when those tables held hundreds of rows,
 * not millions. Enforcement therefore starts at the first migration written
 * after the rule landed. Raise this number only if the exempt files are
 * themselves superseded.
 */
export const FIRST_ENFORCED_MIGRATION_NUMBER = 81;

/** Where the CONVENTIONS doc lives, quoted back to the author on failure. */
const CONVENTIONS_DOC = `${MIGRATIONS_RELATIVE_DIR}/CONVENTIONS.md`;

export type MigrationProblemRule
  = | 'blocking-index'
    | 'concurrent-build-in-transactional-migration'
    | 'non-concurrent-index-in-concurrent-dir'
    | 'non-index-statement-in-concurrent-dir'
    | 'orphan-concurrent-build';

export type MigrationProblem = {
  /** Repo-relative path of the offending file. */
  file: string;
  /** 1-based line the offending statement starts on. */
  line: number;
  rule: MigrationProblemRule;
  /** Human-readable explanation, including what to do instead. */
  message: string;
};

export type MigrationFile = {
  /** Repo-relative path, used verbatim in problem reports. */
  file: string;
  /** Raw file contents. */
  sql: string;
  /** True when the file lives in `migrations/concurrent/`. */
  isConcurrentBuild: boolean;
};

type IndexBuild = {
  /** Table the index is built on, lowercased and stripped of quotes/schema. */
  table: string;
  /** True when the statement says `CONCURRENTLY`. */
  isConcurrent: boolean;
  /** Character offset of the `CREATE` keyword. */
  offset: number;
};

type SqlStatement = {
  /** Statement text with comments blanked out, trimmed. */
  text: string;
  /** Character offset of the statement's first non-blank character. */
  offset: number;
};

/**
 * Blank out every SQL comment while preserving the length of the input, so a
 * character offset in the result still maps to the same offset in the source.
 *
 * Handles line comments introduced by a double dash (which is also how drizzle
 * writes its statement-breakpoint markers), slash-star block comments,
 * single-quoted literals and double-quoted identifiers.
 * @param sql - Raw migration SQL.
 */
export function blankSqlComments(sql: string): string {
  const characters = sql.split('');
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (index < characters.length) {
    const character = characters[index]!;
    const next = characters[index + 1];

    if (inSingleQuote) {
      inSingleQuote = character !== '\'';
      index += 1;
      continue;
    }
    if (inDoubleQuote) {
      inDoubleQuote = character !== '"';
      index += 1;
      continue;
    }
    if (character === '\'') {
      inSingleQuote = true;
      index += 1;
      continue;
    }
    if (character === '"') {
      inDoubleQuote = true;
      index += 1;
      continue;
    }
    if (character === '-' && next === '-') {
      while (index < characters.length && characters[index] !== '\n') {
        characters[index] = ' ';
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      while (index < characters.length) {
        const isBlockEnd = characters[index] === '*' && characters[index + 1] === '/';
        if (characters[index] !== '\n') {
          characters[index] = ' ';
        }
        index += 1;
        if (isBlockEnd) {
          // Blank the closing slash too, then stop.
          characters[index] = ' ';
          index += 1;
          break;
        }
      }
      continue;
    }
    index += 1;
  }

  return characters.join('');
}

/**
 * Turn a character offset into a 1-based line number.
 * @param sql - The text the offset refers to.
 * @param offset - Character offset within that text.
 */
export function lineNumberAt(sql: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < sql.length; index++) {
    if (sql[index] === '\n') {
      line += 1;
    }
  }
  return line;
}

/**
 * Normalise a table or index identifier: drop the double quotes, drop any
 * schema qualifier, lowercase what's left.
 * @param identifier - Identifier as written in the SQL.
 */
function normaliseIdentifier(identifier: string): string {
  const unquoted = identifier.replaceAll('"', '');
  const lastDot = unquoted.lastIndexOf('.');
  const bare = lastDot === -1 ? unquoted : unquoted.slice(lastDot + 1);
  return bare.toLowerCase();
}

/** One SQL identifier: bare or double-quoted, optionally schema-qualified. */
const IDENTIFIER = String.raw`(?:"[^"]+"|[A-Z_][\w$]*)(?:\.(?:"[^"]+"|[A-Z_][\w$]*))?`;

const CREATE_TABLE_PATTERN = new RegExp(
  String.raw`\bCREATE\s+(?:UNLOGGED\s+|TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENTIFIER})`,
  'gi',
);

const CREATE_INDEX_PATTERN = new RegExp(
  String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:(${IDENTIFIER})\s+)?ON\s+(?:ONLY\s+)?(${IDENTIFIER})`,
  'gi',
);

/**
 * Every table the file creates itself. An index on one of these is safe at any
 * volume — nothing else can be writing to a table this transaction just made.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function findCreatedTables(blankedSql: string): Set<string> {
  const created = new Set<string>();
  for (const match of blankedSql.matchAll(CREATE_TABLE_PATTERN)) {
    created.add(normaliseIdentifier(match[1]!));
  }
  return created;
}

/**
 * Every index build in the file, with the table it targets.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function findIndexBuilds(blankedSql: string): IndexBuild[] {
  const builds: IndexBuild[] = [];
  for (const match of blankedSql.matchAll(CREATE_INDEX_PATTERN)) {
    builds.push({
      table: normaliseIdentifier(match[3]!),
      isConcurrent: match[1] !== undefined,
      offset: match.index ?? 0,
    });
  }
  return builds;
}

/**
 * Split the file into statements on `;`, keeping each one's offset so a
 * problem can be reported against the right line.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function findStatements(blankedSql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let cursor = 0;
  for (const chunk of blankedSql.split(';')) {
    const leadingBlank = chunk.length - chunk.trimStart().length;
    const text = chunk.trim();
    if (text.length > 0) {
      statements.push({ text, offset: cursor + leadingBlank });
    }
    cursor += chunk.length + 1;
  }
  return statements;
}

/**
 * Read the migration number off a filename like `0073_conversation_scope.sql`.
 * Returns null when the name doesn't start with digits.
 * @param file - File path or bare filename.
 */
export function migrationNumberOf(file: string): number | null {
  const digits = /^(\d+)/.exec(basename(file));
  return digits ? Number.parseInt(digits[1]!, 10) : null;
}

/**
 * A statement is allowed in `migrations/concurrent/` only if it is an index
 * build or an index drop. Those files run outside a transaction, so anything
 * else in them can half-apply with no way to roll back.
 * @param statement - Trimmed statement text.
 */
function isIndexOnlyStatement(statement: string): boolean {
  return /^(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\b/i.test(statement);
}

/**
 * Apply every convention check to a set of migration files.
 * @param files - Migration files to inspect, regular and concurrent alike.
 */
export function findMigrationSafetyProblems(files: MigrationFile[]): MigrationProblem[] {
  const problems: MigrationProblem[] = [];

  // apply-migrations.sh runs each concurrent build straight after the numbered
  // migration sharing its number. One with no such migration is never placed,
  // so it silently never runs — the failure this whole check exists to avoid.
  const numberedMigrations = new Set(
    files
      .filter(file => !file.isConcurrentBuild)
      .map(file => migrationNumberOf(file.file)),
  );

  for (const file of files) {
    if (file.isConcurrentBuild) {
      const number = migrationNumberOf(file.file);
      if (number === null || !numberedMigrations.has(number)) {
        problems.push({
          file: file.file,
          line: 1,
          rule: 'orphan-concurrent-build',
          message: `no numbered migration shares this file's number, so apply-migrations.sh has nothing to order it after and will never run it. Name it after the migration whose columns it indexes. See ${CONVENTIONS_DOC}.`,
        });
      }
    }

    const blanked = blankSqlComments(file.sql);
    const indexBuilds = findIndexBuilds(blanked);

    if (file.isConcurrentBuild) {
      for (const build of indexBuilds) {
        if (!build.isConcurrent) {
          problems.push({
            file: file.file,
            line: lineNumberAt(blanked, build.offset),
            rule: 'non-concurrent-index-in-concurrent-dir',
            message: `index on "${build.table}" is in ${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/ but does not say CONCURRENTLY. That directory exists so the build can avoid the write lock — write CREATE INDEX CONCURRENTLY IF NOT EXISTS, or move the statement back into the numbered migration. See ${CONVENTIONS_DOC}.`,
          });
        }
      }
      for (const statement of findStatements(blanked)) {
        if (!isIndexOnlyStatement(statement.text)) {
          problems.push({
            file: file.file,
            line: lineNumberAt(blanked, statement.offset),
            rule: 'non-index-statement-in-concurrent-dir',
            message: `only CREATE INDEX and DROP INDEX belong in ${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/. These files are applied outside any transaction, so a statement that fails halfway leaves the schema half-changed with nothing to roll back. Move this statement into the numbered migration. See ${CONVENTIONS_DOC}.`,
          });
        }
      }
      continue;
    }

    const createdTables = findCreatedTables(blanked);
    const number = migrationNumberOf(file.file);
    const isEnforced = number === null || number >= FIRST_ENFORCED_MIGRATION_NUMBER;

    for (const build of indexBuilds) {
      if (build.isConcurrent) {
        problems.push({
          file: file.file,
          line: lineNumberAt(blanked, build.offset),
          rule: 'concurrent-build-in-transactional-migration',
          message: `CREATE INDEX CONCURRENTLY cannot run here — drizzle applies each numbered migration in one transaction, and the PGlite used by dev and the unit tests cannot run a concurrent build at all. Move the statement to ${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/${number === null ? 'NNNN' : String(number).padStart(4, '0')}_<name>.sql. See ${CONVENTIONS_DOC}.`,
        });
        continue;
      }
      if (isEnforced && !createdTables.has(build.table)) {
        problems.push({
          file: file.file,
          line: lineNumberAt(blanked, build.offset),
          rule: 'blocking-index',
          message: `CREATE INDEX on "${build.table}", which this migration does not create, blocks every write to that table for the length of the build. Move it to ${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/${number === null ? 'NNNN' : String(number).padStart(4, '0')}_<name>.sql as CREATE INDEX CONCURRENTLY IF NOT EXISTS. See ${CONVENTIONS_DOC}.`,
        });
      }
    }
  }

  return problems;
}

/**
 * Load every migration file from disk, regular and concurrent.
 * @param migrationsDir - Absolute path to the migrations directory.
 */
export function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  const files: MigrationFile[] = [];

  for (const name of readdirSync(migrationsDir).sort()) {
    if (name.endsWith('.sql')) {
      files.push({
        file: `${MIGRATIONS_RELATIVE_DIR}/${name}`,
        sql: readFileSync(join(migrationsDir, name), 'utf-8'),
        isConcurrentBuild: false,
      });
    }
  }

  const concurrentDir = join(migrationsDir, CONCURRENT_SUBDIR);
  if (existsSync(concurrentDir)) {
    for (const name of readdirSync(concurrentDir).sort()) {
      if (name.endsWith('.sql')) {
        files.push({
          file: `${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/${name}`,
          sql: readFileSync(join(concurrentDir, name), 'utf-8'),
          isConcurrentBuild: true,
        });
      }
    }
  }

  return files;
}

/**
 * Format the problems as the CI failure output.
 * @param problems - Problems found, possibly empty.
 */
export function formatProblems(problems: MigrationProblem[]): string {
  const lines = [`${problems.length} migration convention problem${problems.length === 1 ? '' : 's'}:`, ''];
  for (const problem of problems) {
    lines.push(`  ${problem.file}:${problem.line} — [${problem.rule}]`);
    lines.push(`    ${problem.message}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * CLI entrypoint: print any problems and return the process exit code.
 * @param migrationsDir - Directory to inspect; defaults to this repo's own.
 */
export function runCheck(migrationsDir: string = fromRepoRoot(MIGRATIONS_RELATIVE_DIR)): number {
  const files = readMigrationFiles(migrationsDir);
  const problems = findMigrationSafetyProblems(files);

  if (problems.length > 0) {
    console.error(formatProblems(problems));
    return 1;
  }

  console.log(`check:migrations — ${files.length} migration files, no blocking index builds.`);
  return 0;
}

// `tsx src/scripts/check-migration-safety.ts` runs the check; importing the
// module from a test does not.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exit(runCheck());
}
