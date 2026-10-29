/**
 * The Prompts register — `seo_prompt`, one row per AI-answer prompt per
 * client project: the question buyers ask an AI assistant ("best invoicing
 * tool for agencies"), which kind of question it is, the platforms it is
 * tracked on, and whether the client is mentioned or cited there, with the
 * competitors that are, and when that was checked.
 *
 * Code writes every row, the same way the Keywords register does: the
 * strategist's proposed prompts are saved by `seo_save_prompts` and an
 * Ahrefs Brand Radar export by `seo_import_prompts`, both through
 * `keepPrompts`, which upserts on the project and the prompt as it is
 * compared (`promptKey`, held unique by the database through the external
 * key `seo-prompt` / `<project>:<key>`). A second save refreshes the row,
 * never adds one; an older check never overwrites a newer one. Export
 * (`toBrandRadarCsv`) writes the rows back as a CSV Brand Radar reads, and
 * reading that CSV back gives the same rows.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { getObjectTypeBySlug } from '@/services/BusinessObjectService';
import { readSeoProject } from './projects';
import { mergeMeta } from './records';

export const SEO_PROMPT_TYPE = 'seo_prompt';
export const PROMPT_EXTERNAL_SYSTEM = 'seo-prompt';

export const PROMPT_GROUPS = ['category', 'shortlist', 'problem', 'comparison', 'brand'] as const;
export type PromptGroup = typeof PROMPT_GROUPS[number];
export const GROUP_LABEL: Record<PromptGroup, string> = { category: 'Category', shortlist: 'Shortlist', problem: 'Problem', comparison: 'Comparison', brand: 'Brand' };

export const AI_PLATFORMS = ['chatgpt', 'google_ai_overviews', 'google_ai_mode', 'perplexity', 'gemini', 'copilot', 'claude'] as const;
export type AiPlatform = typeof AI_PLATFORMS[number];
export const PLATFORM_LABEL: Record<AiPlatform, string> = { chatgpt: 'ChatGPT', google_ai_overviews: 'AI Overviews', google_ai_mode: 'AI Mode', perplexity: 'Perplexity', gemini: 'Gemini', copilot: 'Copilot', claude: 'Claude' };

export const PROMPT_SOURCES = ['agent', 'imported'] as const;
export type PromptSource = typeof PROMPT_SOURCES[number];

export type SeoPromptMeta = {
  projectId: number;
  projectName?: string;
  prompt: string;
  promptKey: string;
  group?: PromptGroup;
  groupLabel?: string;
  intent?: string;
  platforms: AiPlatform[];
  platformsLabel?: string;
  /** Whether the client is named in the answer; null or absent when not checked. */
  mentioned?: boolean | null;
  /** Whether a page of the client's is cited as a source. */
  cited?: boolean | null;
  citedUrls?: string[];
  competitorsMentioned?: string[];
  /** When the mention data was read, and where from. */
  checkedAt?: string;
  checkedWith?: string;
  /** Mentioned, cited, not mentioned, or not checked: the list's one column. */
  visibility?: 'cited' | 'mentioned' | 'absent' | 'unchecked';
  source: PromptSource;
  status: 'tracked' | 'dropped';
  why?: { text: string; at: string; by: string | null };
};

export type SeoPromptRecord = { id: number; title: string; meta: SeoPromptMeta };

/** One prompt as a save or an import hands it in. */
export type PromptInput = {
  prompt: string;
  group?: PromptGroup;
  intent?: string;
  platforms?: AiPlatform[];
  mentioned?: boolean | null;
  cited?: boolean | null;
  citedUrls?: string[];
  competitorsMentioned?: string[];
  checkedAt?: string;
  checkedWith?: string;
  why?: string;
};

/**
 * A prompt as compared: case, spacing, quotes and closing punctuation gone. Pure.
 * @param prompt - The prompt as written.
 */
export function promptKey(prompt: string): string {
  return prompt.toLowerCase().replace(/[“”"'‘’`]/g, '').replace(/\s+/g, ' ').trim().replace(/[?!.。]+$/u, '').trim();
}

const visibilityOf = (m: Pick<SeoPromptMeta, 'mentioned' | 'cited'>): SeoPromptMeta['visibility'] => (m.cited ? 'cited' : m.mentioned ? 'mentioned' : m.mentioned === false ? 'absent' : 'unchecked');

const uniq = <T extends string>(list: readonly T[]) => [...new Set(list.map(s => s.trim()).filter(Boolean))] as T[];

/**
 * What one save writes onto a row. The group, intent and why are taken when
 * given; platforms are added to; the mention data only when it is at least
 * as new as what the row holds. Pure.
 * @param current - The row as it stands.
 * @param p - What was handed in.
 * @param by - Who.
 * @param now - The clock.
 */
export function promptPatch(current: SeoPromptMeta, p: PromptInput, by: string | null, now: Date = new Date()): Partial<SeoPromptMeta> {
  const patch: Partial<SeoPromptMeta> = {};
  if (p.group && p.group !== current.group) {
    patch.group = p.group;
    patch.groupLabel = GROUP_LABEL[p.group];
  }
  if (p.intent?.trim()) {
    patch.intent = p.intent.trim();
  }
  const platforms = uniq([...(current.platforms ?? []), ...(p.platforms ?? [])]).filter(x => (AI_PLATFORMS as readonly string[]).includes(x)) as AiPlatform[];
  if (platforms.join() !== (current.platforms ?? []).join()) {
    patch.platforms = platforms;
    patch.platformsLabel = platforms.map(x => PLATFORM_LABEL[x]).join(', ');
  }
  const hasCheck = p.mentioned !== undefined || p.cited !== undefined || (p.competitorsMentioned?.length ?? 0) > 0;
  if (hasCheck && p.checkedAt && (!current.checkedAt || p.checkedAt >= current.checkedAt)) {
    Object.assign(patch, {
      mentioned: p.mentioned ?? null,
      cited: p.cited ?? null,
      citedUrls: p.citedUrls?.length ? uniq(p.citedUrls) : undefined,
      competitorsMentioned: p.competitorsMentioned?.length ? uniq(p.competitorsMentioned) : undefined,
      checkedAt: p.checkedAt,
      checkedWith: p.checkedWith,
    });
    patch.visibility = visibilityOf({ mentioned: patch.mentioned, cited: patch.cited });
  }
  if (p.why?.trim()) {
    patch.why = { text: p.why.trim(), at: now.toISOString(), by };
  }
  return patch;
}

/** Saved rows, for the tool's answer. */
export type KeptPrompts = { project: { id: number; title: string }; rows: Array<{ id: number; prompt: string; created: boolean; visibility?: SeoPromptMeta['visibility'] }> };

/**
 * Keep prompts for a project: one row per prompt key, refreshed rather than
 * duplicated, inputs with the same key merged first (an export lists a prompt
 * once per platform). Null when the project or the type is missing.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param items - The prompts.
 * @param opts - Where they came from and who.
 * @param opts.source
 * @param opts.by
 */
export async function keepPrompts(orgId: string, projectId: number, items: readonly PromptInput[], opts: { source: PromptSource; by: string }): Promise<KeptPrompts | null> {
  const [type, project] = await Promise.all([getObjectTypeBySlug(orgId, SEO_PROMPT_TYPE), readSeoProject(orgId, projectId)]);
  if (!type || !project) {
    return null;
  }
  const rows: KeptPrompts['rows'] = [];
  for (const p of mergePromptInputs(items)) {
    const key = promptKey(p.prompt);
    const externalId = `${project.id}:${key}`;
    const meta: SeoPromptMeta = { projectId: project.id, projectName: project.title, prompt: p.prompt.trim(), promptKey: key, platforms: [], source: opts.source, status: 'tracked', visibility: 'unchecked' };
    const [inserted] = await db
      .insert(businessObjectSchema)
      .values({ orgId, typeId: type.id, title: p.prompt.trim().slice(0, 300), status: 'active', metadata: meta, externalSystem: PROMPT_EXTERNAL_SYSTEM, externalId, createdBy: opts.by })
      .onConflictDoNothing({ target: [businessObjectSchema.orgId, businessObjectSchema.externalSystem, businessObjectSchema.externalId] })
      .returning({ id: businessObjectSchema.id, title: businessObjectSchema.title });
    let id: number;
    if (inserted) {
      id = inserted.id;
      const { announceObjectCreated } = await import('@/services/objects/objectCreated');
      await announceObjectCreated(orgId, inserted, SEO_PROMPT_TYPE, { source: 'service', actor: opts.by });
    } else {
      const [existing] = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.externalSystem, PROMPT_EXTERNAL_SYSTEM), eq(businessObjectSchema.externalId, externalId))).limit(1);
      id = existing!.id;
    }
    const written = await mergeMeta<SeoPromptMeta>(orgId, id, current => promptPatch(current, p, opts.by.startsWith('agent:') ? null : opts.by));
    rows.push({ id, prompt: written?.prompt ?? p.prompt, created: Boolean(inserted), visibility: written?.visibility });
  }
  return { project: { id: project.id, title: project.title }, rows };
}

/**
 * Inputs with the same prompt key merged: platforms added, the newest check
 * kept, a mention or citation on any platform counted. Pure.
 * @param items - The inputs.
 */
export function mergePromptInputs(items: readonly PromptInput[]): PromptInput[] {
  const by = new Map<string, PromptInput>();
  for (const p of items) {
    const key = promptKey(p.prompt);
    if (!key) {
      continue;
    }
    const was = by.get(key);
    if (!was) {
      by.set(key, { ...p, platforms: [...(p.platforms ?? [])] });
      continue;
    }
    const either = (a: boolean | null | undefined, b: boolean | null | undefined) => (a === true || b === true ? true : a === false || b === false ? false : (a ?? b));
    by.set(key, {
      ...was,
      group: was.group ?? p.group,
      intent: was.intent ?? p.intent,
      platforms: uniq([...(was.platforms ?? []), ...(p.platforms ?? [])]),
      mentioned: either(was.mentioned, p.mentioned),
      cited: either(was.cited, p.cited),
      citedUrls: uniq([...(was.citedUrls ?? []), ...(p.citedUrls ?? [])]),
      competitorsMentioned: uniq([...(was.competitorsMentioned ?? []), ...(p.competitorsMentioned ?? [])]),
      checkedAt: [was.checkedAt, p.checkedAt].filter(Boolean).sort().at(-1),
      checkedWith: was.checkedWith ?? p.checkedWith,
      why: was.why ?? p.why,
    });
  }
  return [...by.values()];
}

/**
 * A project's prompts.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function listProjectPrompts(orgId: string, projectId: number): Promise<SeoPromptRecord[]> {
  const type = await getObjectTypeBySlug(orgId, SEO_PROMPT_TYPE);
  if (!type) {
    return [];
  }
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), sql`${businessObjectSchema.metadata}->>'projectId' = ${String(projectId)}`)).orderBy(businessObjectSchema.id);
  return rows.map(r => ({ id: r.id, title: r.title, meta: r.metadata as SeoPromptMeta }));
}

/**
 * Prompts by id, this workspace's only.
 * @param orgId - The workspace.
 * @param ids - The rows.
 */
export async function getPromptRows(orgId: string, ids: readonly number[]): Promise<SeoPromptRecord[]> {
  const type = await getObjectTypeBySlug(orgId, SEO_PROMPT_TYPE);
  if (!type || ids.length === 0) {
    return [];
  }
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), inArray(businessObjectSchema.id, [...new Set(ids)])));
  return rows.map(r => ({ id: r.id, title: r.title, meta: r.metadata as SeoPromptMeta }));
}

/**
 * Drop prompts (with why) or restore them.
 * @param orgId - The workspace.
 * @param ids - The rows.
 * @param change - Drop or restore, and why.
 * @param change.drop
 * @param change.why
 * @param by - Who.
 */
export async function setPromptsTracked(orgId: string, ids: readonly number[], change: { drop: boolean; why?: string }, by: string | null): Promise<string[]> {
  const out: string[] = [];
  for (const row of await getPromptRows(orgId, ids)) {
    await mergeMeta<SeoPromptMeta>(orgId, row.id, () => ({ status: change.drop ? 'dropped' : 'tracked', ...(change.why ? { why: { text: change.why, at: new Date().toISOString(), by } } : {}) }));
    out.push(`#${row.id} "${row.meta.prompt}": ${change.drop ? 'dropped' : 'tracked'}`);
  }
  return out;
}

// --- CSV: Ahrefs Brand Radar in and out --------------------------------------

/**
 * A CSV parsed into rows of cells: quoted cells, doubled quotes, commas,
 * tabs or semicolons as the separator (read off the header), CRLF. Pure.
 * @param text - The file.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const head = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', '\t', ';'].sort((a, b) => head.split(b).length - head.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') {
        i++;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** The columns a Brand Radar export (or a hand-made sheet) may name, by what they hold. */
const COLUMNS: Record<string, RegExp> = {
  prompt: /^(?:prompt|prompts|query|question|search|ai prompt|keyword)$/i,
  platform: /^(?:platform|platforms|ai platform|model|engine|ai engine|llm|source|chatbot)$/i,
  mentioned: /^(?:mentioned|brand mentioned|mention|mentions|brand mentions|mentions brand|is mentioned|your brand mentioned)$/i,
  cited: /^(?:cited|citation|citations|cited pages|cited urls|brand cited|your pages cited|is cited|cited url)$/i,
  competitors: /^(?:competitors|competitors mentioned|competitor mentions|other brands|brands mentioned|brands)$/i,
  checked: /^(?:date|checked|checked at|last checked|updated|last updated|crawled|crawl date)$/i,
  group: /^(?:group|category|topic|tag|tags|type|prompt type)$/i,
  intent: /^(?:intent|search intent)$/i,
};

/**
 * A platform from what an export calls it. Pure.
 * @param raw - "ChatGPT", "AI Overview", "perplexity".
 */
export function platformFrom(raw: string): AiPlatform | null {
  const n = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!n) {
    return null;
  }
  const hit = AI_PLATFORMS.find(p => p.replace(/_/g, '') === n || PLATFORM_LABEL[p].toLowerCase().replace(/[^a-z]/g, '') === n);
  if (hit) {
    return hit;
  }
  if (/chatgpt|openai|gpt/.test(n)) {
    return 'chatgpt';
  }
  if (/aioverview|sge/.test(n)) {
    return 'google_ai_overviews';
  }
  if (/aimode/.test(n)) {
    return 'google_ai_mode';
  }
  return (['perplexity', 'gemini', 'copilot', 'claude'] as const).find(p => n.includes(p)) ?? null;
}

const yes = (v: string): boolean | null => {
  const s = v.trim().toLowerCase();
  if (!s || s === '-' || s === 'n/a') {
    return null;
  }
  if (/^(?:yes|[y1x✓]|true|mentioned|cited)$/.test(s)) {
    return true;
  }
  if (/^(?:no|n|false|0|not mentioned|not cited)$/.test(s)) {
    return false;
  }
  const num = Number(s);
  // A count of mentions, or a list of cited pages, is a yes.
  return Number.isFinite(num) ? num > 0 : true;
};

const list = (v: string) => v.split(/[;|\n]|,\s*/).map(s => s.trim()).filter(Boolean);

/** A parsed import: the prompts, which columns were read, and what was left out. */
export type BrandRadarImport = { prompts: PromptInput[]; columns: Record<string, string>; ignored: string[]; skipped: number };

/**
 * An Ahrefs Brand Radar CSV export (or any sheet of prompts) read into
 * prompts. Columns are found by their header, whatever order they come in;
 * rows of the same prompt (one per platform) merge; each column read and
 * each one left out is named, so a person can check it. A dated row keeps
 * its date; an undated one is dated `importedAt`. Pure.
 * @param text - The file.
 * @param importedAt - When it was imported.
 */
export function parseBrandRadarCsv(text: string, importedAt: string): BrandRadarImport {
  const [header, ...body] = parseCsv(text);
  if (!header) {
    return { prompts: [], columns: {}, ignored: [], skipped: 0 };
  }
  const at: Record<string, number> = {};
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const name = h.trim();
    const kind = Object.keys(COLUMNS).find(k => COLUMNS[k]!.test(name));
    if (kind && at[kind] === undefined) {
      at[kind] = i;
    } else if (name) {
      ignored.push(name);
    }
  });
  const columns = Object.fromEntries(Object.entries(at).map(([k, i]) => [k, header[i]!.trim()]));
  if (at.prompt === undefined) {
    return { prompts: [], columns, ignored, skipped: body.length };
  }
  let skipped = 0;
  const prompts: PromptInput[] = [];
  for (const r of body) {
    const cell = (k: string) => (at[k] === undefined ? '' : (r[at[k]!] ?? '').trim());
    const prompt = cell('prompt');
    if (!prompt) {
      skipped++;
      continue;
    }
    const platforms = list(cell('platform')).map(platformFrom).filter((p): p is AiPlatform => p !== null);
    const groupRaw = cell('group').toLowerCase();
    const group = PROMPT_GROUPS.find(g => groupRaw === g || groupRaw.startsWith(g));
    const cited = cell('cited');
    const checkedRaw = cell('checked');
    const checked = checkedRaw && !Number.isNaN(Date.parse(checkedRaw)) ? new Date(Date.parse(checkedRaw)).toISOString() : importedAt;
    // An empty cell is "not checked", never "no".
    const mentioned = at.mentioned === undefined ? undefined : (yes(cell('mentioned')) ?? undefined);
    const citedYes = at.cited === undefined ? undefined : (yes(cited) ?? undefined);
    prompts.push({
      prompt,
      ...(group ? { group } : {}),
      ...(cell('intent') ? { intent: cell('intent') } : {}),
      platforms,
      ...(mentioned !== undefined ? { mentioned } : {}),
      ...(citedYes !== undefined ? { cited: citedYes } : {}),
      ...(/https?:\/\//.test(cited) ? { citedUrls: list(cited).filter(u => /^https?:\/\//.test(u)) } : {}),
      ...(cell('competitors') ? { competitorsMentioned: list(cell('competitors')) } : {}),
      ...(mentioned !== undefined || citedYes !== undefined || cell('competitors') ? { checkedAt: checked, checkedWith: 'Ahrefs Brand Radar export' } : {}),
    });
  }
  return { prompts: mergePromptInputs(prompts), columns, ignored, skipped };
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const yesNo = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');

/** The export's columns, in order: the prompt first, as Brand Radar's custom prompts read it. */
export const EXPORT_COLUMNS = ['Prompt', 'Group', 'Intent', 'Platforms', 'Mentioned', 'Cited', 'Competitors mentioned', 'Last checked'] as const;

/**
 * A project's tracked prompts as a CSV for Brand Radar (its custom prompts
 * take the first column) and for a person's sheet. Reading it back with
 * `parseBrandRadarCsv` gives the same prompts. Pure.
 * @param rows - The prompts.
 */
export function toBrandRadarCsv(rows: ReadonlyArray<Pick<SeoPromptMeta, 'prompt' | 'group' | 'intent' | 'platforms' | 'mentioned' | 'cited' | 'competitorsMentioned' | 'checkedAt'>>): string {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.prompt,
      r.group ?? '',
      r.intent ?? '',
      (r.platforms ?? []).map(p => PLATFORM_LABEL[p]).join('; '),
      yesNo(r.mentioned),
      yesNo(r.cited),
      (r.competitorsMentioned ?? []).join('; '),
      r.checkedAt ?? '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
