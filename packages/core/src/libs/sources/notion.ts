/**
 * Notion connector — ingest the pages and databases a Notion integration can
 * see as retrievable documents (title, rendered properties, block text).
 *
 * Auth: a Notion internal integration token in `ctx.credentials.token`, sent
 * as a Bearer header. Like every other connector here the token comes from the
 * credential vault (`npm run set-credential -- --source notion --token …`),
 * never from an env var. Notion scopes an integration by explicit sharing, so
 * "what syncs" is decided in Notion's UI by sharing pages with the
 * integration — this connector deliberately has no allow-list config to
 * duplicate that decision badly.
 *
 * Discovery rides `POST /v1/search`, which returns every page and database
 * shared with the integration. The `filter.property = 'object'` values changed
 * meaning across API versions (`database` before 2025-09-03, `data_source`
 * after), so this connector sends no object filter at all and branches on
 * `result.object` instead — that behaves identically on every version. The
 * `Notion-Version` header is config (`notionVersion`), defaulting to the
 * long-stable `2022-06-28`.
 *
 * Incremental (`ctx.since` set): search sorts by `last_edited_time` descending
 * and the walk stops at the first result older than the watermark. Notion's
 * search has no server-side timestamp filter, so descending-plus-early-stop is
 * the cheapest correct incremental strategy available. Full sync (`ctx.since`
 * null — backfill and the reconcile schedule) sorts ascending and walks every
 * page, so the tombstone pass can prune anything unshared or trashed upstream.
 *
 * Page bodies come from `GET /v1/blocks/{id}/children`, recursed to
 * `MAX_BLOCK_DEPTH` levels and capped at `MAX_BLOCK_REQUESTS_PER_PAGE`
 * requests per document. A page that hits either bound is still emitted, with
 * `metadata.contentTruncated = true` and an `onProgress({ kind: 'skipped' })`
 * report — better a partial document that says so than a silent one.
 *
 * Chunking, embedding and dedup are handled downstream by IngestionService.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const API_ROOT = 'https://api.notion.com/v1';
/** Pinned by default: the oldest version whose page/database shapes this code reads. */
const DEFAULT_NOTION_VERSION = '2022-06-28';
const DEFAULT_PAGE_SIZE = 100;
/** How many `next_cursor` search pages one sync may walk before bailing out. */
const MAX_SEARCH_PAGES = 200;
/** How deep into a page's block tree to recurse (toggles, list nesting, columns). */
const MAX_BLOCK_DEPTH = 3;
/** Per-document ceiling on block requests, so one enormous page cannot stall a sync. */
const MAX_BLOCK_REQUESTS_PER_PAGE = 30;
const MAX_RETRIES = 5;

const notionConfigSchema = z.object({
  /**
   * `Notion-Version` header sent on every request. Bump this deliberately —
   * newer versions rename `database` to `data_source` in some payloads.
   */
  notionVersion: z.string().min(1).default(DEFAULT_NOTION_VERSION),
  /** Optional search term. Empty (the default) means everything shared with the integration. */
  query: z.string().default(''),
  /** Emit a document per shared page. */
  includePages: z.boolean().default(true),
  /** Emit a document per shared database (its title + description, not its rows). */
  includeDatabases: z.boolean().default(true),
  /** Render a page's non-title properties as `Name: value` lines above the body. */
  includeProperties: z.boolean().default(true),
  /** Results requested per search page. Notion caps this at 100. */
  pageSize: z.number().int().positive().max(100).default(DEFAULT_PAGE_SIZE),
});

type RichText = { plain_text?: string };

type NotionProperty = {
  type?: string;
  title?: RichText[];
  rich_text?: RichText[];
  select?: { name?: string } | null;
  status?: { name?: string } | null;
  multi_select?: { name?: string }[];
  number?: number | null;
  checkbox?: boolean;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  date?: { start?: string | null; end?: string | null } | null;
  people?: { name?: string }[];
  created_time?: string;
  last_edited_time?: string;
};

type NotionPage = {
  object: 'page';
  id: string;
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  parent?: { type?: string; page_id?: string; database_id?: string; data_source_id?: string; workspace?: boolean };
  properties?: Record<string, NotionProperty>;
};

type NotionDatabase = {
  /** `database` up to API version 2022-06-28; `data_source` on 2025-09-03 and later. */
  object: 'database' | 'data_source';
  id: string;
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  title?: RichText[];
  description?: RichText[];
};

type SearchResult = NotionPage | NotionDatabase | { object: string; id: string };
type SearchPage = { results?: SearchResult[]; next_cursor?: string | null; has_more?: boolean };

type NotionBlock = {
  id: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
};
type BlockPage = { results?: NotionBlock[]; next_cursor?: string | null; has_more?: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Concatenate a Notion `rich_text` array into plain text. */
export function richTextToPlain(rich: RichText[] | undefined | null): string {
  return (rich ?? []).map(r => r.plain_text ?? '').join('').trim();
}

/**
 * Render one page property as display text. Unhandled property types (rollups,
 * formulas, relations, files) return an empty string and are dropped by the
 * caller rather than rendered as `[object Object]`.
 * @param prop - One entry from a page's `properties` map.
 */
export function propertyToText(prop: NotionProperty | undefined): string {
  if (!prop) {
    return '';
  }
  switch (prop.type) {
    case 'title':
      return richTextToPlain(prop.title);
    case 'rich_text':
      return richTextToPlain(prop.rich_text);
    case 'select':
      return prop.select?.name ?? '';
    case 'status':
      return prop.status?.name ?? '';
    case 'multi_select':
      return (prop.multi_select ?? []).map(o => o.name ?? '').filter(Boolean).join(', ');
    case 'number':
      return prop.number === null || prop.number === undefined ? '' : String(prop.number);
    case 'checkbox':
      return prop.checkbox ? 'yes' : 'no';
    case 'url':
      return prop.url ?? '';
    case 'email':
      return prop.email ?? '';
    case 'phone_number':
      return prop.phone_number ?? '';
    case 'date':
      return [prop.date?.start, prop.date?.end].filter(Boolean).join(' → ');
    case 'people':
      return (prop.people ?? []).map(p => p.name ?? '').filter(Boolean).join(', ');
    case 'created_time':
      return prop.created_time ?? '';
    case 'last_edited_time':
      return prop.last_edited_time ?? '';
    default:
      return '';
  }
}

/**
 * A page's human title — the value of whichever property has type `title`.
 * Database rows name that property freely ("Name", "Task", "Company"), so it
 * cannot be looked up by key.
 * @param page - A Notion page object from search.
 */
export function pageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop?.type === 'title') {
      const text = richTextToPlain(prop.title);
      if (text !== '') {
        return text;
      }
    }
  }
  return 'Untitled';
}

/**
 * Flatten one block to a line of text. Every block type that carries a
 * `rich_text` array is handled generically; the few that do not (code,
 * to-do checkboxes, child pages/databases, equations) get a shape each.
 * @param block - One block from `/v1/blocks/{id}/children`.
 */
export function blockToText(block: NotionBlock): string {
  const type = block.type ?? '';
  const payload = block[type] as
    | { rich_text?: RichText[]; title?: string; checked?: boolean; language?: string; expression?: string; url?: string; caption?: RichText[] }
    | undefined;
  if (!payload) {
    return '';
  }
  const text = richTextToPlain(payload.rich_text);
  switch (type) {
    case 'child_page':
    case 'child_database':
      return payload.title ?? '';
    case 'to_do':
      return text === '' ? '' : `[${payload.checked ? 'x' : ' '}] ${text}`;
    case 'bulleted_list_item':
    case 'numbered_list_item':
      return text === '' ? '' : `- ${text}`;
    case 'heading_1':
      return text === '' ? '' : `# ${text}`;
    case 'heading_2':
      return text === '' ? '' : `## ${text}`;
    case 'heading_3':
      return text === '' ? '' : `### ${text}`;
    case 'code':
      return text === '' ? '' : `\`\`\`${payload.language ?? ''}\n${text}\n\`\`\``;
    case 'equation':
      return payload.expression ?? '';
    case 'image':
    case 'video':
    case 'file':
    case 'pdf':
      return richTextToPlain(payload.caption);
    default:
      return text;
  }
}

/**
 * Fetch with Notion-appropriate failure handling: honour `Retry-After` on 429
 * (Notion rate-limits at roughly three requests a second per integration), and
 * fail actionably on 401/403 — an unshared page or a revoked token is never
 * fixed by retrying.
 */
async function notionFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status === 401) {
      throw new Error(
        'Notion rejected the token (401). The integration token may be revoked — reconnect the Notion source with a fresh internal integration token from notion.so/my-integrations.',
      );
    }
    if (res.status === 403) {
      throw new Error(
        `Notion refused the request (403). The integration lacks access — share the pages or databases with it from Notion's "Connections" menu.`,
      );
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Notion request failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    return res;
  }
}

/**
 * Read a page's block tree as plain text, bounded in both depth and request
 * count. Returns the text plus whether either bound cut the read short.
 */
async function readPageBlocks(
  blockId: string,
  headers: Record<string, string>,
  budget: { requests: number },
  depth = 0,
): Promise<{ text: string; truncated: boolean }> {
  if (depth >= MAX_BLOCK_DEPTH) {
    return { text: '', truncated: true };
  }
  const lines: string[] = [];
  let truncated = false;
  let cursor: string | null | undefined;
  do {
    if (budget.requests >= MAX_BLOCK_REQUESTS_PER_PAGE) {
      return { text: lines.join('\n'), truncated: true };
    }
    budget.requests += 1;
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) {
      params.set('start_cursor', cursor);
    }
    const res = await notionFetch(`${API_ROOT}/blocks/${blockId}/children?${params.toString()}`, { headers });
    const body = (await res.json()) as BlockPage;
    for (const block of body.results ?? []) {
      const line = blockToText(block);
      if (line !== '') {
        lines.push(line);
      }
      // `child_page` children are their own document — search returns them separately.
      if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
        const nested = await readPageBlocks(block.id, headers, budget, depth + 1);
        if (nested.text !== '') {
          lines.push(nested.text);
        }
        truncated = truncated || nested.truncated;
      }
    }
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return { text: lines.join('\n'), truncated };
}

/**
 * Render a page's non-title properties as `Name: value` lines. The title
 * property is excluded because it is already the document title, and property
 * types this connector does not render are dropped rather than stringified.
 * @param page - A Notion page object from search.
 */
export function renderProperties(page: NotionPage): string[] {
  const lines: string[] = [];
  for (const [name, prop] of Object.entries(page.properties ?? {})) {
    if (prop?.type === 'title') {
      continue;
    }
    const value = propertyToText(prop);
    if (value !== '') {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines;
}

function isDatabase(result: SearchResult): result is NotionDatabase {
  return result.object === 'database' || result.object === 'data_source';
}

function isPage(result: SearchResult): result is NotionPage {
  return result.object === 'page';
}

function databaseToDoc(db: NotionDatabase): IngestDoc {
  const title = richTextToPlain(db.title) || 'Untitled database';
  const description = richTextToPlain(db.description);
  return {
    externalId: `notion-database:${db.id}`,
    title,
    content: [title, description].filter(Boolean).join('\n'),
    uri: db.url,
    lastModifiedAt: db.last_edited_time ? new Date(db.last_edited_time) : null,
    metadata: {
      type: 'database',
      notionId: db.id,
      notionObject: db.object,
      created: db.created_time,
      updated: db.last_edited_time,
    },
  };
}

export const notionConnector: SourceConnector<typeof notionConfigSchema> = {
  slug: 'notion',
  name: 'Notion',
  description: 'Ingest the Notion pages and databases shared with an integration — title, properties and block text.',
  icon: 'NotebookText',
  authKind: 'apikey',
  configSchema: notionConfigSchema,
  defaultReconcileCron: '0 4 * * *',
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = notionConfigSchema.parse(ctx.config);
    const token = (ctx.credentials?.token ?? ctx.credentials?.apiToken) as string | undefined;
    if (!token) {
      throw new Error('Notion connector requires credentials.token (an internal integration token from notion.so/my-integrations).');
    }
    const headers = {
      'authorization': `Bearer ${token}`,
      'notion-version': cfg.notionVersion,
      'accept': 'application/json',
      'content-type': 'application/json',
    };

    // Incremental walks newest-first and stops at the watermark; a full sync
    // walks oldest-first so the tombstone pass sees the whole shared set.
    const direction = ctx.since ? 'descending' : 'ascending';
    let cursor: string | null | undefined;

    for (let page = 0; ; page += 1) {
      if (page >= MAX_SEARCH_PAGES) {
        // Partial progress is kept (ingestion is per-document); the next run resumes from the new watermark.
        ctx.onProgress?.({
          kind: 'error',
          message: `Notion sync stopped at the ${MAX_SEARCH_PAGES}-page cap (~${MAX_SEARCH_PAGES * cfg.pageSize} objects); the rest will land on subsequent runs.`,
        });
        break;
      }
      const res = await notionFetch(`${API_ROOT}/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...(cfg.query === '' ? {} : { query: cfg.query }),
          sort: { timestamp: 'last_edited_time', direction },
          page_size: cfg.pageSize,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      const body = (await res.json()) as SearchPage;
      let reachedWatermark = false;

      for (const result of body.results ?? []) {
        const record = result as NotionPage | NotionDatabase;
        if (record.archived === true || record.in_trash === true) {
          continue;
        }
        if (ctx.since && record.last_edited_time) {
          if (new Date(record.last_edited_time).getTime() < ctx.since.getTime()) {
            // Descending order: everything after this is older still.
            reachedWatermark = true;
            break;
          }
        }
        if (isDatabase(record)) {
          if (!cfg.includeDatabases) {
            continue;
          }
          ctx.onProgress?.({ kind: 'fetched', uri: record.url ?? record.id });
          yield databaseToDoc(record);
          continue;
        }
        if (!isPage(record)) {
          continue;
        }
        if (!cfg.includePages) {
          continue;
        }

        const title = pageTitle(record);
        const propertyLines = cfg.includeProperties ? renderProperties(record) : [];
        const blocks = await readPageBlocks(record.id, headers, { requests: 0 });
        if (blocks.truncated) {
          ctx.onProgress?.({
            kind: 'skipped',
            uri: record.url ?? record.id,
            message: `Notion page "${title}" was ingested partially — it exceeded the ${MAX_BLOCK_DEPTH}-level / ${MAX_BLOCK_REQUESTS_PER_PAGE}-request read budget.`,
          });
        } else {
          ctx.onProgress?.({ kind: 'fetched', uri: record.url ?? record.id });
        }

        yield {
          externalId: `notion:${record.id}`,
          title,
          content: [title, ...propertyLines, blocks.text].filter(Boolean).join('\n'),
          uri: record.url,
          lastModifiedAt: record.last_edited_time ? new Date(record.last_edited_time) : null,
          metadata: {
            type: 'page',
            notionId: record.id,
            parentType: record.parent?.type,
            parentId: record.parent?.database_id ?? record.parent?.data_source_id ?? record.parent?.page_id ?? null,
            contentTruncated: blocks.truncated,
            created: record.created_time,
            updated: record.last_edited_time,
          },
        };
      }

      if (reachedWatermark || !body.has_more || !body.next_cursor) {
        break;
      }
      cursor = body.next_cursor;
    }
  },
};
