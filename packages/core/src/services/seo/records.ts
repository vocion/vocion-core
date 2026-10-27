/**
 * SEO batches and pages as records — `seo_batch` and `seo_page`, two object
 * types the `seo` plugin ships, each carrying `metadata.projectId` so the
 * work belongs to a client's project.
 *
 * Every write the SEO tools make goes through here, and every one ends by
 * re-reading the batch's gate (`gate.ts`) and writing what it says back onto
 * the records: the batch's `gate` (its stage, counts and the one line a
 * person reads) and, on each page, the batch's line and whether the page is
 * released. The pages that read them are ordinary descriptor pages, so the
 * gate a person sees is the gate the tools enforce, computed once.
 *
 * What a page's sign-off means is decided here too: a page is approved only
 * when a person signed off on its CURRENT draft (`signoff`, written by
 * `signoff.ts` from the answered ask, never by an agent). The `status` field
 * is what the page shows; the sign-off is what the gate counts.
 */

import type { GatePage, GateState, SeoGateConfig } from './gate';
import type { SeoModelStamp } from './modelThatRan';
import { createBusinessObject, getBusinessObject, getObjectTypeBySlug, listBusinessObjects, updateBusinessObject } from '@/services/BusinessObjectService';
import { evaluateGate, gateConfigFrom } from './gate';
import { readSeoProject } from './projects';

export const SEO_BATCH_TYPE = 'seo_batch';
export const SEO_PAGE_TYPE = 'seo_page';

/** What kind of page it is. A `location` page targets one city or service area and must say something true of that place. */
export const SEO_PAGE_TYPES = ['location', 'service', 'blog', 'landing', 'other'] as const;
export type SeoPageType = typeof SEO_PAGE_TYPES[number];

export const SEO_PAGE_STATUSES = ['proposed', 'researched', 'briefed', 'drafting', 'in_review', 'changes_requested', 'approved', 'publishing', 'published', 'rejected'] as const;
export type SeoPageStatus = typeof SEO_PAGE_STATUSES[number];

export type SeoFeedback = {
  at: string;
  /** Who said it: a person's id, or the agent that recorded it on their word. */
  by: string | null;
  note: string;
  /** `client`: true of this client only (the project); `general`: craft (the workspace wiki). Unset until someone decides. */
  scope?: 'client' | 'general';
  /** Where the note was filed — `project:<id>` or `wiki:<slug>` — or null while it is not. */
  filedTo: string | null;
  /** The sign-off ask it came from, when it came from one. */
  askId?: number;
  /** The draft it was about. */
  draftArtifactId?: number;
};

export type SeoSignoff = {
  decision: 'approve' | 'revise' | 'discard';
  by: string | null;
  at: string;
  askId: number;
  draftArtifactId: number | null;
  /** Which draft of the page it was about. */
  round?: number;
};

export type SeoPageMeta = {
  projectId: number;
  projectName?: string;
  batchId: number;
  batchTitle?: string;
  order: number;
  keyword: string;
  secondaryKeywords?: string[];
  intent?: string;
  volume?: number | null;
  /** What kind of page: a location page gets its own SERP read and must carry local substance. */
  pageType?: SeoPageType;
  /** The city or service area a location page is for ("Fairview"). */
  location?: string;
  /** The live page this one rewrites, when it is a refresh. */
  existingUrl?: string;
  /** Planned as a refresh of a page that already targets this keyword or URL. */
  refresh?: boolean;
  /** The URL slug planned for a new page. */
  slug?: string;
  /** Where the page lives or will live: the published URL, else the page it refreshes, else its planned slug. Stamped on every write. */
  target?: string;
  status: SeoPageStatus;
  serpArtifactId?: number;
  briefArtifactId?: number;
  draftArtifactId?: number;
  /** How many times the page has been drafted; each draft gets its own sign-off. */
  draftRound?: number;
  models?: { plan?: SeoModelStamp; write?: SeoModelStamp; review?: SeoModelStamp };
  /** "Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5" — the models line the batch page shows. */
  modelsLine?: string;
  review?: {
    verdict: 'pass' | 'fix';
    notes: string;
    at: string;
    /** Sibling location pages the draft was too similar to (`duplicates.ts`), when it was. */
    similarTo?: Array<{ pageId: number; similarity: number }>;
  };
  signoff?: SeoSignoff;
  feedback?: SeoFeedback[];
  publishTargetId?: string;
  publishedUrl?: string;
  pullRequestUrl?: string;
  /** Stamped from the batch's gate on every write: the line, and whether this page is released now. */
  batchLine?: string;
  released?: boolean;
};

export type SeoBatchMeta = {
  projectId: number;
  projectName?: string;
  topic: string;
  keywords: string[];
  destination?: string;
  status: 'planned' | 'writing' | 'waiting' | 'done';
  gate?: Omit<GateState, 'released' | 'writable' | 'feedbackToFile' | 'waitingOnSignoff'> & { sample: number; tranche: number; updatedAt: string };
  /** Pages by status, for the SEO home. */
  counts?: Record<string, number>;
  waitingOnYou?: number;
};

export type SeoPageRecord = { id: number; title: string; meta: SeoPageMeta };

/**
 * Where a page lives or will live, for the pages list.
 * @param meta - The page.
 */
export function targetOf(meta: Pick<SeoPageMeta, 'publishedUrl' | 'existingUrl' | 'slug'>): string | undefined {
  return meta.publishedUrl || meta.existingUrl || meta.slug || undefined;
}
export type SeoBatchRecord = { id: number; title: string; meta: SeoBatchMeta };

/** The plugin's types must be there; a workspace that has not applied it is told how to get them. */
export class SeoSetupError extends Error {}

async function requireTypes(orgId: string): Promise<void> {
  const [batch, page] = await Promise.all([getObjectTypeBySlug(orgId, SEO_BATCH_TYPE), getObjectTypeBySlug(orgId, SEO_PAGE_TYPE)]);
  if (!batch || !page) {
    throw new SeoSetupError('The SEO app is not set up in this workspace (no seo_batch / seo_page types). Turn on the SEO app on the Apps page, or apply the workspace with `plugins: [seo]`.');
  }
}

/**
 * Whether a person signed off on this page's current draft.
 * @param meta - The page.
 */
export function signedOff(meta: Pick<SeoPageMeta, 'signoff' | 'draftArtifactId' | 'draftRound'>): boolean {
  const s = meta.signoff;
  return Boolean(s && s.decision === 'approve' && s.by?.startsWith('usr-') && (s.draftArtifactId ?? null) === (meta.draftArtifactId ?? null) && (s.round ?? 1) === (meta.draftRound ?? 1));
}

/**
 * What the gate reads off one page.
 * @param page - The page record.
 */
export function gatePageOf(page: SeoPageRecord): GatePage {
  const m = page.meta;
  const approved = signedOff(m);
  const feedback = m.feedback ?? [];
  return {
    id: page.id,
    order: typeof m.order === 'number' ? m.order : page.id,
    status: m.status,
    // A draft the editor sent back (`drafting`) is the writer's again: not
    // written until it is saved, so the gate lets it be redrafted.
    written: typeof m.draftArtifactId === 'number' && m.status !== 'drafting',
    approved,
    changesRequested: !approved && m.status === 'changes_requested',
    feedbackFiled: feedback.every(f => Boolean(f.filedTo)),
  };
}

/**
 * The models line: the model that ran each step, in a person's words.
 * @param models - The page's stamps.
 */
export function modelsLine(models: SeoPageMeta['models']): string | undefined {
  const parts = ([['Plan', models?.plan], ['Write', models?.write], ['Review', models?.review]] as const)
    .filter(([, m]) => Boolean(m?.name))
    .map(([label, m]) => `${label} ${m!.name}${m!.source === 'configured' ? ' (configured)' : ''}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

const toPage = (row: { id: number; title: string; metadata: unknown }): SeoPageRecord => ({ id: row.id, title: row.title, meta: (row.metadata ?? {}) as SeoPageMeta });
const toBatch = (row: { id: number; title: string; metadata: unknown }): SeoBatchRecord => ({ id: row.id, title: row.title, meta: (row.metadata ?? {}) as SeoBatchMeta });

/**
 * One page, or null when the id is not an SEO page here.
 * @param orgId - The workspace.
 * @param id - The page id.
 */
export async function getSeoPage(orgId: string, id: number): Promise<SeoPageRecord | null> {
  const row = await getBusinessObject(id, orgId);
  return row && row.type?.slug === SEO_PAGE_TYPE ? toPage(row) : null;
}

/**
 * One batch, or null.
 * @param orgId - The workspace.
 * @param id - The batch id.
 */
export async function getSeoBatch(orgId: string, id: number): Promise<SeoBatchRecord | null> {
  const row = await getBusinessObject(id, orgId);
  return row && row.type?.slug === SEO_BATCH_TYPE ? toBatch(row) : null;
}

/**
 * Every batch, newest first, optionally for one project.
 * @param orgId - The workspace.
 * @param projectId - Only this project's.
 */
export async function listSeoBatches(orgId: string, projectId?: number): Promise<SeoBatchRecord[]> {
  // A batch belongs to its project through `metadata.projectId`, read in the database.
  return (await listBusinessObjects(orgId, SEO_BATCH_TYPE, projectId === undefined ? {} : { projectId })).map(toBatch);
}

/**
 * A batch's pages, in planned order.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 */
export async function listSeoPages(orgId: string, batchId: number): Promise<SeoPageRecord[]> {
  const rows = (await listBusinessObjects(orgId, SEO_PAGE_TYPE)).map(toPage);
  return rows.filter(p => p.meta.batchId === batchId).sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0) || a.id - b.id);
}

export type PlannedPage = {
  keyword: string;
  title?: string;
  secondaryKeywords?: string[];
  intent?: string;
  volume?: number | null;
  pageType?: SeoPageType;
  location?: string;
  existingUrl?: string;
  slug?: string;
  refresh?: boolean;
};

export type PlanBatchInput = {
  projectId: number;
  topic: string;
  destination?: string;
  pages: PlannedPage[];
  plannedBy?: SeoModelStamp | null;
};

/** A plan that would make two pages compete for one keyword or one URL. */
export class SeoPlanConflictError extends SeoSetupError {}

/**
 * A keyword as it is compared: case, spacing and punctuation gone.
 * @param keyword - The keyword.
 */
export function keywordKey(keyword: string): string {
  return keyword.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * A URL or slug as it is compared: no scheme, host or `www.`, no query or
 * trailing slash, lower case. A bare slug compares with a URL's path.
 * @param urlOrSlug - A URL or a slug.
 */
export function pathKey(urlOrSlug: string): string {
  const raw = urlOrSlug.trim().toLowerCase();
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.replace(/^[a-z0-9.-]+\.[a-z]{2,}(?=\/)/, '');
  }
  return `/${path.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Why a planned page would compete with a page the project already has, or
 * null when it would not. A keyword planned in another open batch, a keyword
 * a published page already targets, or a URL another page lives at or
 * refreshes is a conflict unless the plan marks the page a refresh. Two
 * pages in one plan with the same keyword always are.
 * @param planned - The pages being planned, in order.
 * @param existing - Every page the project already has.
 * @param openBatchIds - The project's batches that are not done.
 */
export function planConflicts(planned: PlannedPage[], existing: SeoPageRecord[], openBatchIds: ReadonlySet<number>): string[] {
  const problems: string[] = [];
  const inPlan = new Map<string, string>();
  for (const p of planned) {
    const key = keywordKey(p.keyword);
    if (!key) {
      continue;
    }
    if (inPlan.has(key)) {
      problems.push(`"${p.keyword}" is planned twice in this batch; one keyword is one page (put the other as a secondary keyword).`);
      continue;
    }
    inPlan.set(key, p.keyword);
    if (p.refresh) {
      continue;
    }
    const live = existing.filter(e => e.meta.status !== 'rejected');
    const sameKeyword = live.find(e => keywordKey(e.meta.keyword) === key && (openBatchIds.has(e.meta.batchId) || e.meta.status === 'published' || Boolean(e.meta.publishedUrl)));
    if (sameKeyword) {
      const where = sameKeyword.meta.publishedUrl ? `published at ${sameKeyword.meta.publishedUrl}` : `planned in batch #${sameKeyword.meta.batchId}`;
      problems.push(`"${p.keyword}" is already page #${sameKeyword.id} (${where}). Two pages on one keyword compete with each other: drop it, or plan it with refresh: true and existing_url to rewrite that page.`);
      continue;
    }
    const urls = [p.existingUrl, p.slug].filter((u): u is string => Boolean(u?.trim())).map(pathKey).filter(u => u !== '/');
    const sameUrl = urls.length
      ? live.find(e => [e.meta.existingUrl, e.meta.publishedUrl, e.meta.slug].filter((u): u is string => Boolean(u?.trim())).some(u => urls.includes(pathKey(u))))
      : undefined;
    if (sameUrl) {
      problems.push(`"${p.keyword}" targets ${p.existingUrl ?? p.slug}, which page #${sameUrl.id} "${sameUrl.meta.keyword}" already ${sameUrl.meta.publishedUrl ? 'lives at' : 'targets'}. Plan it with refresh: true to rewrite that page, or give it its own URL.`);
    }
  }
  return problems;
}

/**
 * A batch and its proposed pages, in the order given, with the gate read once.
 * @param orgId - The workspace.
 * @param userId - Who it is filed as.
 * @param input - The plan.
 */
export async function planSeoBatch(orgId: string, userId: string, input: PlanBatchInput): Promise<{ batch: SeoBatchRecord; pages: SeoPageRecord[]; gate: GateState }> {
  await requireTypes(orgId);
  const project = await readSeoProject(orgId, input.projectId);
  if (!project) {
    throw new SeoSetupError(`No project #${input.projectId} in this workspace.`);
  }
  const keywords = input.pages.map(p => p.keyword.trim()).filter(Boolean);
  const [existingPages, batches] = await Promise.all([
    listBusinessObjects(orgId, SEO_PAGE_TYPE, { projectId: project.id }).then(rows => rows.map(toPage)),
    listSeoBatches(orgId, project.id),
  ]);
  const problems = planConflicts(input.pages, existingPages.filter(p => p.meta.projectId === project.id), new Set(batches.filter(b => b.meta.status !== 'done').map(b => b.id)));
  if (problems.length > 0) {
    throw new SeoPlanConflictError(`Not planned: ${problems.length === 1 ? problems[0] : `\n- ${problems.join('\n- ')}`}`);
  }
  const batchMeta: SeoBatchMeta = {
    projectId: project.id,
    projectName: project.title,
    topic: input.topic,
    keywords,
    ...(input.destination ? { destination: input.destination } : {}),
    status: 'planned',
  };
  const batchRow = await createBusinessObject({ typeSlug: SEO_BATCH_TYPE, title: `${project.title}: ${input.topic}`, metadata: batchMeta }, orgId, userId);
  const batchId = batchRow!.id;
  const pages: SeoPageRecord[] = [];
  let order = 0;
  for (const p of input.pages) {
    const keyword = p.keyword.trim();
    if (!keyword) {
      continue;
    }
    order += 1;
    const models = input.plannedBy ? { plan: input.plannedBy } : undefined;
    const meta: SeoPageMeta = {
      projectId: project.id,
      projectName: project.title,
      batchId,
      batchTitle: batchRow!.title,
      order,
      keyword,
      ...(p.secondaryKeywords?.length ? { secondaryKeywords: p.secondaryKeywords } : {}),
      ...(p.intent ? { intent: p.intent } : {}),
      ...(typeof p.volume === 'number' ? { volume: p.volume } : {}),
      ...(p.pageType ? { pageType: p.pageType } : {}),
      ...(p.location?.trim() ? { location: p.location.trim() } : {}),
      ...(p.existingUrl?.trim() ? { existingUrl: p.existingUrl.trim() } : {}),
      ...(p.slug?.trim() ? { slug: p.slug.trim() } : {}),
      ...(p.refresh ? { refresh: true } : {}),
      ...(input.destination ? { publishTargetId: input.destination } : {}),
      status: 'proposed',
      ...(models ? { models, modelsLine: modelsLine(models) } : {}),
      feedback: [],
    };
    const target = targetOf(meta);
    if (target) {
      meta.target = target;
    }
    const row = await createBusinessObject({ typeSlug: SEO_PAGE_TYPE, title: p.title?.trim() || keyword, metadata: meta }, orgId, userId);
    pages.push(toPage(row!));
  }
  const gate = await refreshSeoBatch(orgId, batchId);
  return { batch: (await getSeoBatch(orgId, batchId))!, pages: await listSeoPages(orgId, batchId), gate: gate! };
}

/**
 * Write part of a page's metadata (a shallow merge), keeping the models line in step.
 * @param orgId - The workspace.
 * @param page - The page as read.
 * @param patch - What changes.
 */
export async function patchSeoPage(orgId: string, page: SeoPageRecord, patch: Partial<SeoPageMeta>): Promise<SeoPageRecord> {
  const next: SeoPageMeta = { ...page.meta, ...patch };
  const target = targetOf(next);
  if (target) {
    next.target = target;
  }
  if (patch.models) {
    next.models = { ...page.meta.models, ...patch.models };
    next.modelsLine = modelsLine(next.models);
  }
  const [row] = await updateBusinessObject({ id: page.id, metadata: next as unknown as Record<string, unknown> }, orgId);
  return row ? toPage(row) : { ...page, meta: next };
}

/**
 * The gate sizes for a batch's project.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function gateConfigForProject(orgId: string, projectId: number): Promise<SeoGateConfig> {
  const project = await readSeoProject(orgId, projectId);
  return gateConfigFrom(project?.meta);
}

/**
 * Read a batch's gate and write it back: the batch's gate and counts, and on
 * each page the batch's line and whether it is released. Writes only what
 * changed. Returns the gate, or null when the batch is gone.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 * @param now - The clock (tests).
 */
export async function refreshSeoBatch(orgId: string, batchId: number, now: Date = new Date()): Promise<GateState | null> {
  const batch = await getSeoBatch(orgId, batchId);
  if (!batch) {
    return null;
  }
  const [pages, config] = await Promise.all([listSeoPages(orgId, batchId), gateConfigForProject(orgId, batch.meta.projectId)]);
  const gate = evaluateGate(pages.map(gatePageOf), config);
  const counts: Record<string, number> = {};
  for (const p of pages) {
    counts[p.meta.status] = (counts[p.meta.status] ?? 0) + 1;
  }
  const status: SeoBatchMeta['status'] = gate.total > 0 && gate.approved === gate.total
    ? 'done'
    : gate.writable.length > 0 ? (gate.written > 0 ? 'writing' : 'planned') : 'waiting';
  const { released, writable, feedbackToFile, waitingOnSignoff, ...shown } = gate;
  const nextMeta: SeoBatchMeta = {
    ...batch.meta,
    status,
    counts,
    waitingOnYou: waitingOnSignoff.length + feedbackToFile.length,
    gate: { ...shown, sample: config.sample, tranche: config.tranche, updatedAt: now.toISOString() },
  };
  await updateBusinessObject({ id: batch.id, metadata: nextMeta as unknown as Record<string, unknown> }, orgId);
  const line = `${batch.title} · ${gate.line}`;
  for (const p of pages) {
    const isReleased = released.includes(p.id);
    if (p.meta.batchLine !== line || p.meta.released !== isReleased) {
      await updateBusinessObject({ id: p.id, metadata: { ...p.meta, batchLine: line, released: isReleased } as unknown as Record<string, unknown> }, orgId);
    }
  }
  return gate;
}

/**
 * The batch's gate as it stands, read fresh (nothing written).
 * @param orgId - The workspace.
 * @param batchId - The batch.
 */
export async function readSeoGate(orgId: string, batchId: number): Promise<{ batch: SeoBatchRecord; pages: SeoPageRecord[]; gate: GateState } | null> {
  const batch = await getSeoBatch(orgId, batchId);
  if (!batch) {
    return null;
  }
  const [pages, config] = await Promise.all([listSeoPages(orgId, batchId), gateConfigForProject(orgId, batch.meta.projectId)]);
  return { batch, pages, gate: evaluateGate(pages.map(gatePageOf), config) };
}
