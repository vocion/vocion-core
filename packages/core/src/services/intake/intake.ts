/**
 * LIST INTAKE — files dropped into a conversation become typed records.
 *
 * A person drops scanned badges, business cards, notes or a spreadsheet into
 * chat and says what they are. The agent calls `extract_records` with the
 * type to file them as and a name for the data room that keeps the files;
 * this is what that call does, and nothing in it knows what a badge or a lead
 * is:
 *
 *   1. the files are filed into the room the agent named (found by title, or
 *      opened), each anchored to it so it is evidence of the room, not of the
 *      first record written after it (`services/objects/reported.ts`);
 *   2. each file is read once (`read.ts`) into the type's declared fields,
 *      with a confidence and a page or row for every value;
 *   3. reads of one person are folded together, then matched against records
 *      of the type and CRM-synced contacts (`dedupe.ts`);
 *   4. what is clear is written as records — each field's provenance on the
 *      record (which file, which page, how sure) — and what is not (a file
 *      that could not be read, a record the reader was unsure of, a person
 *      already on file) is returned for ONE Decision the agent raises in its
 *      turn (`intakeDecision`), whose options settle them through
 *      `records.settle_intake`.
 *
 * Records are the truth; the room, the list and any page about them are views.
 * A file read once is not read (or charged) again.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Buffer } from 'node:buffer';
import type { DraftRecord, ExistingMatch } from './dedupe';
import type { IntakeField, IntakeIdentity } from './fields';
import type { IntakeSource, ReadOutcome } from './read';
import type { ArtifactRow } from '@/services/ArtifactService';
import { dedupeBatch, valuesOf } from './dedupe';
import { coerceValue, intakeFields, intakeIdentity, intakeTitle } from './fields';

/** Below this, a value or a record is the person's call. */
export const DEFAULT_MIN_CONFIDENCE = 0.6;
/** Files read at once. */
export const READ_CONCURRENCY = 4;
/** Files one call takes. */
export const MAX_INTAKE_FILES = 60;

export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeError';
  }
}

/** Where one value came from, kept on the record. */
export type FieldProvenance = {
  artifactId?: number;
  file?: string;
  page?: number;
  row?: number;
  confidence: number;
  quote?: string;
  /** `conversation` when the agent set it from what the person said, not from a file. */
  from?: 'file' | 'conversation';
};

/** A record's `provenance` column, as intake writes it. */
export type IntakeProvenance = {
  intake: { batch: string; roomId: number | null; at: string; by: string };
  sources: Array<{ artifactId: number; file: string }>;
  fields: Record<string, FieldProvenance>;
  notes?: string[];
};

/** Something the person decides, carried whole on the Decision's options. */
export type PendingItem = {
  key: string;
  reason: 'unreadable' | 'uncertain' | 'duplicate';
  /** What the person reads: a name, or the file's. */
  label: string;
  /** One line of why. */
  why: string;
  file: string;
  artifactId: number;
  /** The values to write, for an uncertain or duplicate record. */
  values?: Record<string, unknown>;
  provenance?: IntakeProvenance;
  match?: ExistingMatch;
};

export type IntakeInput = {
  orgId: string;
  /** The person whose turn it is; records are written as theirs. */
  userId: string | null;
  agentSlug: string | null;
  conversationId: number | null;
  /** The object type to file the records as. */
  objectType: string;
  /** Uploads to read; this conversation's uploads not yet read when absent. */
  artifactIds?: number[];
  /** The data room the files are kept in, named by the agent from context. */
  roomTitle: string;
  /** Values every record gets, from what the person said ("met at Northwind Expo 2026", "met by Alex"). */
  set?: Record<string, unknown>;
  /** What the person said the files are, for the reader. */
  hint?: string;
  /** Override the type's identity fields. */
  identity?: IntakeIdentity;
  minConfidence?: number;
  /** Test seams. */
  model?: BaseChatModel;
  readImage?: (filename: string) => Promise<Buffer | null>;
};

export type IntakeResult = {
  batch: string;
  objectType: { slug: string; label: string };
  room: { id: number; title: string; href: string; created: boolean };
  created: Array<{ id: number; title: string; href: string }>;
  pending: PendingItem[];
  /** Files left alone because records already cite them. */
  alreadyRead: Array<{ artifactId: number; file: string }>;
  /** Readings folded into another of the same person. */
  merged: number;
  /** `set` keys the type does not declare, dropped. */
  ignoredSet: string[];
  files: number;
};

/**
 * The batch's key: the files it read, so the same drop gives the same key.
 * @param artifactIds - The files.
 */
export function batchKey(artifactIds: readonly number[]): string {
  return `intake:${[...artifactIds].sort((a, b) => a - b).join('-')}`;
}

/**
 * A record's actor id as the write records it.
 * @param input - The call.
 */
function actorOf(input: Pick<IntakeInput, 'userId' | 'agentSlug'>): string {
  return input.userId ?? (input.agentSlug ? `agent:${input.agentSlug}` : 'system');
}

/**
 * Drafts from one file's read, values coerced to the type and kept only when
 * they fit. Pure.
 * @param source - The file.
 * @param outcome - What was read.
 * @param fields - The type's fields.
 */
export function draftsFrom(source: Pick<IntakeSource, 'artifactId' | 'title'>, outcome: Extract<ReadOutcome, { status: 'read' }>, fields: readonly IntakeField[]): DraftRecord[] {
  const byName = new Map(fields.map(f => [f.name, f]));
  return outcome.records.map((r, i) => {
    const out: DraftRecord['fields'] = {};
    for (const [name, v] of Object.entries(r.fields)) {
      const field = byName.get(name);
      const value = field ? coerceValue(field, v.value) : undefined;
      if (value !== undefined) {
        out[name] = { ...v, value, artifactId: source.artifactId, file: source.title };
      }
    }
    return { key: `${source.artifactId}:${i}`, fields: out, confidence: r.confidence, sources: [{ artifactId: source.artifactId, file: source.title }], notes: r.note ? [r.note] : [] };
  });
}

/**
 * What a draft becomes: written, or held for the person and why. Pure.
 * @param d - The draft.
 * @param ctx - The rule.
 * @param ctx.identity - Which fields identify.
 * @param ctx.fields - The type's fields.
 * @param ctx.minConfidence - The bar.
 * @param ctx.match - What is already on file, if anything.
 */
export function judgeDraft(d: DraftRecord, ctx: { identity: IntakeIdentity; fields: readonly IntakeField[]; minConfidence: number; match?: ExistingMatch }): { write: true; title: string } | { write: false; reason: 'uncertain' | 'duplicate'; why: string; title: string | null } {
  const title = intakeTitle(valuesOf(d), ctx.identity, ctx.fields);
  if (ctx.match) {
    const where = ctx.match.kind === 'crm' ? `already in ${ctx.match.systemLabel} as ${ctx.match.title}` : `already on file as ${ctx.match.title}`;
    return { write: false, reason: 'duplicate', why: `${where} (same ${ctx.match.on === 'email' ? 'email' : 'name and company'})`, title };
  }
  if (!title) {
    return { write: false, reason: 'uncertain', why: 'no name could be read', title: null };
  }
  if (d.confidence < ctx.minConfidence) {
    return { write: false, reason: 'uncertain', why: `the reader was ${Math.round(d.confidence * 100)}% sure it is one whole record${d.notes[0] ? ` (${d.notes[0]})` : ''}`, title };
  }
  const shaky = [ctx.identity.name, ctx.identity.email, ctx.identity.company]
    .filter((f): f is string => Boolean(f))
    .filter(f => d.fields[f] && d.fields[f]!.confidence < ctx.minConfidence);
  if (shaky.length > 0) {
    return { write: false, reason: 'uncertain', why: `${shaky.join(' and ')} ${shaky.length === 1 ? 'is' : 'are'} hard to read`, title };
  }
  return { write: true, title };
}

/**
 * The provenance a draft is written with. Pure.
 * @param d - The draft.
 * @param ctx - The batch.
 * @param ctx.batch - Its key.
 * @param ctx.roomId - The room.
 * @param ctx.by - Who wrote it.
 * @param ctx.set - Values the agent set from the conversation.
 * @param ctx.at - When.
 */
export function provenanceOf(d: DraftRecord, ctx: { batch: string; roomId: number | null; by: string; set: Record<string, unknown>; at: Date }): IntakeProvenance {
  const fields: Record<string, FieldProvenance> = {};
  for (const [name, v] of Object.entries(d.fields)) {
    fields[name] = {
      artifactId: v.artifactId,
      file: v.file,
      confidence: v.confidence,
      from: 'file',
      ...(v.page ? { page: v.page } : {}),
      ...(v.row ? { row: v.row } : {}),
      ...(v.quote ? { quote: v.quote } : {}),
    };
  }
  for (const name of Object.keys(ctx.set)) {
    if (!fields[name]) {
      fields[name] = { confidence: 1, from: 'conversation' };
    }
  }
  return {
    intake: { batch: ctx.batch, roomId: ctx.roomId, at: ctx.at.toISOString(), by: ctx.by },
    sources: d.sources,
    fields,
    ...(d.notes.length > 0 ? { notes: d.notes } : {}),
  };
}

/**
 * Write one record with its provenance, as the person (or agent) whose turn
 * it is. Returns its id, title and link.
 * @param opts - The write.
 * @param opts.orgId - The workspace.
 * @param opts.typeSlug - The type.
 * @param opts.title - Its title.
 * @param opts.values - Its fields.
 * @param opts.provenance - Where each came from.
 * @param opts.actor - Who.
 * @param opts.conversationId - Where it was asked for.
 * @param opts.externalKey - The CRM record it mirrors, when it is one.
 * @param opts.externalKey.system - The CRM.
 * @param opts.externalKey.id - Its id there.
 */
export async function writeIntakeRecord(opts: { orgId: string; typeSlug: string; title: string; values: Record<string, unknown>; provenance: IntakeProvenance; actor: string; conversationId: number | null; externalKey?: { system: string; id: string } }): Promise<{ id: number; title: string; href: string; created: boolean }> {
  const { createBusinessObject, upsertBusinessObjectByExternalKey } = await import('@/services/BusinessObjectService');
  const [{ and, eq }, { db }, { businessObjectSchema }, { recordHref }] = await Promise.all([
    import('drizzle-orm'),
    import('@/libs/DB'),
    import('@/models/Schema'),
    import('@/services/objects/recordHref'),
  ]);
  let id: number;
  let created = true;
  if (opts.externalKey) {
    const res = await upsertBusinessObjectByExternalKey({ typeSlug: opts.typeSlug, title: opts.title, metadata: opts.values, externalKey: opts.externalKey }, opts.orgId, opts.actor);
    id = res.object.id;
    created = res.created;
  } else {
    const row = await createBusinessObject(
      { typeSlug: opts.typeSlug, title: opts.title, metadata: opts.values },
      opts.orgId,
      opts.actor,
      { source: 'service', conversationId: opts.conversationId, actor: opts.actor },
    );
    id = row!.id;
  }
  await db.update(businessObjectSchema).set({ provenance: opts.provenance as unknown as Record<string, unknown> }).where(and(eq(businessObjectSchema.orgId, opts.orgId), eq(businessObjectSchema.id, id)));
  const href = await recordHref(opts.orgId, { objectType: opts.typeSlug, id }).catch(() => `/dashboard/objects/${id}`);
  return { id, title: opts.title, href, created };
}

/**
 * Fill a record already on file with what was read: empty fields only, so
 * nothing a person wrote is overwritten; the new files join its provenance.
 * Returns what it was before, for Undo.
 * @param opts - The merge.
 * @param opts.orgId - The workspace.
 * @param opts.recordId - The record on file.
 * @param opts.values - What was read.
 * @param opts.provenance - Where it came from.
 */
export async function mergeIntoRecord(opts: { orgId: string; recordId: number; values: Record<string, unknown>; provenance: IntakeProvenance }): Promise<{ id: number; title: string; filled: string[]; before: { metadata: Record<string, unknown>; provenance: Record<string, unknown> | null } } | null> {
  const { getBusinessObject, updateBusinessObject } = await import('@/services/BusinessObjectService');
  const [{ and, eq }, { db }, { businessObjectSchema }] = await Promise.all([import('drizzle-orm'), import('@/libs/DB'), import('@/models/Schema')]);
  const row = await getBusinessObject(opts.recordId, opts.orgId);
  if (!row) {
    return null;
  }
  const meta = { ...(row.metadata ?? {}) };
  const filled: string[] = [];
  for (const [k, v] of Object.entries(opts.values)) {
    if (meta[k] === undefined || meta[k] === null || meta[k] === '') {
      meta[k] = v;
      filled.push(k);
    }
  }
  const prior = (row.provenance ?? null) as Partial<IntakeProvenance> | null;
  const provenance: IntakeProvenance = {
    intake: opts.provenance.intake,
    sources: [...(prior?.sources ?? []), ...opts.provenance.sources.filter(s => !(prior?.sources ?? []).some(p => p.artifactId === s.artifactId))],
    fields: { ...(prior?.fields ?? {}), ...Object.fromEntries(filled.map(f => [f, opts.provenance.fields[f]!]).filter(([, p]) => p)) },
    ...(prior?.notes || opts.provenance.notes ? { notes: [...(prior?.notes ?? []), ...(opts.provenance.notes ?? [])] } : {}),
  };
  await updateBusinessObject({ id: row.id, metadata: meta }, opts.orgId);
  await db.update(businessObjectSchema).set({ provenance: { ...(prior ?? {}), ...provenance } as unknown as Record<string, unknown> }).where(and(eq(businessObjectSchema.orgId, opts.orgId), eq(businessObjectSchema.id, row.id)));
  return { id: row.id, title: row.title, filled, before: { metadata: row.metadata ?? {}, provenance: row.provenance ?? null } };
}

/**
 * The room the files are kept in: the open room with this title, or a new one.
 * @param orgId - The workspace.
 * @param actor - Who opens it.
 * @param title - Its name, as the agent gave it.
 */
async function roomFor(orgId: string, actor: string, title: string): Promise<{ id: number; title: string; href: string; created: boolean }> {
  const { createDataRoom, listDataRooms, roomHref } = await import('@/services/DataRoomService');
  const wanted = title.trim().toLowerCase();
  const held = (await listDataRooms(orgId)).find(r => r.title.trim().toLowerCase() === wanted && r.status !== 'closed');
  if (held) {
    return { id: held.id, title: held.title, href: roomHref(held.id), created: false };
  }
  const room = await createDataRoom(orgId, actor, { title: title.trim(), rules: ['Files dropped into chat are kept here as the evidence for the records read from them.'] });
  return { id: room.id, title: room.title, href: roomHref(room.id), created: true };
}

/**
 * The uploads a call reads: the ones named, else this conversation's.
 * @param input - The call.
 */
async function uploadsFor(input: IntakeInput): Promise<ArtifactRow[]> {
  const { listArtifactsByIds } = await import('@/services/ArtifactService');
  const isUpload = (a: ArtifactRow) => a.kind === 'file' && a.lastAuthorKind === 'human';
  if (input.artifactIds?.length) {
    return (await listArtifactsByIds({ orgId: input.orgId, ids: input.artifactIds })).filter(isUpload);
  }
  if (!input.conversationId) {
    return [];
  }
  const [{ and, asc, eq }, { db }, { artifactSchema }] = await Promise.all([import('drizzle-orm'), import('@/libs/DB'), import('@/models/Schema')]);
  return db
    .select()
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, input.orgId), eq(artifactSchema.conversationId, input.conversationId), eq(artifactSchema.kind, 'file'), eq(artifactSchema.lastAuthorKind, 'human')))
    .orderBy(asc(artifactSchema.id));
}

/** The role an intake gives a file it read: kept in a room, as that room's source. */
export const SOURCE_ROLE_PREFIX = 'source:';

/**
 * Whether intake has read this upload before: it files every file it reads
 * into a room as a source, so the anchor is the mark — a file that yielded
 * nothing, or only held items, is not read (and charged) a second time.
 * @param a - The upload.
 */
export function alreadyRead(a: Pick<ArtifactRow, 'recordType' | 'recordRole'>): boolean {
  return a.recordType === 'object' && typeof a.recordRole === 'string' && a.recordRole.startsWith(SOURCE_ROLE_PREFIX);
}

/**
 * An upload as the reader takes it.
 * @param a - The upload.
 * @param readImage - Reads stored bytes.
 */
async function sourceOf(a: ArtifactRow, readImage: (filename: string) => Promise<Buffer | null>): Promise<IntakeSource> {
  const spec = (a.spec ?? {}) as Record<string, unknown>;
  const contentType = typeof spec.contentType === 'string' ? spec.contentType : 'application/octet-stream';
  const base = { artifactId: a.id, title: typeof spec.originalName === 'string' ? spec.originalName : a.title, contentType };
  if (contentType.startsWith('image/')) {
    const bytes = typeof spec.filename === 'string' ? await readImage(spec.filename) : null;
    return bytes ? { ...base, imageDataUrl: `data:${contentType};base64,${bytes.toString('base64')}` } : base;
  }
  return { ...base, ...(typeof spec.text === 'string' ? { text: spec.text } : {}) };
}

/**
 * Read dropped files into records of a type.
 * @param input - The call.
 */
export async function intakeSources(input: IntakeInput): Promise<IntakeResult> {
  const { getObjectTypeBySlug, listObjectTypes } = await import('@/services/BusinessObjectService');
  const type = await getObjectTypeBySlug(input.orgId, input.objectType);
  if (!type) {
    const types = (await listObjectTypes(input.orgId)).map(t => t.slug).filter(s => s !== 'data_room');
    throw new IntakeError(`No object type "${input.objectType}" here.${types.length > 0 ? ` Types: ${types.join(', ')}.` : ' This workspace has no object types yet; turn on an app that brings one, or create one.'}`);
  }
  const fields = intakeFields(type.schema);
  if (fields.length === 0) {
    throw new IntakeError(`"${type.label}" declares no fields to read into.`);
  }
  const identity = intakeIdentity(type.schema, input.identity);
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const actor = actorOf(input);
  const known = new Set(fields.map(f => f.name));
  const set: Record<string, unknown> = {};
  const ignoredSet: string[] = [];
  for (const [k, v] of Object.entries(input.set ?? {})) {
    const field = fields.find(f => f.name === k);
    const value = field ? coerceValue(field, v) : undefined;
    if (known.has(k) && value !== undefined) {
      set[k] = value;
    } else {
      ignoredSet.push(k);
    }
  }

  const uploads = (await uploadsFor(input)).slice(0, MAX_INTAKE_FILES);
  if (uploads.length === 0) {
    throw new IntakeError(input.artifactIds?.length ? 'None of those ids is a file a person uploaded here.' : 'No files were dropped into this conversation to read.');
  }
  const fresh = uploads.filter(u => !alreadyRead(u));
  const skipped = uploads.filter(u => alreadyRead(u)).map(u => ({ artifactId: u.id, file: u.title }));
  if (fresh.length === 0) {
    throw new IntakeError(`Every file here has been read already (${skipped.map(f => f.file).join(', ')}). Drop new files to read them.`);
  }
  const batch = batchKey(fresh.map(u => u.id));

  const readImage = input.readImage ?? (await import('@/services/chat/attachments')).readStoredFile;
  const sources = await Promise.all(fresh.map(u => sourceOf(u, readImage)));
  const { readSource } = await import('./read');
  const { mapWithConcurrency } = await import('@/libs/concurrency');
  const reads = await mapWithConcurrency(sources, READ_CONCURRENCY, async (s): Promise<ReadOutcome> => {
    try {
      return await readSource(s, { orgId: input.orgId, agentSlug: input.agentSlug, userId: input.userId, typeLabel: type.label, fields, hint: input.hint, model: input.model });
    } catch (err) {
      // A file the model could not be asked about is a file the person hears
      // about, with the reason — never a silently shorter list.
      return { status: 'unreadable', reason: `the read failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` };
    }
  });

  // Each file is anchored to the room before any record is written: evidence
  // of the room, so the first record does not claim every upload in the
  // thread (`services/objects/reported.ts`), and the mark that it was read.
  const room = await roomFor(input.orgId, actor, input.roomTitle);
  const [{ anchorArtifact }, { fileToDataRoom }] = await Promise.all([import('@/services/ArtifactService'), import('@/services/DataRoomService')]);
  for (const u of fresh) {
    await anchorArtifact({ orgId: input.orgId, id: u.id, record: { type: 'object', id: String(room.id), role: `${SOURCE_ROLE_PREFIX}${u.id}` } });
    await fileToDataRoom(input.orgId, room.id, {
      artifactId: u.id,
      title: u.title,
      kind: 'attachment',
      rating: 2,
      channel: 'chat',
      author: { kind: input.agentSlug ? 'agent' : 'human', id: input.agentSlug ? `agent:${input.agentSlug}` : input.userId },
    });
  }

  const pending: PendingItem[] = [];
  const drafts: DraftRecord[] = [];
  sources.forEach((s, i) => {
    const r = reads[i]!;
    if (r.status === 'unreadable') {
      pending.push({ key: `${s.artifactId}:file`, reason: 'unreadable', label: s.title, why: r.reason, file: s.title, artifactId: s.artifactId });
      return;
    }
    drafts.push(...draftsFrom(s, r, fields));
  });
  const folded = dedupeBatch(drafts, identity);
  const { matchExisting } = await import('./dedupe');
  const matches = await matchExisting({ orgId: input.orgId, typeId: type.id, identity, drafts: folded.drafts });

  const at = new Date();
  const created: IntakeResult['created'] = [];
  for (const d of folded.drafts) {
    // The agent's values ride on every record, but never over what a file said.
    const values = { ...set, ...valuesOf(d) };
    const provenance = provenanceOf(d, { batch, roomId: room.id, by: actor, set, at });
    const match = matches.get(d.key);
    const verdict = judgeDraft(d, { identity, fields, minConfidence, match });
    const first = d.sources[0]!;
    if (!verdict.write) {
      pending.push({ key: d.key, reason: verdict.reason, label: verdict.title ?? `a record on ${first.file}`, why: verdict.why, file: first.file, artifactId: first.artifactId, values, provenance, ...(match ? { match } : {}) });
      continue;
    }
    const written = await writeIntakeRecord({ orgId: input.orgId, typeSlug: type.slug, title: verdict.title, values, provenance, actor, conversationId: input.conversationId });
    created.push({ id: written.id, title: written.title, href: written.href });
  }

  return {
    batch,
    objectType: { slug: type.slug, label: type.label },
    room,
    created,
    pending,
    alreadyRead: skipped,
    merged: folded.merged,
    ignoredSet,
    files: uploads.length,
  };
}

/** The settle action's id; the Decision's options run it. */
export const SETTLE_INTAKE_ACTION = 'records.settle_intake';

/** One option of the intake Decision, in the ask's own shape. */
export type IntakeDecisionOption = { id: string; label: string; description?: string; recommended?: boolean; action?: { id: string; input: Record<string, unknown> } };

/**
 * The ONE Decision for what intake could not settle on its own: "2 unreadable
 * · 3 already in HubSpot — merge?". Null when there is nothing to decide. Pure.
 * @param result - The intake.
 * @param ctx - Where.
 * @param ctx.conversationId - The thread the records were asked for in.
 */
export function intakeDecision(result: Pick<IntakeResult, 'pending' | 'batch' | 'objectType' | 'room'> & { created?: IntakeResult['created'] }, ctx: { conversationId: number | null }): { question: string; body: string; contextMd: string; options: IntakeDecisionOption[]; sourceRef: string } | null {
  if (result.pending.length === 0) {
    return null;
  }
  const unreadable = result.pending.filter(p => p.reason === 'unreadable');
  const unsure = result.pending.filter(p => p.reason === 'uncertain');
  const dupes = result.pending.filter(p => p.reason === 'duplicate');
  const crm = dupes.filter(p => p.match?.kind === 'crm');
  const onFile = dupes.filter(p => p.match?.kind === 'record');
  const systems = [...new Set(crm.map(p => (p.match as Extract<ExistingMatch, { kind: 'crm' }>).systemLabel))];
  const parts = [
    unreadable.length ? `${unreadable.length} unreadable` : null,
    crm.length ? `${crm.length} already in ${systems.join(' and ')}` : null,
    onFile.length ? `${onFile.length} already on file` : null,
    unsure.length ? `${unsure.length} unsure` : null,
  ].filter(Boolean);
  const actionable = [...dupes, ...unsure];
  const ask = dupes.length > 0 ? 'merge?' : unsure.length > 0 ? 'add them?' : 'leave them out?';
  const question = `${parts.join(' · ')} — ${ask}`;
  const base = { objectType: result.objectType.slug, roomId: result.room.id, batch: result.batch, conversationId: ctx.conversationId, items: actionable.map(({ key, reason, label, values, provenance, match }) => ({ key, reason, label, values, provenance, match })) };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const options: IntakeDecisionOption[] = [];
  if (dupes.length > 0) {
    options.push({
      id: 'merge',
      label: unsure.length > 0 ? `Merge ${dupes.length} into what's on file, add ${unsure.length}` : dupes.length === 1 ? 'Merge it into what\'s on file' : `Merge all ${dupes.length} into what's on file`,
      description: `Fills empty fields on the existing ${dupes.length === 1 ? 'record' : 'records'}${crm.length > 0 ? ` (a CRM contact gets a ${result.objectType.label} linked to it)` : ''}; nothing already written is overwritten.`,
      recommended: true,
      action: { id: SETTLE_INTAKE_ACTION, input: { ...base, choice: 'merge' } },
    });
  }
  if (actionable.length > 0) {
    options.push({
      id: 'add',
      label: dupes.length > 0 ? `Add all ${actionable.length} as new` : unsure.length === 1 ? 'Add it as a record' : `Add all ${unsure.length} as records`,
      ...(dupes.length > 0 ? {} : { recommended: true }),
      action: { id: SETTLE_INTAKE_ACTION, input: { ...base, choice: 'add' } },
    });
  }
  options.push({ id: 'skip', label: actionable.length > 0 ? 'Leave them out' : 'OK, leave them out', ...(actionable.length === 0 ? { recommended: true } : {}) });

  const row = (p: PendingItem) => {
    const what = p.reason === 'unreadable' ? 'unreadable' : p.reason === 'duplicate' ? 'already there' : 'unsure';
    return `| ${p.label.replace(/\|/g, '/')} | ${what} | ${p.why.replace(/\|/g, '/')} | ${p.file.replace(/\|/g, '/')} |`;
  };
  // The turn ends at this card, so it is where the person reads what was added.
  const created = result.created ?? [];
  const contextMd = [
    `Read into **${result.objectType.label}** records; the files are in [${result.room.title}](${result.room.href}).`,
    ...(created.length > 0 ? ['', `Added: ${created.map(c => `[${c.title}](${c.href})`).join(', ')}.`] : []),
    '',
    '| Item | | Why | File |',
    '|---|---|---|---|',
    ...result.pending.map(row),
  ].join('\n');
  const names = created.slice(0, 3).map(c => c.title).join(', ');
  const body = [
    created.length > 0 ? `Added ${names}${created.length > 3 ? ` and ${created.length - 3} more` : ''}.` : null,
    dupes.length > 0 ? `${plural(dupes.length, 'person is', 'people are')} already on file.` : null,
    unsure.length > 0 ? `${plural(unsure.length, 'record was', 'records were')} hard to read.` : null,
    unreadable.length > 0 ? `${plural(unreadable.length, 'file', 'files')} could not be read; send a clearer copy to retry.` : null,
  ].filter(Boolean).join(' ');
  return { question, body, contextMd, options, sourceRef: `${result.batch}:decision` };
}
