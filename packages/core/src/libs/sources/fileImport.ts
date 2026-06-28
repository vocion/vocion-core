/**
 * file-import connector — ingest a single structured-data file as
 * documents. Handles JSONL, JSON (array), and CSV (header row).
 *
 * Designed for the "drop your data here" case before a real upstream
 * (Zendesk OAuth, HubSpot API, etc.) is wired. Same `SourceConnector`
 * shape, same ingest pipeline, same retrieval — only the data origin
 * differs.
 *
 * Smart-defaults field mapping:
 *   - externalId      ← id / ticket_id / uuid / key / case_id
 *   - title           ← subject / title / summary / name
 *   - content         ← body / content / text / description / message
 *   - lastModifiedAt  ← received_at / updated_at / created_at / timestamp
 *   - uri             ← link / url / permalink
 *   - everything else → metadata
 *
 * Override via `fieldMapping` in the source YAML when columns don't
 * match the heuristic.
 *
 * Pre-computed embeddings: if a row carries an `embedding` field
 * (e.g. a JSONL fixture where vectors were baked in at generate time),
 * the connector passes it through on the `IngestDoc` so
 * `IngestionService.ingestDocument` skips chunking + the OpenAI embed
 * call. This is how the support-reply demo's 5,000-ticket JSONL works
 * end-to-end without an OPENAI_API_KEY.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import Papa from 'papaparse';
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Config schema                                                       */
/* ------------------------------------------------------------------ */

const FieldMappingValue = z.union([z.string(), z.array(z.string())]);

export const fileImportConfigSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('file path, relative to WORKSPACE_PATH or absolute'),
  format: z
    .enum(['auto', 'jsonl', 'csv', 'json'])
    .default('auto')
    .describe('format detection — auto picks by extension (.jsonl/.ndjson → jsonl, .csv → csv, .json → json)'),
  fieldMapping: z
    .record(z.string(), FieldMappingValue)
    .optional()
    .describe('map IngestDoc fields to row keys. Array value = concat multiple columns with newline.'),
  csvOptions: z
    .object({
      delimiter: z.string().default(','),
      header: z.boolean().default(true),
    })
    .optional(),
});

export type FileImportConfig = z.infer<typeof fileImportConfigSchema>;

/* ------------------------------------------------------------------ */
/* Smart-default field mapping                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_KEYS = {
  externalId: ['id', 'ticket_id', 'uuid', 'key', 'case_id'],
  title: ['subject', 'title', 'summary', 'name'],
  content: ['body', 'content', 'text', 'description', 'message'],
  lastModifiedAt: ['received_at', 'updated_at', 'created_at', 'timestamp'],
  uri: ['link', 'url', 'permalink'],
} as const;

/* ------------------------------------------------------------------ */
/* Connector                                                            */
/* ------------------------------------------------------------------ */

export const fileImportConnector: SourceConnector<typeof fileImportConfigSchema> = {
  slug: 'file-import',
  name: 'File import',
  description: 'Ingest a single JSONL / CSV / JSON file as documents. Smart-detects columns; override via fieldMapping when needed.',
  icon: 'FileJson',
  authKind: 'none',
  configSchema: fileImportConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = fileImportConfigSchema.parse(ctx.config);
    const filePath = resolvePath(cfg.path);

    try {
      const s = await stat(filePath);
      if (!s.isFile()) {
        ctx.onProgress?.({ kind: 'error', uri: filePath, message: 'not a file' });
        return;
      }
    } catch (err) {
      ctx.onProgress?.({ kind: 'error', uri: filePath, message: `file not accessible: ${(err as Error).message}` });
      return;
    }

    const format = cfg.format === 'auto' ? detectFormat(filePath) : cfg.format;
    if (!format) {
      ctx.onProgress?.({ kind: 'error', uri: filePath, message: `cannot detect format for ${path.basename(filePath)} — set format: jsonl|csv|json in config` });
      return;
    }

    const rows = format === 'jsonl'
      ? readJsonl(filePath, ctx)
      : format === 'csv'
        ? await readCsv(filePath, cfg.csvOptions)
        : await readJsonArray(filePath, ctx);

    for await (const row of rows) {
      const doc = rowToIngestDoc(row, cfg.fieldMapping);
      if (!doc) {
        ctx.onProgress?.({ kind: 'skipped', uri: filePath, message: 'row missing required content field' });
        continue;
      }
      ctx.onProgress?.({ kind: 'fetched', uri: doc.externalId });
      yield doc;
    }
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function resolvePath(p: string): string {
  if (path.isAbsolute(p)) {
    return p;
  }
  return path.resolve(process.env.WORKSPACE_PATH ?? process.cwd(), p);
}

function detectFormat(filePath: string): 'jsonl' | 'csv' | 'json' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jsonl' || ext === '.ndjson') {
    return 'jsonl';
  }
  if (ext === '.csv' || ext === '.tsv') {
    return 'csv';
  }
  if (ext === '.json') {
    return 'json';
  }
  return null;
}

async function* readJsonl(filePath: string, ctx: SourceContext): AsyncIterable<Record<string, unknown>> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      // Skip the sentinel header line if present.
      if (lineNo === 1 && obj._meta) {
        continue;
      }
      yield obj;
    } catch (err) {
      ctx.onProgress?.({ kind: 'error', uri: `${filePath}:${lineNo}`, message: `JSONL parse error: ${(err as Error).message}` });
    }
  }
}

async function readCsv(
  filePath: string,
  opts: FileImportConfig['csvOptions'],
): Promise<Record<string, unknown>[]> {
  const text = await readFile(filePath, 'utf8');
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: opts?.header ?? true,
    delimiter: opts?.delimiter ?? ',',
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return parsed.data;
}

async function readJsonArray(filePath: string, ctx: SourceContext): Promise<Record<string, unknown>[]> {
  const text = await readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    ctx.onProgress?.({ kind: 'error', uri: filePath, message: `JSON parse error: ${(err as Error).message}` });
    return [];
  }
  if (!Array.isArray(parsed)) {
    ctx.onProgress?.({ kind: 'error', uri: filePath, message: 'JSON file must be an array of objects' });
    return [];
  }
  return parsed as Record<string, unknown>[];
}

/* ------------------------------------------------------------------ */
/* Row → IngestDoc                                                      */
/* ------------------------------------------------------------------ */

function rowToIngestDoc(
  row: Record<string, unknown>,
  override: FileImportConfig['fieldMapping'],
): IngestDoc | null {
  const mapped = {
    externalId: pickField(row, override?.externalId, DEFAULT_KEYS.externalId),
    title: pickField(row, override?.title, DEFAULT_KEYS.title),
    content: pickField(row, override?.content, DEFAULT_KEYS.content),
    lastModifiedAt: pickField(row, override?.lastModifiedAt, DEFAULT_KEYS.lastModifiedAt),
    uri: pickField(row, override?.uri, DEFAULT_KEYS.uri),
  };

  if (!mapped.content || typeof mapped.content !== 'string' || !mapped.content.trim()) {
    return null;
  }

  // Pre-computed embedding pass-through. Demo JSONLs ship vectors so
  // sync completes without OpenAI calls.
  const embedding = Array.isArray(row.embedding) && row.embedding.every(n => typeof n === 'number')
    ? row.embedding as number[]
    : undefined;

  // Build metadata from everything not consumed by the canonical fields.
  const usedKeys = new Set<string>();
  for (const k of Object.values(DEFAULT_KEYS).flat()) {
    usedKeys.add(k);
  }
  for (const v of Object.values(override ?? {})) {
    if (typeof v === 'string') {
      usedKeys.add(v);
    } else if (Array.isArray(v)) {
      v.forEach(s => usedKeys.add(s));
    }
  }
  usedKeys.add('embedding');
  usedKeys.add('_meta');
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!usedKeys.has(k) && v !== undefined && v !== null) {
      metadata[k] = v;
    }
  }

  const externalId = mapped.externalId && typeof mapped.externalId === 'string'
    ? mapped.externalId
    : `row-${hashContent(mapped.content as string)}`;

  return {
    externalId,
    content: mapped.content as string,
    title: typeof mapped.title === 'string' ? mapped.title : undefined,
    uri: typeof mapped.uri === 'string' ? mapped.uri : undefined,
    lastModifiedAt: parseDate(mapped.lastModifiedAt),
    metadata,
    embedding,
  };
}

function pickField(
  row: Record<string, unknown>,
  override: string | readonly string[] | undefined,
  defaults: readonly string[],
): unknown {
  if (override) {
    if (typeof override === 'string') {
      return row[override];
    }
    // Array override = concat columns with newline.
    const parts = override.map(k => row[k]).filter(v => v !== undefined && v !== null);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.map(p => String(p)).join('\n\n');
  }
  for (const k of defaults) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      return row[k];
    }
  }
  return undefined;
}

function parseDate(v: unknown): Date | null {
  if (!v) {
    return null;
  }
  if (v instanceof Date) {
    return v;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function hashContent(s: string): string {
  // Cheap stable hash for fallback externalIds when source rows omit ids.
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
