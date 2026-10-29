/**
 * The Keywords register — `seo_keyword`, one row per keyword per client
 * project, so keyword research outlives the chat it was done in.
 *
 * Code writes every row, never the model's memory:
 *
 *   - the research tools (`serp_search`, `keyword_cluster`, `keyword_metrics`,
 *     `serp_compare`) hand what they read to `keepKeywords`, which upserts on
 *     the project and the keyword as it is compared (`keywordKey`): a second
 *     read refreshes the row's results, volume and dates, never adds one;
 *   - every write to a project's pages ends in `refreshSeoProject`, which calls
 *     `syncProjectKeywords`: each planned page's keyword is in the register,
 *     linked to its batch and page, and its status follows the page (in a
 *     batch, published, dropped when the page is discarded);
 *   - a person or the strategist adds the why, or drops a keyword, through
 *     `updateKeywords`, and the note carries its date.
 *
 * Nothing that can go stale is kept without its date: the results carry
 * `serpCheckedAt`, the volume `metricsCheckedAt`, the cluster
 * `clusterCheckedAt`, and the why its `at`. The SERP brief stays on the page;
 * a row links to it (`serpArtifactId`).
 */

import type { PlannedPage, SeoBatchRecord, SeoPageRecord, SeoPageStatus } from './records';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { getObjectTypeBySlug } from '@/services/BusinessObjectService';
import { readSeoProject } from './projects';
import { keywordKey, mergeMeta } from './records';

export const SEO_KEYWORD_TYPE = 'seo_keyword';

export const SEO_KEYWORD_STATUSES = ['idea', 'in_batch', 'published', 'ranking', 'dropped'] as const;
export type SeoKeywordStatus = typeof SEO_KEYWORD_STATUSES[number];

/** Where a keyword was first researched. */
export const SEO_KEYWORD_SOURCES = ['chat', 'weekly', 'imported'] as const;
export type SeoKeywordSource = typeof SEO_KEYWORD_SOURCES[number];

export const KEYWORD_STATUS_LABELS: Record<SeoKeywordStatus, string> = { idea: 'Idea', in_batch: 'In a batch', published: 'Published', ranking: 'Ranking', dropped: 'Dropped' };

/** The external key a row is held under: one per project and compared keyword, enforced by the database. */
export const KEYWORD_EXTERNAL_SYSTEM = 'seo-keyword';

/** Google results kept on a row, best first. */
export const TOP_RESULTS_KEPT = 10;

export type KeywordResult = { position: number; url: string; title: string };

export type SeoKeywordMeta = {
  projectId: number;
  projectName?: string;
  keyword: string;
  keywordKey: string;
  intent?: string;
  volume?: number;
  competition?: 'low' | 'medium' | 'high';
  competitionIndex?: number;
  cpc?: number;
  metricsCheckedAt?: string;
  location?: string;
  language?: string;
  cluster?: string;
  clusterCheckedAt?: string;
  topResults?: KeywordResult[];
  serpCheckedAt?: string;
  clientPosition?: number;
  clientUrl?: string;
  /** The latest of the dates above: the Checked column. */
  checkedAt?: string;
  status: SeoKeywordStatus;
  statusLabel?: string;
  batchId?: number;
  batchTitle?: string;
  pageId?: number;
  serpArtifactId?: number;
  publishedUrl?: string;
  source: SeoKeywordSource;
  why?: { text: string; at: string; by: string | null };
};

export type SeoKeywordRecord = { id: number; title: string; meta: SeoKeywordMeta };

/** What one read established about a keyword. Each part carries the time it was read. */
export type KeywordResearch = {
  keyword: string;
  serp?: { checkedAt: string; results: Array<KeywordResult & { domain?: string }>; location?: string; language?: string };
  metrics?: { checkedAt: string; volume: number | null; competition: string | null; competitionIndex: number | null; cpc: number | null; location?: string; language?: string };
  cluster?: { head: string; checkedAt: string };
};

/** Something that moves a keyword's status. */
export type KeywordEvent
  = | { kind: 'page'; pageStatus: SeoPageStatus }
    | { kind: 'unplanned' }
    | { kind: 'serp'; clientPosition: number | null }
    | { kind: 'drop' }
    | { kind: 'restore' };

/**
 * A keyword's status after an event, or a refusal in words. Pure.
 *
 * Its page leads while it has one: a page in progress puts it in a batch
 * (again, after a drop), a published page publishes it, a discarded page
 * drops it. A Google read moves a published keyword to ranking when the
 * client's site shows in the results, and back when it does not. A keyword
 * whose page is in a batch is not dropped here: its page is discarded on its
 * sign-off, and the keyword follows.
 * @param current - The status now.
 * @param event - What happened.
 */
export function nextKeywordStatus(current: SeoKeywordStatus, event: KeywordEvent): SeoKeywordStatus | { refused: string } {
  switch (event.kind) {
    case 'page':
      if (event.pageStatus === 'rejected') {
        return 'dropped';
      }
      if (event.pageStatus === 'published') {
        return current === 'ranking' || current === 'dropped' ? current : 'published';
      }
      return 'in_batch';
    case 'unplanned':
      return current === 'in_batch' ? 'idea' : current;
    case 'serp':
      if (current === 'published' && event.clientPosition !== null) {
        return 'ranking';
      }
      return current === 'ranking' && event.clientPosition === null ? 'published' : current;
    case 'drop':
      return current === 'in_batch'
        ? { refused: 'its page is in a batch; discard the page on its sign-off and the keyword is dropped with it' }
        : 'dropped';
    case 'restore':
      return current === 'dropped' ? 'idea' : { refused: `it is ${KEYWORD_STATUS_LABELS[current].toLowerCase()}, not dropped` };
  }
}

/**
 * Whether a URL is on one of the client's domains (or a subdomain of one).
 * @param domain - The result's host, without `www.`.
 * @param clientDomains - The project's domains.
 */
function isClients(domain: string, clientDomains: readonly string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return Boolean(d) && clientDomains.some((c) => {
    const own = c.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    return own !== '' && (d === own || d.endsWith(`.${own}`));
  });
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const later = (a: string | undefined, b: string | undefined): string | undefined => (!a ? b : !b ? a : a >= b ? a : b);

/**
 * What one read writes onto a row: each part only when it is at least as new
 * as what the row holds, the client's position from the results read, the
 * Checked date, and the status a Google read moves. Keys set to `undefined`
 * are removed (`mergeMeta`). Pure.
 * @param current - The row as it stands.
 * @param r - What was read.
 * @param clientDomains - The project's domains, to find the client in the results.
 */
export function researchPatch(current: SeoKeywordMeta, r: KeywordResearch, clientDomains: readonly string[]): Partial<SeoKeywordMeta> {
  const patch: Partial<SeoKeywordMeta> = {};
  if (r.serp && (!current.serpCheckedAt || r.serp.checkedAt >= current.serpCheckedAt)) {
    const results = [...r.serp.results].sort((a, b) => a.position - b.position);
    const own = results.find(x => isClients(x.domain || hostOf(x.url), clientDomains));
    patch.topResults = results.slice(0, TOP_RESULTS_KEPT).map(x => ({ position: x.position, url: x.url, title: x.title }));
    patch.serpCheckedAt = r.serp.checkedAt;
    patch.clientPosition = own?.position;
    patch.clientUrl = own?.url;
    if (r.serp.location) {
      patch.location = r.serp.location;
    }
    if (r.serp.language) {
      patch.language = r.serp.language;
    }
    const status = nextKeywordStatus(current.status, { kind: 'serp', clientPosition: own?.position ?? null });
    if (typeof status === 'string' && status !== current.status) {
      patch.status = status;
      patch.statusLabel = KEYWORD_STATUS_LABELS[status];
    }
  }
  if (r.metrics && (!current.metricsCheckedAt || r.metrics.checkedAt >= current.metricsCheckedAt)) {
    const level = r.metrics.competition?.trim().toLowerCase();
    patch.volume = typeof r.metrics.volume === 'number' ? r.metrics.volume : undefined;
    patch.competition = level === 'low' || level === 'medium' || level === 'high' ? level : undefined;
    patch.competitionIndex = typeof r.metrics.competitionIndex === 'number' ? r.metrics.competitionIndex : undefined;
    patch.cpc = typeof r.metrics.cpc === 'number' ? r.metrics.cpc : undefined;
    patch.metricsCheckedAt = r.metrics.checkedAt;
    if (r.metrics.location && !patch.location && !current.location) {
      patch.location = r.metrics.location;
    }
  }
  if (r.cluster && (!current.clusterCheckedAt || r.cluster.checkedAt >= current.clusterCheckedAt)) {
    patch.cluster = r.cluster.head;
    patch.clusterCheckedAt = r.cluster.checkedAt;
  }
  const checkedAt = [patch.serpCheckedAt, patch.metricsCheckedAt, patch.clusterCheckedAt].reduce(later, current.checkedAt);
  if (checkedAt && checkedAt !== current.checkedAt) {
    patch.checkedAt = checkedAt;
  }
  return patch;
}

/**
 * The reads of one call merged per keyword as it is compared, so a keyword
 * given twice in one call is one row. Pure.
 * @param items - What was read.
 */
export function mergeResearch(items: readonly KeywordResearch[]): Map<string, KeywordResearch> {
  const out = new Map<string, KeywordResearch>();
  for (const item of items) {
    const key = keywordKey(item.keyword);
    if (!key) {
      continue;
    }
    const prev = out.get(key);
    out.set(key, prev ? { keyword: prev.keyword, serp: item.serp ?? prev.serp, metrics: item.metrics ?? prev.metrics, cluster: item.cluster ?? prev.cluster } : { ...item, keyword: item.keyword.trim() });
  }
  return out;
}

/**
 * The pages a plan makes from register rows, in the order given: each
 * keyword with its intent, volume and cluster. Pure.
 * @param rows - The rows chosen.
 */
export function pagesFromKeywords(rows: readonly SeoKeywordRecord[]): PlannedPage[] {
  return rows.map(r => ({
    keyword: r.meta.keyword,
    ...(r.meta.intent ? { intent: r.meta.intent } : {}),
    ...(typeof r.meta.volume === 'number' ? { volume: r.meta.volume } : {}),
    ...(r.meta.cluster ? { cluster: r.meta.cluster } : {}),
  }));
}

const toRow = (row: { id: number; title: string; metadata: unknown }): SeoKeywordRecord => ({ id: row.id, title: row.title, meta: (row.metadata ?? {}) as SeoKeywordMeta });

/**
 * A project's register.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function listProjectKeywords(orgId: string, projectId: number): Promise<SeoKeywordRecord[]> {
  const type = await getObjectTypeBySlug(orgId, SEO_KEYWORD_TYPE);
  if (!type) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), sql`${businessObjectSchema.metadata}->>'projectId' = ${String(projectId)}`));
  return rows.map(toRow).sort((a, b) => a.id - b.id);
}

/**
 * Register rows by id, in the order asked; ids that are not rows here are left out.
 * @param orgId - The workspace.
 * @param ids - Row ids.
 */
export async function getKeywordRows(orgId: string, ids: readonly number[]): Promise<SeoKeywordRecord[]> {
  const type = await getObjectTypeBySlug(orgId, SEO_KEYWORD_TYPE);
  const unique = [...new Set(ids)];
  if (!type || unique.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), inArray(businessObjectSchema.id, unique)));
  const byId = new Map(rows.map(r => [r.id, toRow(r)]));
  return unique.map(id => byId.get(id)).filter((r): r is SeoKeywordRecord => Boolean(r));
}

/**
 * The row for a keyword in a project, made when it is not there yet. The
 * insert gives way to a row another writer made a moment earlier (the unique
 * external key), so two reads at once still leave one row.
 * @param orgId - The workspace.
 * @param typeId - The `seo_keyword` type.
 * @param project - The project.
 * @param project.id - Its id.
 * @param project.title - Its name.
 * @param keyword - The keyword as first written.
 * @param source - Where it was first researched.
 * @param by - Who it is filed as.
 */
async function ensureRow(orgId: string, typeId: number, project: { id: number; title: string }, keyword: string, source: SeoKeywordSource, by: string): Promise<{ id: number; created: boolean }> {
  const key = keywordKey(keyword);
  const externalId = `${project.id}:${key}`;
  const meta: SeoKeywordMeta = { projectId: project.id, projectName: project.title, keyword, keywordKey: key, status: 'idea', statusLabel: KEYWORD_STATUS_LABELS.idea, source };
  const [inserted] = await db
    .insert(businessObjectSchema)
    .values({ orgId, typeId, title: keyword, status: 'active', metadata: meta, externalSystem: KEYWORD_EXTERNAL_SYSTEM, externalId, createdBy: by })
    .onConflictDoNothing({ target: [businessObjectSchema.orgId, businessObjectSchema.externalSystem, businessObjectSchema.externalId] })
    .returning({ id: businessObjectSchema.id, title: businessObjectSchema.title });
  if (inserted) {
    const { announceObjectCreated } = await import('@/services/objects/objectCreated');
    await announceObjectCreated(orgId, inserted, SEO_KEYWORD_TYPE, { source: 'service', actor: by });
    return { id: inserted.id, created: true };
  }
  const [existing] = await db
    .select({ id: businessObjectSchema.id })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.externalSystem, KEYWORD_EXTERNAL_SYSTEM), eq(businessObjectSchema.externalId, externalId)))
    .limit(1);
  return { id: existing!.id, created: false };
}

export type KeptKeywords = {
  project: { id: number; title: string };
  rows: Array<{ id: number; keyword: string; created: boolean; status: SeoKeywordStatus; clientPosition?: number }>;
};

/**
 * Keep what was researched in the project's register: one row per keyword,
 * made the first time, refreshed every time after (results, volume, cluster
 * and their dates). Null when the workspace has no register (the SEO app is
 * off) or the project is not one here.
 * @param orgId - The workspace.
 * @param projectId - The client's project.
 * @param items - What was read.
 * @param opts - Who and where from.
 * @param opts.source - Where a new row was researched (an existing row keeps its own).
 * @param opts.by - Who the rows are filed as.
 */
export async function keepKeywords(orgId: string, projectId: number, items: readonly KeywordResearch[], opts: { source: SeoKeywordSource; by: string }): Promise<KeptKeywords | null> {
  const [type, project] = await Promise.all([getObjectTypeBySlug(orgId, SEO_KEYWORD_TYPE), readSeoProject(orgId, projectId)]);
  if (!type || !project) {
    return null;
  }
  const domains = Array.isArray(project.meta.domains) ? (project.meta.domains as unknown[]).map(String) : [];
  const rows: KeptKeywords['rows'] = [];
  for (const research of mergeResearch(items).values()) {
    const { id, created } = await ensureRow(orgId, type.id, project, research.keyword, opts.source, opts.by);
    const written = await mergeMeta<SeoKeywordMeta>(orgId, id, current => researchPatch(current, research, domains));
    rows.push({ id, keyword: written?.keyword ?? research.keyword, created, status: written?.status ?? 'idea', ...(typeof written?.clientPosition === 'number' ? { clientPosition: written.clientPosition } : {}) });
  }
  return { project: { id: project.id, title: project.title }, rows };
}

/**
 * The page a keyword is linked to among a project's pages with that keyword:
 * the newest one in progress or live; else the discarded page the row is
 * already linked to, so it reads as dropped. A discarded page never links a
 * row anew: a keyword restored after its page was discarded stays an idea
 * until a new plan takes it. Pure.
 * @param pages - The project's pages with this keyword.
 * @param linkedId - The page the row is linked to now, if any.
 */
export function linkedPage(pages: readonly SeoPageRecord[], linkedId?: number): SeoPageRecord | undefined {
  const newest = [...pages].sort((a, b) => b.id - a.id);
  return newest.find(p => p.meta.status !== 'rejected') ?? newest.find(p => p.id === linkedId);
}

/**
 * The change that brings a row in step with its page, or with no page. Pure.
 * @param row - The row.
 * @param page - Its page, if it has one.
 * @param batch - That page's batch.
 */
export function pageLinkPatch(row: SeoKeywordMeta, page: SeoPageRecord | undefined, batch: Pick<SeoBatchRecord, 'id' | 'title'> | undefined): Partial<SeoKeywordMeta> | null {
  const patch: Partial<SeoKeywordMeta> = {};
  if (page) {
    const status = nextKeywordStatus(row.status, { kind: 'page', pageStatus: page.meta.status });
    const want: Partial<SeoKeywordMeta> = {
      batchId: page.meta.batchId,
      batchTitle: batch?.title ?? page.meta.batchTitle,
      pageId: page.id,
      serpArtifactId: page.meta.serpArtifactId,
      publishedUrl: page.meta.publishedUrl,
      ...(typeof status === 'string' ? { status, statusLabel: KEYWORD_STATUS_LABELS[status] } : {}),
      ...(!row.intent && page.meta.intent ? { intent: page.meta.intent } : {}),
      ...(!row.cluster && page.meta.cluster ? { cluster: page.meta.cluster } : {}),
    };
    for (const [k, v] of Object.entries(want) as Array<[keyof SeoKeywordMeta, unknown]>) {
      if (row[k] !== v) {
        (patch as Record<string, unknown>)[k] = v;
      }
    }
  } else if (row.pageId !== undefined) {
    const status = nextKeywordStatus(row.status, { kind: 'unplanned' }) as SeoKeywordStatus;
    Object.assign(patch, { batchId: undefined, batchTitle: undefined, pageId: undefined, serpArtifactId: undefined, ...(status !== row.status ? { status, statusLabel: KEYWORD_STATUS_LABELS[status] } : {}) });
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Bring a project's register in step with its pages: every planned page's
 * keyword has its row (made, with the batch's source, when it has none),
 * linked to its batch, page and SERP brief, its status following the page;
 * a row whose page is gone (a revised plan dropped it) is unlinked. Writes
 * only what changed. Never throws: the gate it rides on is what matters.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param read - The project's pages and batches, as the gate just read them.
 * @param read.pages - Its pages.
 * @param read.batches - Its batches.
 */
export async function syncProjectKeywords(orgId: string, projectId: number, read: { pages: readonly SeoPageRecord[]; batches: readonly SeoBatchRecord[] }): Promise<void> {
  try {
    const type = await getObjectTypeBySlug(orgId, SEO_KEYWORD_TYPE);
    if (!type) {
      return;
    }
    const byKey = new Map<string, SeoPageRecord[]>();
    for (const p of read.pages) {
      const key = keywordKey(p.meta.keyword ?? '');
      if (key) {
        byKey.set(key, [...(byKey.get(key) ?? []), p]);
      }
    }
    const batches = new Map(read.batches.map(b => [b.id, b]));
    const rows = new Map((await listProjectKeywords(orgId, projectId)).map(r => [r.meta.keywordKey || keywordKey(r.meta.keyword), r]));
    let project: { id: number; title: string } | null = null;
    for (const [key, pages] of byKey) {
      const page = linkedPage(pages);
      if (rows.has(key) || !page) {
        continue;
      }
      project ??= await readSeoProject(orgId, projectId);
      if (!project) {
        return;
      }
      const source: SeoKeywordSource = batches.get(page.meta.batchId)?.meta.source === 'weekly' ? 'weekly' : 'chat';
      const { id } = await ensureRow(orgId, type.id, project, page.meta.keyword.trim(), source, 'system:seo');
      const [made] = await getKeywordRows(orgId, [id]);
      if (made) {
        rows.set(key, made);
      }
    }
    for (const [key, row] of rows) {
      const page = linkedPage(byKey.get(key) ?? [], row.meta.pageId);
      const patch = pageLinkPatch(row.meta, page, page ? batches.get(page.meta.batchId) : undefined);
      if (patch) {
        await mergeMeta<SeoKeywordMeta>(orgId, row.id, current => pageLinkPatch(current, page, page ? batches.get(page.meta.batchId) : undefined));
      }
    }
  } catch (err) {
    console.warn('[seo] the keywords register could not be brought in step', { orgId, projectId, error: (err as Error).message });
  }
}

export type KeywordChange = { why?: string; intent?: string; drop?: boolean; restore?: boolean };

/**
 * A person's or the strategist's word on register rows: the why (dated, and
 * whose), the intent, a drop or a restore. Status moves only as
 * `nextKeywordStatus` allows. One line per row saying what happened.
 * @param orgId - The workspace.
 * @param ids - The rows.
 * @param change - What to write.
 * @param by - Who said it.
 * @param now - The clock (tests).
 */
export async function updateKeywords(orgId: string, ids: readonly number[], change: KeywordChange, by: string | null, now: Date = new Date()): Promise<string[]> {
  const rows = await getKeywordRows(orgId, ids);
  const found = new Set(rows.map(r => r.id));
  const lines = ids.filter(id => !found.has(id)).map(id => `#${id}: not a keyword in this workspace.`);
  for (const row of rows) {
    const refused: string[] = [];
    await mergeMeta<SeoKeywordMeta>(orgId, row.id, (current) => {
      const patch: Partial<SeoKeywordMeta> = {};
      const event: KeywordEvent | null = change.drop ? { kind: 'drop' } : change.restore ? { kind: 'restore' } : null;
      if (event) {
        const status = nextKeywordStatus(current.status, event);
        if (typeof status !== 'string') {
          // A why written for a drop that did not happen would say something untrue.
          refused.push(status.refused);
          return null;
        }
        Object.assign(patch, { status, statusLabel: KEYWORD_STATUS_LABELS[status] });
        if (event.kind === 'restore' && current.pageId !== undefined) {
          // A restored keyword leaves its discarded page behind; a new plan links it again.
          Object.assign(patch, { batchId: undefined, batchTitle: undefined, pageId: undefined, serpArtifactId: undefined });
        }
      }
      if (change.why?.trim()) {
        patch.why = { text: change.why.trim(), at: now.toISOString(), by };
      }
      if (change.intent?.trim()) {
        patch.intent = change.intent.trim();
      }
      return patch;
    });
    lines.push(refused.length > 0
      ? `#${row.id} "${row.meta.keyword}": not ${change.drop ? 'dropped' : 'restored'}, ${refused[0]}. Nothing was written on it.`
      : `#${row.id} "${row.meta.keyword}": written.`);
  }
  return lines;
}
