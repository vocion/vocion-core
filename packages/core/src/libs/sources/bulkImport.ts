/**
 * CSV bulk import for source connectors — one source per row.
 *
 * The Sources page can hand a user a template CSV for the connector they
 * picked, take the filled-in file back, and create many sources from it in one
 * action. Everything here is pure: it takes CSV text plus the sources that
 * already exist and returns a per-row verdict. Nothing in this file touches the
 * database, which is what lets the preview endpoint promise that it writes
 * nothing.
 *
 * A connector opts in by declaring a `bulkImport` descriptor
 * (`libs/sources/types.ts`). The template columns, the cell coercion and the
 * validation all read from that one descriptor plus the connector's existing
 * `configSchema`, so there is exactly one importer rather than one per source
 * type.
 *
 * Why the identity value and not the slug decides "already exists": slugs are
 * auto-uniquified (fifty pages on one host must become fifty sources, not one),
 * so a slug comparison would happily create a second copy of a source that is
 * already configured. The identity — the URL, the Slack channel id, the Drive
 * query — is what actually says "this is the same source", so that is what a
 * re-import is checked against.
 */

import type { BulkImportColumn, SourceConnector } from './types';
import Papa from 'papaparse';

/** Column every template carries: an optional operator-chosen slug. */
export const IMPORT_SLUG_COLUMN = 'slug';

/** Most rows one file may carry. Beyond this the request is rejected outright. */
export const MAX_IMPORT_ROWS = 1000;

/** Largest upload accepted, in bytes (1 MB). */
export const MAX_IMPORT_BYTES = 1_048_576;

/** What separates the values inside a single list-valued cell. */
export const LIST_CELL_SEPARATOR = ';';

/** Longest slug we will store, matching the single-add path's cap. */
const MAX_SLUG_LENGTH = 60;

export type SourceImportVerdict = 'ok' | 'malformed' | 'duplicate-in-file' | 'already-exists';

export type SourceImportRow = {
  /** Line number in the uploaded file, counting the header as line 1. */
  line: number;
  /** Slug the source would get. Null when the row is malformed. */
  slug: string | null;
  /** The identity value that names this source (its URL, channel id, …). */
  identity: string | null;
  /** Config that would be stored, already validated. Null unless the verdict is `ok`. */
  config: Record<string, unknown> | null;
  verdict: SourceImportVerdict;
  /** Why the row is not `ok`, naming the offending column. Null when it is. */
  problem: string | null;
};

export type SourceImportSummary = {
  total: number;
  willAdd: number;
  malformed: number;
  duplicateInFile: number;
  alreadyExists: number;
};

export type SourceImportPreview = {
  rows: SourceImportRow[];
  summary: SourceImportSummary;
};

/** A source that already exists for this connector, as the preview needs it. */
export type ExistingSource = {
  slug: string;
  config: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

/**
 * The CSV template for one connector: a header row plus a single example row.
 *
 * The example row is real, valid data rather than placeholder prose, so a user
 * who edits it in place ends up with an importable file instead of a row that
 * fails validation on the words we left behind.
 * @param connector - Connector to build the template for.
 * @returns CSV text, ready to serve as a download.
 * @throws When the connector has no `bulkImport` descriptor.
 */
export function buildImportTemplate(connector: SourceConnector): string {
  const descriptor = requireDescriptor(connector);
  const header = [IMPORT_SLUG_COLUMN, ...descriptor.columns.map(column => column.column)];
  const exampleRow = ['', ...descriptor.columns.map(column => column.example)];
  return Papa.unparse([header, exampleRow], { newline: '\n' });
}

/**
 * File name to offer for a connector's template download.
 * @param connector - Connector the template is for.
 */
export function importTemplateFileName(connector: SourceConnector): string {
  return `${connector.slug}-sources-template.csv`;
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

/**
 * Work out what an uploaded CSV would do, without doing any of it.
 *
 * Every row gets its own verdict, so one malformed cell costs that row and
 * nothing else — a 200-row file with two bad cells still imports 198 sources.
 * A file-level problem (an unreadable file, a missing required column, too many
 * rows) is returned as `error` instead, because there is no useful per-row
 * answer to give.
 * @param input - The connector, the uploaded text, and what already exists.
 * @param input.connector - Connector the rows are being imported for.
 * @param input.csvText - Raw text of the uploaded file.
 * @param input.existingSources - This org's already-configured sources for that connector.
 * @returns The preview, or a file-level error message.
 */
export function previewSourceImport(input: {
  connector: SourceConnector;
  csvText: string;
  existingSources: ExistingSource[];
}): { preview: SourceImportPreview | null; error: string | null } {
  const descriptor = requireDescriptor(input.connector);

  const byteLength = new TextEncoder().encode(input.csvText).length;
  if (byteLength > MAX_IMPORT_BYTES) {
    return { preview: null, error: `That file is larger than the ${formatMegabytes(MAX_IMPORT_BYTES)} limit.` };
  }

  const parsed = Papa.parse<Record<string, string>>(input.csvText.trim(), {
    header: true,
    skipEmptyLines: false,
    transformHeader: header => header.trim().toLowerCase(),
  });

  const headerFields = parsed.meta.fields ?? [];
  if (headerFields.length === 0) {
    return { preview: null, error: 'That file has no header row. Download the template and fill it in.' };
  }

  const missingColumns = descriptor.columns
    .filter(column => column.required && !headerFields.includes(column.column))
    .map(column => column.column);
  if (missingColumns.length > 0) {
    return {
      preview: null,
      error: `That file is missing the ${missingColumns.map(name => `"${name}"`).join(', ')} column. Download the template for this source type.`,
    };
  }

  const dataRows = parsed.data.filter(row => !isBlankRow(row));
  if (dataRows.length === 0) {
    return { preview: null, error: 'That file has a header row but no data rows.' };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      preview: null,
      error: `That file has ${dataRows.length} rows, over the ${MAX_IMPORT_ROWS}-row limit. Split it into smaller files.`,
    };
  }

  const takenSlugs = new Set(input.existingSources.map(source => source.slug));
  const existingIdentities = new Set(
    input.existingSources
      .map(source => readIdentity(input.connector, source.config))
      .filter((identity): identity is string => identity !== null),
  );
  const identitiesSeenInFile = new Set<string>();

  const rows: SourceImportRow[] = [];
  let lineNumber = 1; // the header
  for (const rawRow of parsed.data) {
    lineNumber += 1;
    if (isBlankRow(rawRow)) {
      continue;
    }
    rows.push(buildRow({
      connector: input.connector,
      rawRow,
      line: lineNumber,
      takenSlugs,
      existingIdentities,
      identitiesSeenInFile,
    }));
  }

  return { preview: { rows, summary: summarize(rows) }, error: null };
}

/**
 * Decide one row's fate: its config, its slug, and why it is not importable.
 *
 * Mutates `takenSlugs` and `identitiesSeenInFile` as it goes so that later rows
 * see what earlier ones claimed — that is what makes fifty same-host URLs land
 * on fifty distinct slugs, and what catches the same URL listed twice.
 * @param input - The row and the running state of the file being previewed.
 * @param input.connector - Connector the row belongs to.
 * @param input.rawRow - The row's cells, keyed by lower-cased header.
 * @param input.line - File line number, header counted as 1.
 * @param input.takenSlugs - Slugs already claimed, by existing sources or earlier rows.
 * @param input.existingIdentities - Identity values already configured for this connector.
 * @param input.identitiesSeenInFile - Identity values claimed by earlier rows in this file.
 */
function buildRow(input: {
  connector: SourceConnector;
  rawRow: Record<string, string>;
  line: number;
  takenSlugs: Set<string>;
  existingIdentities: Set<string>;
  identitiesSeenInFile: Set<string>;
}): SourceImportRow {
  const descriptor = requireDescriptor(input.connector);
  const cells: Record<string, unknown> = {};

  for (const column of descriptor.columns) {
    const parsedCell = parseCell(column, input.rawRow[column.column] ?? '');
    if (parsedCell.problem) {
      return malformed(input.line, parsedCell.problem);
    }
    if (parsedCell.value !== undefined) {
      cells[column.column] = parsedCell.value;
    }
  }

  const identityParts: string[] = [];
  for (const [position, columnName] of descriptor.identityColumns.entries()) {
    const part = identityPartFromCell(cells[columnName]);
    if (part !== null) {
      identityParts.push(part);
      continue;
    }
    // A blank in a later identity column is a real value — "the whole bucket",
    // not "nothing" — so it narrows the identity rather than failing the row.
    // A blank in the FIRST one leaves nothing to name the source after.
    if (position === 0) {
      return malformed(input.line, `"${columnName}" is required`);
    }
    identityParts.push('');
  }
  const identity = joinIdentity(identityParts);
  const identityColumnList = descriptor.identityColumns.map(name => `"${name}"`).join(' + ');

  const config = descriptor.buildConfig
    ? descriptor.buildConfig(cells)
    : buildConfigFromPaths(descriptor.columns, cells);

  const validation = input.connector.configSchema.safeParse(config);
  if (!validation.success) {
    return malformed(input.line, describeValidationFailure(input.connector, validation.error), identity);
  }

  if (input.identitiesSeenInFile.has(identity)) {
    return {
      line: input.line,
      slug: null,
      identity,
      config: null,
      verdict: 'duplicate-in-file',
      problem: `${identityColumnList} appears more than once in this file`,
    };
  }
  input.identitiesSeenInFile.add(identity);

  if (input.existingIdentities.has(identity)) {
    return {
      line: input.line,
      slug: null,
      identity,
      config: null,
      verdict: 'already-exists',
      problem: 'A source for this is already configured, so this row was left alone',
    };
  }

  const requestedSlug = (input.rawRow[IMPORT_SLUG_COLUMN] ?? '').trim();
  if (requestedSlug.length > 0 && input.takenSlugs.has(slugify(requestedSlug))) {
    return {
      line: input.line,
      slug: null,
      identity,
      config: null,
      verdict: 'duplicate-in-file',
      problem: `the slug "${requestedSlug}" is already taken`,
    };
  }

  const slug = requestedSlug.length > 0
    ? slugify(requestedSlug).slice(0, MAX_SLUG_LENGTH)
    : uniqueSlug(deriveSlugSeed(input.connector.slug, identityParts[0]!), input.takenSlugs);
  input.takenSlugs.add(slug);

  return {
    line: input.line,
    slug,
    identity,
    config: validation.data as Record<string, unknown>,
    verdict: 'ok',
    problem: null,
  };
}

/**
 * A malformed row, with the reason spelled out for the operator.
 * @param line - File line number.
 * @param problem - What is wrong, naming the column.
 * @param identity - The row's identity value when it got far enough to have one.
 */
function malformed(line: number, problem: string, identity: string | null = null): SourceImportRow {
  return { line, slug: null, identity, config: null, verdict: 'malformed', problem };
}

/**
 * Count each verdict, for the line the dialog shows above the confirm button.
 * @param rows - Every previewed row.
 */
function summarize(rows: SourceImportRow[]): SourceImportSummary {
  const summary: SourceImportSummary = {
    total: rows.length,
    willAdd: 0,
    malformed: 0,
    duplicateInFile: 0,
    alreadyExists: 0,
  };
  for (const row of rows) {
    if (row.verdict === 'ok') {
      summary.willAdd += 1;
    } else if (row.verdict === 'malformed') {
      summary.malformed += 1;
    } else if (row.verdict === 'duplicate-in-file') {
      summary.duplicateInFile += 1;
    } else {
      summary.alreadyExists += 1;
    }
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Cells                                                               */
/* ------------------------------------------------------------------ */

/**
 * Coerce one text cell into the type its column declares.
 *
 * A CSV cell is always text, so `max_pages` arrives as `"20"` and would fail a
 * `z.number()` schema on its way in. Coercing here — rather than loosening the
 * connector schemas to accept strings — keeps the single-add path strict.
 * @param column - The column's declared shape.
 * @param raw - The cell exactly as it came out of the file.
 * @returns The coerced value (undefined when the cell is empty and optional), or the problem.
 */
function parseCell(column: BulkImportColumn, raw: string): { value: unknown; problem: string | null } {
  const text = raw.trim();
  if (text.length === 0) {
    if (column.required) {
      return { value: undefined, problem: `"${column.column}" is required` };
    }
    return { value: undefined, problem: null };
  }

  if (column.type === 'number') {
    const parsedNumber = Number(text);
    if (!Number.isFinite(parsedNumber)) {
      return { value: undefined, problem: `"${column.column}" must be a number, got "${text}"` };
    }
    return { value: parsedNumber, problem: null };
  }

  if (column.type === 'boolean') {
    const truthy = ['true', 'yes', 'y', '1'];
    const falsy = ['false', 'no', 'n', '0'];
    const lowered = text.toLowerCase();
    if (truthy.includes(lowered)) {
      return { value: true, problem: null };
    }
    if (falsy.includes(lowered)) {
      return { value: false, problem: null };
    }
    return { value: undefined, problem: `"${column.column}" must be true or false, got "${text}"` };
  }

  if (column.type === 'list') {
    const values = text
      .split(LIST_CELL_SEPARATOR)
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);
    if (values.length === 0) {
      return { value: undefined, problem: `"${column.column}" has no values` };
    }
    return { value: values, problem: null };
  }

  return { value: text, problem: null };
}

/**
 * Assemble a config object by writing each cell at its column's dotted path.
 *
 * The default for connectors whose config is a flat bag of settings. Columns
 * with no `configPath` are skipped — those exist for a `buildConfig` to read.
 * @param columns - The descriptor's columns.
 * @param cells - Coerced cell values, keyed by column name.
 */
function buildConfigFromPaths(
  columns: BulkImportColumn[],
  cells: Record<string, unknown>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const column of columns) {
    const value = cells[column.column];
    if (value === undefined || !column.configPath) {
      continue;
    }
    writeAtPath(config, column.configPath, value);
  }
  return config;
}

/**
 * Write a value into a nested object at a dotted path, creating objects on the way.
 * @param target - Object to write into.
 * @param path - Dotted path, e.g. `crawl.maxPages`.
 * @param value - Value to set at the leaf.
 */
function writeAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (typeof existing !== 'object' || existing === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

/**
 * Read a value out of a nested object at a dotted path.
 * @param source - Object to read from.
 * @param path - Dotted path, e.g. `crawl.startUrl`.
 * @returns The value, or undefined when any segment is missing.
 */
function readAtPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Turn a schema rejection into a sentence that names the CSV column.
 *
 * Zod reports the config path it rejected (`crawl.maxPages`), which is not what
 * the operator typed into. The descriptor is walked backwards to find the
 * column that writes that path; when nothing maps — a schema-level refinement,
 * say — the raw path is reported rather than a guess.
 * @param connector - Connector whose schema rejected the row.
 * @param error - The Zod error to describe.
 * @param error.issues
 */
function describeValidationFailure(connector: SourceConnector, error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const descriptor = requireDescriptor(connector);
  const issue = error.issues[0];
  if (!issue) {
    return 'that row is not valid for this source type';
  }
  const configPath = issue.path.map(segment => String(segment)).join('.');
  const column = descriptor.columns.find(candidate => candidate.configPath === configPath);
  if (column) {
    return `"${column.column}" is not valid: ${issue.message.toLowerCase()}`;
  }
  if (configPath.length === 0) {
    return issue.message;
  }
  return `${configPath} is not valid: ${issue.message.toLowerCase()}`;
}

/* ------------------------------------------------------------------ */
/* Identity + slugs                                                    */
/* ------------------------------------------------------------------ */

/**
 * The identity value stored in an existing source's config.
 *
 * Used to tell that an uploaded row names a source that is already configured.
 * @param connector - Connector the config belongs to.
 * @param config - A stored `config_json` blob.
 * @returns The normalized identity, or null when the config has none.
 */
export function readIdentity(connector: SourceConnector, config: Record<string, unknown>): string | null {
  const parts = readIdentityParts(connector, config);
  return parts === null ? null : joinIdentity(parts);
}

/**
 * The identity parts stored in an existing source's config, before joining.
 *
 * Exposed separately because the single-add path names a source from the first
 * part alone (the URL, not the URL plus the project keys).
 * @param connector - Connector the config belongs to.
 * @param config - A stored `config_json` blob.
 * @returns One normalized part per identity column, or null when the config has none.
 */
export function readIdentityParts(connector: SourceConnector, config: Record<string, unknown>): string[] | null {
  const descriptor = requireDescriptor(connector);

  if (descriptor.identityFromConfig) {
    const rawParts = descriptor.identityFromConfig(config);
    if (rawParts === null) {
      return null;
    }
    const normalized = rawParts
      .map(part => identityPartFromCell(part))
      .filter((part): part is string => part !== null);
    return normalized.length > 0 ? normalized : null;
  }

  const parts: string[] = [];
  for (const [position, columnName] of descriptor.identityColumns.entries()) {
    const column = descriptor.columns.find(candidate => candidate.column === columnName);
    if (!column?.configPath) {
      return null;
    }
    const part = identityPartFromCell(readAtPath(config, column.configPath));
    if (part !== null) {
      parts.push(part);
      continue;
    }
    // Same rule as reading a row: an absent later part is the empty value, an
    // absent first part means this config names no source at all.
    if (position === 0) {
      return null;
    }
    parts.push('');
  }
  return parts;
}

/**
 * One identity part, in the form two spellings of the same thing share.
 *
 * A list-valued cell (Jira's project keys) is order-insensitive: the same two
 * projects listed in either order name the same source.
 * @param cell - A coerced cell value, or a value read back out of a config.
 * @returns The normalized part, or null when the value carries no identity.
 */
function identityPartFromCell(cell: unknown): string | null {
  if (typeof cell === 'string' && cell.trim().length > 0) {
    return normalizeIdentity(cell);
  }
  if (Array.isArray(cell) && cell.length > 0) {
    const entries = cell
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => normalizeIdentity(entry))
      .sort();
    return entries.length > 0 ? entries.join(',') : null;
  }
  return null;
}

/**
 * Join identity parts into the single string the preview compares on.
 *
 * The separator is a character that cannot appear in a normalized part, so two
 * different splits can never collide into the same identity.
 * @param parts - Normalized identity parts, in identity-column order.
 */
function joinIdentity(parts: string[]): string {
  return parts.join('|');
}

/**
 * Put an identity value into the one form two spellings of the same thing share.
 *
 * `https://Docs.Example.com/guide/` and `https://docs.example.com/guide` name
 * the same page, and a re-import of the same file must recognise that.
 * @param value - The raw identity value.
 */
export function normalizeIdentity(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    // Not a URL — a Slack channel id, a Drive query, a calendar id. Case still
    // should not create a second copy of the same source.
    return trimmed.toLowerCase();
  }
}

/**
 * The slug a row starts from before uniquifying: connector plus a readable
 * name taken from the identity.
 *
 * A URL contributes its host and path, so fifty pages on one host produce fifty
 * different seeds instead of fifty copies of `web-docs-example-com` — the host
 * alone is what used to collapse them into a single source.
 * @param connectorSlug - The connector's slug, used as the prefix.
 * @param identity - The row's normalized identity value.
 */
export function deriveSlugSeed(connectorSlug: string, identity: string): string {
  let readable = identity;
  try {
    const url = new URL(identity);
    readable = `${url.host}${url.pathname}`;
  } catch {
    // Not a URL; slugify the value as it stands.
  }
  const slugified = slugify(readable);
  const seed = slugified.length > 0 ? `${connectorSlug}-${slugified}` : connectorSlug;
  return seed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
}

/**
 * The first free slug at or after `seed`, suffixing `-2`, `-3`, … on collision.
 *
 * The suffix is applied inside the length cap, so a long seed loses characters
 * rather than producing an over-length slug the column would reject.
 * @param seed - Preferred slug.
 * @param taken - Slugs already in use.
 */
export function uniqueSlug(seed: string, taken: Set<string>): string {
  if (!taken.has(seed)) {
    return seed;
  }
  for (let attempt = 2; ; attempt += 1) {
    const suffix = `-${attempt}`;
    const candidate = `${seed.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Reduce arbitrary text to slug characters: lower case, words joined by dashes.
 * @param value - Text to slugify.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * The connector's descriptor, or a thrown error naming the connector.
 *
 * Every entry point here is reached only for a connector the caller already
 * checked, so a miss is a programming mistake rather than bad user input.
 * @param connector - Connector to read the descriptor from.
 */
function requireDescriptor(connector: SourceConnector) {
  if (!connector.bulkImport) {
    throw new Error(`Connector "${connector.slug}" does not support bulk import`);
  }
  return connector.bulkImport;
}

/**
 * Whether a parsed CSV row holds nothing at all, so it can be ignored.
 *
 * Trailing newlines and blank spacer rows are normal in a spreadsheet export
 * and should not count against the row limit or show up as malformed.
 * @param row - A parsed row.
 */
function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every(cell => cell.trim().length === 0);
}

/**
 * Render a byte count as whole megabytes for a limit message.
 * @param bytes - The limit in bytes.
 */
function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576)} MB`;
}
