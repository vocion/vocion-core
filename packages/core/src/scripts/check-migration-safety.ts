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
 * Two deliberate limits. Nested block comments (Postgres allows them) are
 * unwound only as far as the first closing delimiter, and a keyword sitting
 * inside a string literal counts as real SQL. Both make the check too eager
 * rather than too blind — the safer of the two mistakes, and the same
 * trade-off `infra/aws/apply-migrations.sh` already documents for its own
 * detection.
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
    | 'concurrent-build-ahead-of-its-columns'
    | 'concurrent-build-in-transactional-migration'
    | 'non-concurrent-index-in-concurrent-dir'
    | 'blocking-constraint'
    | 'non-index-statement-in-concurrent-dir'
    | 'orphan-concurrent-build'
    | 'unique-index-in-concurrent-dir';

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
  /** True when the statement says `UNIQUE`. */
  isUnique: boolean;
  /** True when the statement says `IF NOT EXISTS`. */
  isIfNotExists: boolean;
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
  // The `$$` or `$tag$` currently open, if any. Postgres treats everything up
  // to the matching delimiter as one literal, so nothing inside it is a
  // comment and nothing inside it ends a statement.
  let openDollarTag: string | null = null;

  while (index < characters.length) {
    const character = characters[index]!;
    const next = characters[index + 1];

    if (openDollarTag !== null) {
      if (sql.startsWith(openDollarTag, index)) {
        index += openDollarTag.length;
        openDollarTag = null;
        continue;
      }
      index += 1;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && character === '$') {
      const dollarTag = /^\$[A-Z_]*\$/i.exec(sql.slice(index));
      if (dollarTag) {
        openDollarTag = dollarTag[0];
        index += openDollarTag.length;
        continue;
      }
    }

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
  String.raw`\bCREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?(?:(${IDENTIFIER})\s+)?ON\s+(?:ONLY\s+)?(${IDENTIFIER})`,
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
 * `ALTER TABLE ... ADD [CONSTRAINT name] UNIQUE|PRIMARY KEY` builds an index
 * behind the scenes, holding a heavier lock than `CREATE INDEX` does — reads
 * block as well as writes. There is no concurrent form of the statement, so on
 * a populated table the only safe route is expand and contract.
 */
const ALTER_TABLE_PATTERN = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?(${IDENTIFIER})`, 'i');

const ADD_INDEX_CONSTRAINT_PATTERN = new RegExp(
  String.raw`\bADD\s+(?:CONSTRAINT\s+${IDENTIFIER}\s+)?(UNIQUE|PRIMARY\s+KEY)\b`,
  'i',
);

export type ConstraintBuild = {
  /** Table the constraint is added to, lowercased and stripped of quotes. */
  table: string;
  /** `UNIQUE` or `PRIMARY KEY`, normalised to upper case. */
  keyword: string;
  /** Character offset of the `ALTER` keyword. */
  offset: number;
};

/**
 * Every index-building constraint the file adds.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function findIndexBuildingConstraints(blankedSql: string): ConstraintBuild[] {
  const constraints: ConstraintBuild[] = [];
  // Statement by statement rather than across the whole file, so the table
  // named in the report is the one the constraint is actually added to.
  for (const statement of findStatements(blankedSql)) {
    const alteredTable = ALTER_TABLE_PATTERN.exec(statement.text);
    if (!alteredTable) {
      continue;
    }
    const constraint = ADD_INDEX_CONSTRAINT_PATTERN.exec(statement.text);
    if (!constraint) {
      continue;
    }
    constraints.push({
      table: normaliseIdentifier(alteredTable[1]!),
      keyword: constraint[1]!.replaceAll(/\s+/g, ' ').toUpperCase(),
      offset: statement.offset,
    });
  }
  return constraints;
}

/**
 * Every index build in the file, with the table it targets.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function findIndexBuilds(blankedSql: string): IndexBuild[] {
  const builds: IndexBuild[] = [];
  for (const match of blankedSql.matchAll(CREATE_INDEX_PATTERN)) {
    builds.push({
      table: normaliseIdentifier(match[5]!),
      isConcurrent: match[2] !== undefined,
      isUnique: match[1] !== undefined,
      isIfNotExists: match[3] !== undefined,
      offset: match.index,
    });
  }
  return builds;
}

const ADD_COLUMN_PATTERN = new RegExp(
  String.raw`\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENTIFIER})`,
  'gi',
);

/**
 * Blank the contents of every string literal, preserving length, so a scan for
 * structure — a closing parenthesis, the `;` that ends a statement — cannot be
 * thrown off by a punctuation character sitting inside a value. Double-quoted
 * identifiers are left alone: they are the column names being read.
 *
 * `blankSqlComments` deliberately keeps literals intact, because a keyword
 * inside one should still count as SQL for the eager checks. Structural
 * scanning wants the opposite, so it asks for this pass first.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function blankSqlStringLiterals(blankedSql: string): string {
  const characters = blankedSql.split('');
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let openDollarTag: string | null = null;

  while (index < characters.length) {
    const character = characters[index]!;

    if (openDollarTag !== null) {
      if (blankedSql.startsWith(openDollarTag, index)) {
        index += openDollarTag.length;
        openDollarTag = null;
        continue;
      }
      if (character !== '\n') {
        characters[index] = ' ';
      }
      index += 1;
      continue;
    }
    if (inSingleQuote) {
      inSingleQuote = character !== '\'';
      if (inSingleQuote && character !== '\n') {
        characters[index] = ' ';
      }
      index += 1;
      continue;
    }
    if (inDoubleQuote) {
      inDoubleQuote = character !== '"';
      index += 1;
      continue;
    }
    if (!inDoubleQuote && character === '$') {
      const dollarTag = /^\$[A-Z_]*\$/i.exec(blankedSql.slice(index));
      if (dollarTag) {
        openDollarTag = dollarTag[0];
        index += openDollarTag.length;
        continue;
      }
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
    index += 1;
  }

  return characters.join('');
}

/** Words that open a table constraint rather than name a column. */
const TABLE_CONSTRAINT_KEYWORDS = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude']);

/**
 * Key a column by the table it belongs to, so two tables can hold a column of
 * the same name without one standing in for the other.
 * @param table - Table name, already normalised.
 * @param column - Column name, already normalised.
 */
function columnKey(table: string, column: string): string {
  return `${table}.${column}`;
}

/**
 * Read the column names out of a `CREATE TABLE` body, starting at the opening
 * parenthesis that follows the table name.
 *
 * Only the first identifier of each top-level item counts as a column, which
 * skips the table constraints written the same way (`CONSTRAINT ... UNIQUE
 * ("a")`) and the identifiers inside a nested parenthesis.
 * @param blankedSql - SQL with comments already blanked out.
 * @param searchFrom - Offset just past the table name.
 */
function readCreateTableColumns(blankedSql: string, searchFrom: number): string[] {
  const open = blankedSql.indexOf('(', searchFrom);
  if (open === -1) {
    return [];
  }

  const columns: string[] = [];
  let depth = 0;
  let itemStart = open + 1;

  for (let index = open; index < blankedSql.length; index += 1) {
    const character = blankedSql[index]!;
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        columns.push(blankedSql.slice(itemStart, index));
        break;
      }
      continue;
    }
    if (character === ',' && depth === 1) {
      columns.push(blankedSql.slice(itemStart, index));
      itemStart = index + 1;
    }
  }

  const named: string[] = [];
  for (const item of columns) {
    const leading = new RegExp(String.raw`^\s*(${IDENTIFIER})`, 'i').exec(item);
    if (!leading) {
      continue;
    }
    const name = normaliseIdentifier(leading[1]!);
    if (!TABLE_CONSTRAINT_KEYWORDS.has(name)) {
      named.push(name);
    }
  }
  return named;
}

/**
 * Every `table.column` a migration introduces, whether by creating the table
 * or by adding the column to one that already exists.
 * @param blankedSql - SQL with comments already blanked out.
 */
export function findIntroducedColumns(blankedSql: string): Set<string> {
  const introduced = new Set<string>();
  const structural = blankSqlStringLiterals(blankedSql);

  for (const match of structural.matchAll(CREATE_TABLE_PATTERN)) {
    const table = normaliseIdentifier(match[1]!);
    for (const column of readCreateTableColumns(structural, match.index + match[0].length)) {
      introduced.add(columnKey(table, column));
    }
  }

  // One ALTER TABLE can add several columns, so the table is read once and
  // every ADD COLUMN inside that statement counted against it.
  for (const statement of findStatements(structural)) {
    const alteredTable = ALTER_TABLE_PATTERN.exec(statement.text);
    if (!alteredTable) {
      continue;
    }
    const table = normaliseIdentifier(alteredTable[1]!);
    for (const added of statement.text.matchAll(ADD_COLUMN_PATTERN)) {
      introduced.add(columnKey(table, normaliseIdentifier(added[1]!)));
    }
  }

  return introduced;
}

/**
 * The lowest migration number at which each `table.column` exists.
 *
 * A column missing from the map is one no numbered migration in this set
 * introduces — it predates the files being checked, or arrives through SQL
 * this parser does not read — and the ordering check stays quiet about it
 * rather than guessing.
 *
 * Arrival only. A later `DROP COLUMN` or `RENAME COLUMN` is invisible here, so
 * a concurrent build that indexes a column a subsequent migration removes is
 * not caught — dropping a column an index still names is its own review
 * question, and inferring it from renames would be guesswork.
 * @param files - Migration files to inspect; concurrent builds are skipped.
 */
export function buildColumnArrivalNumbers(files: MigrationFile[]): Map<string, number> {
  const arrival = new Map<string, number>();

  for (const file of files) {
    const number = migrationNumberOf(file.file);
    if (file.isConcurrentBuild || number === null) {
      continue;
    }
    for (const key of findIntroducedColumns(blankSqlComments(file.sql))) {
      const seen = arrival.get(key);
      if (seen === undefined || number < seen) {
        arrival.set(key, number);
      }
    }
  }

  return arrival;
}

/**
 * The columns one index build names, both in the key and in a partial index's
 * `WHERE` clause — every one of them has to exist when the build runs.
 *
 * Columns are read from the quoted identifiers after the table name, which is
 * how this repo writes them; an unquoted column would be missed, leaving the
 * check too quiet rather than wrong.
 * @param blankedSql - SQL with comments already blanked out.
 * @param build - The index build to read, as found by findIndexBuilds.
 */
export function findIndexedColumns(blankedSql: string, build: IndexBuild): string[] {
  const structural = blankSqlStringLiterals(blankedSql);
  const statementEnd = structural.indexOf(';', build.offset);
  const statement = structural.slice(build.offset, statementEnd === -1 ? undefined : statementEnd);
  const onClause = new RegExp(String.raw`\bON\s+(?:ONLY\s+)?${IDENTIFIER}`, 'i').exec(statement);
  if (!onClause) {
    return [];
  }

  const columns: string[] = [];
  for (const match of statement.slice(onClause.index + onClause[0].length).matchAll(/"([^"]+)"/g)) {
    columns.push(normaliseIdentifier(match[1]!));
  }
  return columns;
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
  // migration sharing its number, matched on the filename's first four
  // characters. One with no such migration is never placed, so it silently
  // never runs — the failure this whole check exists to avoid.
  const numberedMigrations = new Set(
    files
      .filter(file => !file.isConcurrentBuild)
      .map(file => migrationNumberOf(file.file)),
  );

  // Placement is only half the ordering problem: a build placed after 0108
  // that indexes a column 0113 adds stops the deploy with `column ... does not
  // exist`, and dev never sees it because dev skips this directory entirely.
  const columnArrivalNumbers = buildColumnArrivalNumbers(files);

  for (const file of files) {
    const blanked = blankSqlComments(file.sql);
    const indexBuilds = findIndexBuilds(blanked);
    const number = migrationNumberOf(file.file);

    if (file.isConcurrentBuild) {
      problems.push(...findConcurrentDirectoryProblems(
        file,
        blanked,
        indexBuilds,
        number,
        numberedMigrations,
        columnArrivalNumbers,
      ));
      continue;
    }

    const createdTables = findCreatedTables(blanked);
    const isEnforced = number === null || number >= FIRST_ENFORCED_MIGRATION_NUMBER;
    const concurrentTarget = `${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/${number === null ? 'NNNN' : String(number).padStart(4, '0')}_<name>.sql`;

    for (const build of indexBuilds) {
      if (build.isConcurrent) {
        problems.push({
          file: file.file,
          line: lineNumberAt(blanked, build.offset),
          rule: 'concurrent-build-in-transactional-migration',
          message: `CREATE INDEX CONCURRENTLY cannot run here — drizzle applies each numbered migration in one transaction, and the PGlite used by dev and the unit tests cannot run a concurrent build at all. Move the statement to ${concurrentTarget}. See ${CONVENTIONS_DOC}.`,
        });
        continue;
      }
      if (isEnforced && !createdTables.has(build.table)) {
        problems.push({
          file: file.file,
          line: lineNumberAt(blanked, build.offset),
          rule: 'blocking-index',
          message: `CREATE INDEX on "${build.table}", which this migration does not create, blocks every write to that table for the length of the build. Move it to ${concurrentTarget} as CREATE INDEX CONCURRENTLY IF NOT EXISTS. See ${CONVENTIONS_DOC}.`,
        });
      }
    }

    if (!isEnforced) {
      continue;
    }

    for (const constraint of findIndexBuildingConstraints(blanked)) {
      if (!createdTables.has(constraint.table)) {
        problems.push({
          file: file.file,
          line: lineNumberAt(blanked, constraint.offset),
          rule: 'blocking-constraint',
          message: `ADD ${constraint.keyword} on "${constraint.table}", which this migration does not create, builds an index while holding a lock that blocks reads as well as writes, and Postgres has no concurrent form of it. Add the column and the constraint across separate releases instead — see the expand-and-contract section of ${CONVENTIONS_DOC}.`,
        });
      }
    }
  }

  return problems;
}

/**
 * The rules that apply only inside `migrations/concurrent/`.
 * @param file - The concurrent build being checked.
 * @param blanked - Its SQL with comments blanked out.
 * @param indexBuilds - Index builds already parsed out of it.
 * @param number - Its migration number, or null when the name has no digits.
 * @param numberedMigrations - Numbers of the migrations in the same set.
 * @param columnArrivalNumbers - Lowest migration number at which each column exists.
 */
function findConcurrentDirectoryProblems(
  file: MigrationFile,
  blanked: string,
  indexBuilds: IndexBuild[],
  number: number | null,
  numberedMigrations: Set<number | null>,
  columnArrivalNumbers: Map<string, number>,
): MigrationProblem[] {
  const problems: MigrationProblem[] = [];
  const filename = basename(file.file);

  if (number === null || !numberedMigrations.has(number)) {
    problems.push({
      file: file.file,
      line: 1,
      rule: 'orphan-concurrent-build',
      message: `no numbered migration shares this file's number, so apply-migrations.sh has nothing to order it after and will never run it. Rename it to ${CONCURRENT_SUBDIR}/<NNNN>_<name>.sql, where NNNN is the 4-digit number of the migration whose columns it indexes. See ${CONVENTIONS_DOC}.`,
    });
  } else if (!/^\d{4}_/.test(filename)) {
    // The applier matches on the first four characters of the filename, so a
    // 3- or 5-digit prefix is placed against the wrong migration or not at all.
    problems.push({
      file: file.file,
      line: 1,
      rule: 'orphan-concurrent-build',
      message: `apply-migrations.sh matches these files on the first four characters of the name, so the number needs exactly four digits and an underscore: ${CONCURRENT_SUBDIR}/<NNNN>_<name>.sql. See ${CONVENTIONS_DOC}.`,
    });
  }

  for (const build of indexBuilds) {
    if (!build.isConcurrent) {
      problems.push({
        file: file.file,
        line: lineNumberAt(blanked, build.offset),
        rule: 'non-concurrent-index-in-concurrent-dir',
        message: `index on "${build.table}" is in ${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/ but does not say CONCURRENTLY. That directory exists so the build can avoid the write lock — write CREATE INDEX CONCURRENTLY IF NOT EXISTS, or move the statement back into the numbered migration. See ${CONVENTIONS_DOC}.`,
      });
      continue;
    }
    if (!build.isIfNotExists) {
      // Baselining records only the numbered migrations, so a concurrent build
      // can legitimately be applied a second time against a database that
      // already has the index. Without IF NOT EXISTS that run dies on
      // "relation already exists" and takes the deploy with it.
      problems.push({
        file: file.file,
        line: lineNumberAt(blanked, build.offset),
        rule: 'non-concurrent-index-in-concurrent-dir',
        message: `index on "${build.table}" needs IF NOT EXISTS. A concurrent build can be re-applied against a database that already has the index — a baselined one records only the numbered migrations — and without IF NOT EXISTS that run fails on "relation already exists" and aborts the deploy. See ${CONVENTIONS_DOC}.`,
      });
    }
    if (number !== null) {
      for (const column of findIndexedColumns(blanked, build)) {
        const arrivesAt = columnArrivalNumbers.get(`${build.table}.${column}`);
        if (arrivesAt !== undefined && arrivesAt > number) {
          problems.push({
            file: file.file,
            line: lineNumberAt(blanked, build.offset),
            rule: 'concurrent-build-ahead-of-its-columns',
            message: `"${build.table}"."${column}" is added by migration ${String(arrivesAt).padStart(4, '0')}, but this build runs straight after ${String(number).padStart(4, '0')}, so Postgres answers \`column "${column}" does not exist\` and the deploy stops there. Dev and the unit tests never run this directory, so nothing catches it before the box does. Rename the file to ${CONCURRENT_SUBDIR}/${String(arrivesAt).padStart(4, '0')}_<name>.sql or later. See ${CONVENTIONS_DOC}.`,
          });
        }
      }
    }
    if (build.isUnique) {
      problems.push({
        file: file.file,
        line: lineNumberAt(blanked, build.offset),
        rule: 'unique-index-in-concurrent-dir',
        message: `a UNIQUE index on "${build.table}" cannot live here. Files in ${CONCURRENT_SUBDIR}/ are applied to production only, and uniqueness is a constraint rather than a query-plan detail — dev and the tests would accept rows production rejects. Take the expand-and-contract route in the numbered migrations instead. See ${CONVENTIONS_DOC}.`,
      });
    }
  }

  // Split on the literal-blanked text: a `;` inside a value would otherwise
  // cut one index build into two statements, the second of which starts
  // mid-clause and reads as something other than an index build.
  for (const statement of findStatements(blankSqlStringLiterals(blanked))) {
    if (!isIndexOnlyStatement(statement.text)) {
      problems.push({
        file: file.file,
        line: lineNumberAt(blanked, statement.offset),
        rule: 'non-index-statement-in-concurrent-dir',
        message: `only CREATE INDEX and DROP INDEX belong in ${MIGRATIONS_RELATIVE_DIR}/${CONCURRENT_SUBDIR}/. These files are applied outside any transaction, so a statement that fails halfway leaves the schema half-changed with nothing to roll back. Move this statement into the numbered migration. See ${CONVENTIONS_DOC}.`,
      });
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
