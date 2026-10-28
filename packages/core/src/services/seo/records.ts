/**
 * SEO batches and pages as records — `seo_batch` and `seo_page`, two object
 * types the `seo` plugin ships, each carrying `metadata.projectId` so the
 * work belongs to a client's project.
 *
 * Every write the SEO tools make goes through here, and every one ends by
 * re-reading the PROJECT's gate (`gate.ts`) — every batch of that client
 * climbs one ladder — and writing what it says back onto the records: each
 * batch's `gate` (its stage, counts and the one line a person reads) and, on
 * each page, its batch's line and whether the page is released. The pages
 * that read them are ordinary descriptor pages, so the gate a person sees is
 * the gate the tools enforce, computed once.
 *
 * What a page's sign-off means is decided here too: a page is approved only
 * when a person signed off on its CURRENT words — the draft artifact, its
 * round, and the artifact version and content hash the ask showed
 * (`signoff`, written by `signoff.ts` from the answered ask, never by an
 * agent). Edit the draft after the sign-off and it no longer counts. The
 * `status` field is what the page shows; the sign-off is what the gate counts.
 *
 * Writes merge per key under a row lock (`mergeMeta`), so a sign-off landing
 * while a tool writes the same page is never wiped by a stale read.
 */

import type { GatePage, GateState, SeoGateConfig } from './gate';
import type { SeoModelStamp } from './modelThatRan';
import type { ProjectAuthor } from '@/services/DataRoomService';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema, businessObjectSchema, learningCandidateSchema } from '@/models/Schema';
import { createBusinessObject, deleteBusinessObject, getBusinessObject, getObjectTypeBySlug, listBusinessObjects } from '@/services/BusinessObjectService';
import { defaultAuthor, sameName } from '@/services/DataRoomService';
import { batchView, evaluateGate, gateConfigFrom } from './gate';
import { readSeoProject } from './projects';

export const SEO_BATCH_TYPE = 'seo_batch';
export const SEO_PAGE_TYPE = 'seo_page';

export const SEO_PAGE_STATUSES = ['proposed', 'researched', 'briefed', 'drafting', 'in_review', 'changes_requested', 'approved', 'publishing', 'published', 'rejected'] as const;
export type SeoPageStatus = typeof SEO_PAGE_STATUSES[number];

/** What kind of page it is. The sample takes one of each; a `location` page targets one city or service area and must say something true of that place. */
export const SEO_PAGE_TYPES = ['location', 'service', 'blog', 'landing', 'other'] as const;
export type SeoPageType = typeof SEO_PAGE_TYPES[number];

/** Where craft notes go: the writer's and the editor's learning step. */
export const SEO_LEARNING_STEP = 'seo-feedback';

export type SeoFeedback = {
  at: string;
  /** Who said it: a person's id, or the agent that recorded it on their word. */
  by: string | null;
  note: string;
  /** `client`: true of this client only; `general`: craft for every client. Unset until someone decides. */
  scope?: 'client' | 'general';
  /** Where the note was filed — `project:<id>` or `learning:seo-feedback` — or null while it is not. */
  filedTo: string | null;
  /** The words as filed: the rule line or notes passage on the project, or the proposed rule. Checked before the gate counts the note filed. */
  filedText?: string;
  /** The learning candidate (or adopted rule) the note became, when it went to the learning step. */
  filedRef?: { candidateId?: number; memoryKey?: string };
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
  /** The artifact version the person signed off (read by publishing). */
  version?: number;
  /** The content hash of that version (sha-256 of the draft's text): any later change to the words voids the sign-off. */
  hash?: string;
  /** The same hash, under the name publishing reads (`signedVersionOf`). */
  contentHash?: string;
};

/** The sign-off ask core filed for the current draft, and the words it showed. */
export type SeoSignoffAsk = { askId: number; round: number; draftArtifactId: number; version: number; hash: string; at: string };

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
  /** What kind of page: the sample takes one of each; a location page gets its own SERP read and must carry local substance. */
  pageType?: SeoPageType;
  /** The city or service area a location page is for ("Fairview"). */
  location?: string;
  /** The keyword cluster it belongs to. */
  cluster?: string;
  /** The live page this one rewrites, when it is a refresh. */
  existingUrl?: string;
  /** Planned as a refresh of a page that already targets this keyword or URL. */
  refresh?: boolean;
  /** Where the page lives or will live: the published URL, else the page it refreshes, else its planned slug. Stamped on every write. */
  target?: string;
  /** Who signs the page: the project's author it was planned with, else the project's default. Unset while the project names none. */
  author?: SeoPageAuthor;
  status: SeoPageStatus;
  serpArtifactId?: number;
  briefArtifactId?: number;
  draftArtifactId?: number;
  /** How many times the page has been drafted; each draft gets its own sign-off. */
  draftRound?: number;
  /** The meta title (at most 60 characters), validated by `seo_save_draft`. */
  metaTitle?: string;
  /** The meta description (at most 155 characters). */
  metaDescription?: string;
  /** The URL slug planned for a new page: kebab-case (path segments allowed), unique within the project; checked again by `seo_save_draft`. */
  slug?: string;
  models?: { plan?: SeoModelStamp; write?: SeoModelStamp; review?: SeoModelStamp };
  /** "Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5" — the models line the batch page shows. */
  modelsLine?: string;
  review?: {
    verdict: 'pass' | 'fix';
    notes: string;
    at: string;
    /** Sibling location pages the draft was too similar to (`duplicates.ts`), when it was. */
    similarTo?: Array<{ pageId: number; similarity: number }>;
    /** The editor's findings, each field capped (`work.ts`). */
    findings?: import('./work').SeoFinding[];
    /** The whole review, when it was too long to keep on the page: an artifact linked from it. */
    notesArtifactId?: number;
  };
  /** How many times the editor has sent the current draft back since a person last decided (`SEO_EDITOR_ROUNDS`). */
  editorRounds?: number;
  signoff?: SeoSignoff;
  signoffAsk?: SeoSignoffAsk;
  feedback?: SeoFeedback[];
  publishTargetId?: string;
  publishedUrl?: string;
  pullRequestUrl?: string;
  /** Stamped from the project's gate on every write: the batch's line, and whether this page is released now. */
  batchLine?: string;
  released?: boolean;
};

/** Where a batch's keyword plan stands. A batch filed before plans were signed off has none and counts as approved. */
export type SeoPlanState = {
  state: 'plan_review' | 'approved' | 'revise' | 'discarded';
  /** Each revision of the plan gets its own ask. */
  round: number;
  askId?: number;
  /** The person's words on a Revise. */
  note?: string;
  by?: string | null;
  at?: string;
};

export type SeoBatchMeta = {
  projectId: number;
  projectName?: string;
  topic: string;
  keywords: string[];
  destination?: string;
  status: 'plan_review' | 'planned' | 'writing' | 'waiting' | 'done';
  /** The conversation its work was started from; progress is said there (`work.ts`). */
  conversationId?: number;
  /** The state last said there (`seoRunReport`): a run that changed nothing says nothing. */
  toldState?: string;
  plan?: SeoPlanState;
  gate?: Omit<GateState, 'released' | 'writable' | 'feedbackToFile' | 'waitingOnSignoff' | 'sample'> & { sample: number; tranche: number; updatedAt: string };
  /** Pages by status, for the SEO home. */
  counts?: Record<string, number>;
  waitingOnYou?: number;
};

export type SeoPageRecord = { id: number; title: string; meta: SeoPageMeta };

/** A page's byline, as the project keeps its authors (`ProjectAuthor`). */
export type SeoPageAuthor = { name: string; title?: string; url?: string; from: 'planned' | 'default' };

/**
 * The byline for a planned page: the project author the plan named (by name,
 * any spelling), else the project's default author, else none. A name the
 * project does not have is not invented into a byline. Pure.
 * @param authors - The project's authors.
 * @param named - The author the plan named for this page, if any.
 */
export function bylineFor(authors: readonly ProjectAuthor[] | undefined, named?: string | null): SeoPageAuthor | null {
  const pick = (a: ProjectAuthor, from: SeoPageAuthor['from']): SeoPageAuthor => ({ name: a.name, ...(a.title ? { title: a.title } : {}), ...(a.url ? { url: a.url } : {}), from });
  const chosen = named?.trim() ? (authors ?? []).find(a => sameName(a.name, named)) : undefined;
  if (chosen) {
    return pick(chosen, 'planned');
  }
  const fallback = defaultAuthor(authors);
  return fallback ? pick(fallback, 'default') : null;
}

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
 * Whether a batch's keyword plan has been signed off. One with no plan state
 * was filed before plans were signed off, and stands as it was.
 * @param meta - The batch.
 */
export function planApproved(meta: Pick<SeoBatchMeta, 'plan'>): boolean {
  return !meta.plan || meta.plan.state === 'approved';
}

/** The words of an artifact as the gate compares them: its version and a hash of its content. */
export type ArtifactWords = { version: number; hash: string };

/**
 * The content hash of an artifact — what a sign-off is bound to. A markdown
 * draft hashes its text, sha-256 hex, exactly as publishing checks it
 * (`services/publish/sitePublish.ts` `contentHashOf`); anything else its spec.
 * @param spec - The artifact's spec, as stored.
 */
export function contentHashOf(spec: unknown): string {
  const md = spec && typeof spec === 'object' ? (spec as { md?: unknown }).md : undefined;
  return createHash('sha256').update(typeof md === 'string' ? md : JSON.stringify(spec ?? null)).digest('hex');
}

/**
 * The current words of these artifacts.
 * @param orgId - The workspace.
 * @param ids - Artifact ids.
 */
export async function artifactWords(orgId: string, ids: readonly number[]): Promise<Map<number, ArtifactWords>> {
  const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: artifactSchema.id, version: artifactSchema.currentVersion, spec: artifactSchema.spec })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, unique)));
  return new Map(rows.map(r => [r.id, { version: r.version, hash: contentHashOf(r.spec) }]));
}

/**
 * Whether a person signed off on this page's current draft — the same
 * artifact, the same round, and (when the words are known) the same content.
 * @param meta - The page.
 * @param words - The draft's words now, when read; an edit since the sign-off voids it.
 */
export function signedOff(meta: Pick<SeoPageMeta, 'signoff' | 'draftArtifactId' | 'draftRound'>, words?: ArtifactWords | null): boolean {
  const s = meta.signoff;
  if (!(s && s.decision === 'approve' && s.by?.startsWith('usr-') && (s.draftArtifactId ?? null) === (meta.draftArtifactId ?? null) && (s.round ?? 1) === (meta.draftRound ?? 1))) {
    return false;
  }
  if (!words) {
    return true;
  }
  // Bound to the words: a hash when the sign-off recorded one, else its version.
  if (s.hash) {
    return s.hash === words.hash;
  }
  return s.version === undefined || s.version === words.version;
}

/** Whether a filed note is really where it says, read by `feedbackCheck`. */
export type FiledCheck = (note: SeoFeedback, page: SeoPageMeta) => boolean;

/**
 * What the gate reads off one page.
 * @param page - The page record.
 * @param read - What was read beside it: the draft's current words, and whether each note is really filed.
 * @param read.words - The current words of draft artifacts, by id.
 * @param read.filed - Whether a note is where it says it was filed.
 */
export function gatePageOf(page: SeoPageRecord, read: { words?: Map<number, ArtifactWords>; filed?: FiledCheck } = {}): GatePage {
  const m = page.meta;
  const words = typeof m.draftArtifactId === 'number' ? read.words?.get(m.draftArtifactId) ?? null : null;
  const approved = signedOff(m, words);
  const feedback = m.feedback ?? [];
  const filed = read.filed ?? ((f: SeoFeedback) => Boolean(f.filedTo));
  return {
    id: page.id,
    batchId: m.batchId,
    order: typeof m.order === 'number' ? m.order : page.id,
    pageType: m.pageType ?? null,
    status: m.status,
    // A draft the editor sent back (`drafting`) is the writer's again: not
    // written until it is saved, so the gate lets it be redrafted.
    written: typeof m.draftArtifactId === 'number' && m.status !== 'drafting',
    approved,
    changesRequested: !approved && m.status === 'changes_requested',
    feedbackFiled: feedback.every(f => filed(f, m)),
  };
}

/**
 * The models line: the model that ran each step, in a person's words.
 * "(configured)" only when no call was logged and the seat's pinned model
 * stands in for one.
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
 * SEO pages matching one metadata key, read in the database — never every
 * page in the workspace.
 * @param orgId - The workspace.
 * @param key - `batchId` or `projectId`.
 * @param value - Its value.
 */
async function pagesWhere(orgId: string, key: 'batchId' | 'projectId' | 'draftArtifactId', value: number): Promise<SeoPageRecord[]> {
  const type = await getObjectTypeBySlug(orgId, SEO_PAGE_TYPE);
  if (!type) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      eq(businessObjectSchema.typeId, type.id),
      sql`${businessObjectSchema.metadata}->>${key} = ${String(value)}`,
    ));
  return rows.map(toPage).sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0) || a.id - b.id);
}

/**
 * A batch's pages, in planned order.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 */
export async function listSeoPages(orgId: string, batchId: number): Promise<SeoPageRecord[]> {
  return pagesWhere(orgId, 'batchId', batchId);
}

/**
 * Every page of a project, across its batches.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function listProjectSeoPages(orgId: string, projectId: number): Promise<SeoPageRecord[]> {
  return pagesWhere(orgId, 'projectId', projectId);
}

/**
 * The pages whose current draft is this artifact.
 * @param orgId - The workspace.
 * @param artifactId - The draft artifact.
 */
export async function pagesDraftedIn(orgId: string, artifactId: number): Promise<SeoPageRecord[]> {
  return pagesWhere(orgId, 'draftArtifactId', artifactId);
}

/**
 * Change one record's metadata under a row lock: the change is computed from
 * the row as it stands inside the lock, and only the keys it names are
 * written (`undefined` removes a key). Two writers to the same page — a tool
 * and a person's sign-off — each keep what the other wrote.
 * @param orgId - The workspace.
 * @param id - The record.
 * @param change - The keys to write, from the locked row's metadata; null writes nothing.
 */
export async function mergeMeta<T extends Record<string, unknown>>(orgId: string, id: number, change: (current: T) => Partial<T> | null): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ metadata: businessObjectSchema.metadata })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
      .for('update');
    if (!row) {
      return null;
    }
    const current = (row.metadata ?? {}) as T;
    const patch = change(current);
    if (!patch || Object.keys(patch).length === 0) {
      return current;
    }
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const unset = Object.entries(patch).filter(([, v]) => v === undefined).map(([k]) => k);
    // Per key, in the database: remove what the patch clears, then lay the
    // patch over what is there.
    const removed = unset.reduce((expr, key) => sql`(${expr} - ${key}::text)`, sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb)`);
    const [written] = await tx
      .update(businessObjectSchema)
      .set({ metadata: sql`${removed} || ${JSON.stringify(set)}::jsonb` })
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
      .returning({ metadata: businessObjectSchema.metadata });
    return (written?.metadata ?? null) as T | null;
  });
}

export type PlannedPage = {
  keyword: string;
  title?: string;
  secondaryKeywords?: string[];
  intent?: string;
  volume?: number | null;
  pageType?: SeoPageType;
  location?: string;
  cluster?: string;
  existingUrl?: string;
  slug?: string;
  refresh?: boolean;
  /** The project author who signs it, by name; the project's default when left out. */
  author?: string;
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
 * Refuse a plan whose pages would compete with the project's other pages,
 * or with each other.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param pages - The pages being planned.
 * @param exceptBatch - A batch being revised: its own proposed pages are being replaced.
 */
async function refuseConflicts(orgId: string, projectId: number, pages: PlannedPage[], exceptBatch?: number): Promise<void> {
  const [existingPages, batches] = await Promise.all([listProjectSeoPages(orgId, projectId), listSeoBatches(orgId, projectId)]);
  const others = existingPages.filter(p => !(exceptBatch !== undefined && p.meta.batchId === exceptBatch && (p.meta.status === 'proposed' || p.meta.status === 'researched')));
  const problems = planConflicts(pages, others, new Set(batches.filter(b => b.meta.status !== 'done').map(b => b.id)));
  if (problems.length > 0) {
    throw new SeoPlanConflictError(`Not planned: ${problems.length === 1 ? problems[0] : `\n- ${problems.join('\n- ')}`}`);
  }
}

/**
 * The page records of a plan, created in the order given.
 * @param orgId - The workspace.
 * @param userId - Who they are filed as.
 * @param batch - The batch.
 * @param batch.id - Its id.
 * @param batch.title - Its title.
 * @param project - Its project.
 * @param project.id - The project id.
 * @param project.title - Its name.
 * @param project.meta
 * @param input - The plan.
 */
async function createPlanPages(orgId: string, userId: string, batch: { id: number; title: string }, project: { id: number; title: string; meta?: Record<string, unknown> }, input: PlanBatchInput): Promise<void> {
  let order = 0;
  const authors = Array.isArray(project.meta?.authors) ? project.meta.authors as ProjectAuthor[] : [];
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
      batchId: batch.id,
      batchTitle: batch.title,
      order,
      keyword,
      ...(p.secondaryKeywords?.length ? { secondaryKeywords: p.secondaryKeywords } : {}),
      ...(p.intent ? { intent: p.intent } : {}),
      ...(typeof p.volume === 'number' ? { volume: p.volume } : {}),
      ...(p.pageType ? { pageType: p.pageType } : {}),
      ...(p.location?.trim() ? { location: p.location.trim() } : {}),
      ...(p.cluster?.trim() ? { cluster: p.cluster.trim() } : {}),
      ...(p.existingUrl?.trim() ? { existingUrl: p.existingUrl.trim() } : {}),
      ...(p.slug?.trim() ? { slug: p.slug.trim() } : {}),
      ...(p.refresh ? { refresh: true } : {}),
      ...(() => {
        const author = bylineFor(authors, p.author);
        return author ? { author } : {};
      })(),
      ...(input.destination ? { publishTargetId: input.destination } : {}),
      status: 'proposed',
      ...(models ? { models, modelsLine: modelsLine(models) } : {}),
      feedback: [],
    };
    const target = targetOf(meta);
    if (target) {
      meta.target = target;
    }
    await createBusinessObject({ typeSlug: SEO_PAGE_TYPE, title: p.title?.trim() || keyword, metadata: meta }, orgId, userId);
  }
}

/**
 * A batch and its proposed pages, in the order given. The batch starts in
 * `plan_review`: nothing is briefed or drafted until a person signs off the
 * keyword plan (`asks.ts` files that ask).
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
  await refuseConflicts(orgId, project.id, input.pages);
  const batchMeta: SeoBatchMeta = {
    projectId: project.id,
    projectName: project.title,
    topic: input.topic,
    keywords,
    ...(input.destination ? { destination: input.destination } : {}),
    status: 'plan_review',
    plan: { state: 'plan_review', round: 1 },
  };
  const batchRow = await createBusinessObject({ typeSlug: SEO_BATCH_TYPE, title: `${project.title}: ${input.topic}`, metadata: batchMeta }, orgId, userId);
  const batchId = batchRow!.id;
  await createPlanPages(orgId, userId, { id: batchId, title: batchRow!.title }, project, input);
  const gate = await refreshSeoBatch(orgId, batchId);
  return { batch: (await getSeoBatch(orgId, batchId))!, pages: await listSeoPages(orgId, batchId), gate: gate! };
}

/**
 * A revised keyword plan for a batch a person sent back (or one still in
 * review): its proposed pages are replaced, the plan's round moves on, and it
 * goes back to review. Pages already past `proposed` are never touched.
 * @param orgId - The workspace.
 * @param userId - Who it is filed as.
 * @param batchId - The batch.
 * @param input - The revised plan.
 */
export async function revisePlan(orgId: string, userId: string, batchId: number, input: Omit<PlanBatchInput, 'projectId'>): Promise<{ batch: SeoBatchRecord; pages: SeoPageRecord[] } | string> {
  const batch = await getSeoBatch(orgId, batchId);
  if (!batch) {
    return `#${batchId} is not an SEO batch in this workspace.`;
  }
  if (planApproved(batch.meta)) {
    return `Batch #${batchId}'s keyword plan is already signed off; plan a new batch for new pages.`;
  }
  const project = await readSeoProject(orgId, batch.meta.projectId);
  if (!project) {
    return `Batch #${batchId}'s project is gone.`;
  }
  await refuseConflicts(orgId, project.id, input.pages, batchId);
  for (const p of await listSeoPages(orgId, batchId)) {
    if (p.meta.status === 'proposed' || p.meta.status === 'researched') {
      await deleteBusinessObject(p.id, orgId);
    }
  }
  await createPlanPages(orgId, userId, batch, project, { ...input, projectId: project.id });
  const round = (batch.meta.plan?.round ?? 1) + 1;
  await mergeMeta<SeoBatchMeta>(orgId, batchId, () => ({
    topic: input.topic || batch.meta.topic,
    keywords: input.pages.map(p => p.keyword.trim()).filter(Boolean),
    plan: { state: 'plan_review', round, ...(batch.meta.plan?.note ? { note: batch.meta.plan.note } : {}) },
    status: 'plan_review',
  }));
  await refreshSeoBatch(orgId, batchId);
  return { batch: (await getSeoBatch(orgId, batchId))!, pages: await listSeoPages(orgId, batchId) };
}

/**
 * Write part of a page's metadata, merged per key under a row lock, keeping
 * the models line in step. A function patch is computed from the page as it
 * stands inside the lock — use it for anything built on the current value
 * (the feedback list, the draft round).
 * @param orgId - The workspace.
 * @param page - The page as read.
 * @param patch - What changes, or how to compute it from the locked page.
 */
export async function patchSeoPage(orgId: string, page: SeoPageRecord, patch: Partial<SeoPageMeta> | ((current: SeoPageMeta) => Partial<SeoPageMeta> | null)): Promise<SeoPageRecord> {
  const written = await mergeMeta<SeoPageMeta>(orgId, page.id, (current) => {
    const p = typeof patch === 'function' ? patch(current) : patch;
    if (!p) {
      return null;
    }
    const target = targetOf({ ...current, ...p });
    const stamped = target && target !== current.target ? { ...p, target } : p;
    if (p.models) {
      const models = { ...current.models, ...p.models };
      return { ...stamped, models, modelsLine: modelsLine(models) };
    }
    return stamped;
  });
  return written ? { ...page, meta: written } : page;
}

/**
 * The gate sizes for a project.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function gateConfigForProject(orgId: string, projectId: number): Promise<SeoGateConfig> {
  const project = await readSeoProject(orgId, projectId);
  return gateConfigFrom(project?.meta);
}

/**
 * Whether each feedback note is really where it says it went: the words on
 * the page's own project (its rules or its wiki), or a learning candidate or
 * rule that exists and was not rejected. A write still waiting on a person,
 * or one filed to another client's project, is not filed.
 * @param orgId - The workspace.
 * @param pages - The pages whose notes are checked.
 */
export async function feedbackCheck(orgId: string, pages: readonly SeoPageRecord[]): Promise<FiledCheck> {
  const notes = pages.flatMap(p => (p.meta.feedback ?? []).map(f => ({ f, projectId: p.meta.projectId })));
  const projectIds = [...new Set(notes.filter(n => n.f.filedTo?.startsWith('project:')).map(n => n.projectId))];
  const projects = new Map<number, { rules: string[]; notes: string }>();
  for (const id of projectIds) {
    const project = await readSeoProject(orgId, id);
    if (project) {
      const meta = project.meta as { rules?: unknown; notes?: unknown };
      projects.set(id, { rules: Array.isArray(meta.rules) ? meta.rules.map(String) : [], notes: typeof meta.notes === 'string' ? meta.notes : '' });
    }
  }
  const candidateIds = [...new Set(notes.map(n => n.f.filedRef?.candidateId).filter((id): id is number => typeof id === 'number'))];
  const candidates = candidateIds.length === 0
    ? new Map<number, string>()
    : new Map((await db
        .select({ id: learningCandidateSchema.id, status: learningCandidateSchema.status })
        .from(learningCandidateSchema)
        .where(and(eq(learningCandidateSchema.orgId, orgId), inArray(learningCandidateSchema.id, candidateIds)))).map(r => [r.id, r.status]));
  return (f, page) => isFiled(f, page, projects, candidates);
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function isFiled(f: SeoFeedback, page: Pick<SeoPageMeta, 'projectId'>, projects: Map<number, { rules: string[]; notes: string }>, candidates: Map<number, string>): boolean {
  if (!f.filedTo || !f.filedText?.trim()) {
    return false;
  }
  if (f.filedTo === `project:${page.projectId}`) {
    const project = projects.get(page.projectId);
    const text = squash(f.filedText);
    return Boolean(project && (project.rules.some(r => squash(r) === text) || squash(project.notes).includes(text)));
  }
  if (f.filedTo === `learning:${SEO_LEARNING_STEP}`) {
    if (f.filedRef?.memoryKey) {
      return true;
    }
    const status = typeof f.filedRef?.candidateId === 'number' ? candidates.get(f.filedRef.candidateId) : undefined;
    return status !== undefined && status !== 'rejected';
  }
  return false;
}

/** What a project's gate read: its pages, the gate over the signed-off plans, and each batch's view of it. */
export type ProjectGateRead = {
  config: SeoGateConfig;
  batches: SeoBatchRecord[];
  pages: SeoPageRecord[];
  gate: GateState;
  /** Each batch's view, by batch id; a batch whose plan is not signed off releases nothing. */
  views: Map<number, GateState>;
  gatePages: Map<number, GatePage>;
};

/**
 * Read a project's gate, across every batch, with every check it needs: the
 * drafts' current words and whether each note is really filed.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function readProjectGate(orgId: string, projectId: number): Promise<ProjectGateRead> {
  const [batches, pages, config] = await Promise.all([listSeoBatches(orgId, projectId), listProjectSeoPages(orgId, projectId), gateConfigForProject(orgId, projectId)]);
  const [words, filed] = await Promise.all([artifactWords(orgId, pages.map(p => p.meta.draftArtifactId ?? 0)), feedbackCheck(orgId, pages)]);
  const signedPlans = new Set(batches.filter(b => planApproved(b.meta)).map(b => b.id));
  const gatePages = new Map(pages.map(p => [p.id, gatePageOf(p, { words, filed })]));
  const gate = evaluateGate(pages.filter(p => signedPlans.has(p.meta.batchId)).map(p => gatePages.get(p.id)!), config);
  const views = new Map<number, GateState>();
  for (const b of batches) {
    const mine = pages.filter(p => p.meta.batchId === b.id).map(p => gatePages.get(p.id)!);
    views.set(b.id, signedPlans.has(b.id) ? batchView(gate, mine) : planView(b, mine, gate));
  }
  return { config, batches, pages, gate, views, gatePages };
}

/**
 * A batch whose plan is not signed off: nothing released, and the line says why.
 * @param batch - The batch.
 * @param pages - Its pages.
 * @param gate - The project's gate.
 */
function planView(batch: SeoBatchRecord, pages: GatePage[], gate: GateState): GateState {
  const live = pages.filter(p => p.status !== 'rejected');
  const plan = batch.meta.plan!;
  const line = plan.state === 'revise'
    ? `Keyword plan sent back${plan.note ? `: "${plan.note.slice(0, 120)}"` : ''} · nothing is written until a revised plan is signed off`
    : plan.state === 'discarded'
      ? 'Keyword plan discarded'
      : `${live.length} ${live.length === 1 ? 'page' : 'pages'} planned · waiting on your sign-off on the keyword plan`;
  return { ...gate, allowed: 0, written: 0, approved: 0, changesRequested: 0, total: live.length, released: [], writable: [], waitingOnSignoff: [], line };
}

/**
 * Read a project's gate and write it back: each batch's gate and counts, and
 * on each page its batch's line and whether it is released. Writes only what
 * changed, per key. Returns the project's read.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param now - The clock (tests).
 */
export async function refreshSeoProject(orgId: string, projectId: number, now: Date = new Date()): Promise<ProjectGateRead> {
  const read = await readProjectGate(orgId, projectId);
  for (const batch of read.batches) {
    const view = read.views.get(batch.id)!;
    const pages = read.pages.filter(p => p.meta.batchId === batch.id);
    const counts: Record<string, number> = {};
    for (const p of pages) {
      counts[p.meta.status] = (counts[p.meta.status] ?? 0) + 1;
    }
    const status: SeoBatchMeta['status'] = !planApproved(batch.meta)
      ? 'plan_review'
      : view.total > 0 && view.approved === view.total
        ? 'done'
        : view.writable.length > 0 ? (view.written > 0 ? 'writing' : 'planned') : 'waiting';
    const { released, writable, feedbackToFile, waitingOnSignoff, sample, ...shown } = view;
    const planWaiting = batch.meta.plan?.state === 'plan_review' ? 1 : 0;
    await mergeMeta<SeoBatchMeta>(orgId, batch.id, () => ({
      status,
      counts,
      waitingOnYou: waitingOnSignoff.length + feedbackToFile.filter(id => pages.some(p => p.id === id)).length + planWaiting,
      gate: { ...shown, sample: read.config.sample, tranche: read.config.tranche, updatedAt: now.toISOString() },
    }));
    const line = `${batch.title} · ${view.line}`;
    for (const p of pages) {
      const isReleased = released.includes(p.id);
      if (p.meta.batchLine !== line || p.meta.released !== isReleased) {
        await mergeMeta<SeoPageMeta>(orgId, p.id, () => ({ batchLine: line, released: isReleased }));
      }
    }
  }
  return read;
}

/**
 * Re-read the gate of a batch's project and write it back; the batch's view
 * of it, or null when the batch is gone.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 * @param now - The clock (tests).
 */
export async function refreshSeoBatch(orgId: string, batchId: number, now: Date = new Date()): Promise<GateState | null> {
  const batch = await getSeoBatch(orgId, batchId);
  if (!batch) {
    return null;
  }
  const read = await refreshSeoProject(orgId, batch.meta.projectId, now);
  return read.views.get(batchId) ?? null;
}

/**
 * The gate as it stands for one batch, read fresh (nothing written): the
 * batch, its pages, its view of the project's gate, and the project's gate.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 */
export async function readSeoGate(orgId: string, batchId: number): Promise<{ batch: SeoBatchRecord; pages: SeoPageRecord[]; gate: GateState; project: GateState; planSignedOff: boolean } | null> {
  const batch = await getSeoBatch(orgId, batchId);
  if (!batch) {
    return null;
  }
  const read = await readProjectGate(orgId, batch.meta.projectId);
  return {
    batch,
    pages: read.pages.filter(p => p.meta.batchId === batchId),
    gate: read.views.get(batchId)!,
    project: read.gate,
    planSignedOff: planApproved(batch.meta),
  };
}
