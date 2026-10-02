import type { FieldChange } from './recordBodyFormat';
import type { MarkdownSpec } from '@/libs/cards/specs';
import type { ArtifactRow, ArtifactVersionRow, Author } from '@/services/ArtifactService';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { bookkeepingPaths, withoutBookkeeping } from '@/libs/workspace/bookkeeping';
import { artifactSchema, businessObjectSchema, businessObjectTypeSchema, userSchema } from '@/models/Schema';
import { createArtifact, listArtifactVersions, updateArtifact } from '@/services/ArtifactService';
import { fieldDiff, RECORD_BODY_ROLE, recordBodyEnabled, recordFields, renderRecordBody, restoreSet, stableJson } from './recordBodyFormat';

/**
 * A record's body is an artifact (backlog 035).
 *
 * `business_object` stays the typed index everything already queries —
 * rollups, gates, Work lanes, `lookup_objects`, dispatch. Beside it, each
 * record of a type that has a body (`recordBodyEnabled`) owns ONE markdown
 * artifact, linked through the artifact's record link
 * (`recordType: object`, `recordId`, `recordRole: body`): its fields as YAML
 * headmatter and its human text as sections, with the typed snapshot on
 * `spec.record` so a version is read as values, never parsed back out of
 * prose.
 *
 * Writes flow one way. `objects.update_meta` writes the row exactly as it
 * always has, then asks {@link writeRecordBodyVersion} for a new artifact
 * version carrying who and why. That call never throws: a version that
 * could not be written is logged loudly and the record write stands, because
 * the row is what every reader trusts. The next write snapshots the row
 * again, so a missed version heals rather than drifts.
 *
 * History is the artifact's versions ({@link recordHistory}); Restore
 * re-applies a version's fields through the SAME `objects.update_meta` path
 * (trust, undo and the ledger apply) and so lands as a version of its own.
 * Nothing here is a second history: it is the artifact's.
 */

type RecordRow = {
  id: number;
  orgId: string;
  title: string;
  metadata: Record<string, unknown>;
  typeSlug: string;
  typeLabel: string;
  schema: Record<string, unknown> | null;
};

async function readRecord(orgId: string, objectId: number): Promise<RecordRow | null> {
  const [row] = await db
    .select({
      id: businessObjectSchema.id,
      orgId: businessObjectSchema.orgId,
      title: businessObjectSchema.title,
      metadata: businessObjectSchema.metadata,
      typeSlug: businessObjectTypeSchema.slug,
      typeLabel: businessObjectTypeSchema.label,
      schema: businessObjectTypeSchema.schema,
    })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, objectId)))
    .limit(1);
  return row ? { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> } : null;
}

/**
 * The body artifact for a record, when one exists.
 * @param orgId - The workspace.
 * @param objectId - The record.
 */
async function findBody(orgId: string, objectId: number): Promise<ArtifactRow | null> {
  const [row] = await db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, orgId),
      eq(artifactSchema.recordType, 'object'),
      eq(artifactSchema.recordId, String(objectId)),
      eq(artifactSchema.recordRole, RECORD_BODY_ROLE),
    ))
    .orderBy(asc(artifactSchema.id))
    .limit(1);
  return row ?? null;
}

type WriteMeta = { written?: string[]; actionRunId?: number; invokedBy?: string; reviewedBy?: string };

function specFor(rec: RecordRow, meta: WriteMeta): MarkdownSpec {
  const fields = recordFields(rec.metadata, rec.schema);
  return {
    title: rec.title,
    md: renderRecordBody({ title: rec.title, schema: rec.schema, fields }),
    record: {
      objectType: rec.typeSlug,
      objectId: rec.id,
      fields,
      ...(meta.written ? { written: meta.written } : {}),
      ...(meta.actionRunId ? { actionRunId: meta.actionRunId } : {}),
      ...(meta.invokedBy ? { invokedBy: meta.invokedBy } : {}),
      ...(meta.reviewedBy ? { reviewedBy: meta.reviewedBy } : {}),
    },
  };
}

/**
 * Who a write was, as an artifact author. `agent:<slug>` is an agent; the
 * trust ladder, a token or nobody is the system; anything else is a person.
 * @param by - `invokedBy` / `reviewedBy` off the action run.
 */
export function authorFor(by: string | null | undefined): Author {
  if (!by || by === 'unknown') {
    return { kind: 'system' };
  }
  if (by.startsWith('agent:')) {
    return { kind: 'agent', id: by };
  }
  if (by.startsWith('token:') || by === 'trust-ladder' || by.startsWith('system')) {
    return { kind: 'system', id: by };
  }
  return { kind: 'human', id: by };
}

/**
 * A record's current version and when it was written — what its version chip
 * reads (`features/dashboard/versions/VersionChip`). A read only: a record
 * whose body was never made has no version yet, and says null rather than
 * making one to count.
 * @param orgId - The workspace.
 * @param objectId - The record.
 */
export async function recordVersionOf(orgId: string, objectId: number): Promise<{ version: number; at: string } | null> {
  const body = await findBody(orgId, objectId);
  return body ? { version: body.currentVersion, at: body.updatedAt.toISOString() } : null;
}

/**
 * The record's body artifact, created from the row on first use.
 * @param orgId - The workspace.
 * @param objectId - The record (`business_object.id`).
 * @returns The artifact, or null when the record does not exist or its type
 * carries no body.
 */
export async function recordBody(orgId: string, objectId: number): Promise<ArtifactRow | null> {
  const existing = await findBody(orgId, objectId);
  if (existing) {
    return existing;
  }
  const rec = await readRecord(orgId, objectId);
  if (!rec || !recordBodyEnabled(rec.typeSlug, rec.schema)) {
    return null;
  }
  const { artifact } = await createArtifact({
    orgId,
    kind: 'markdown',
    title: rec.title,
    spec: specFor(rec, { written: [] }),
    record: { type: 'object', id: String(rec.id), role: RECORD_BODY_ROLE },
    author: { kind: 'system' },
    changeSummary: 'Created from the record',
    // Reached from its record, not a thing a person goes looking for in the
    // artifact log — the brief and the proposal visual make the same call.
    visibility: 'system',
  });
  return artifact;
}

/**
 * Make sure a record has its body BEFORE a write lands, so v1 is what the
 * record said before anybody changed it and the first write reads as a diff.
 * Never throws.
 * @param orgId - The workspace.
 * @param objectId - The record.
 */
export async function ensureRecordBody(orgId: string, objectId: number): Promise<void> {
  try {
    await recordBody(orgId, objectId);
  } catch (err) {
    logger.error('record body: could not create the body artifact', { orgId, objectId, error: err instanceof Error ? err.message : String(err) });
  }
}

export type BodyWriteResult = { status: 'written'; artifactId: number; version: number } | { status: 'unchanged'; artifactId: number; version: number } | { status: 'skipped'; reason: string } | { status: 'failed'; reason: string };

/**
 * Write the record's current fields as a new version of its body, with who
 * and why. Idempotent (a snapshot equal to the head writes nothing) and
 * failure-tolerant: it never throws, and a failure is logged at error level.
 * @param input - The record and the write that changed it.
 * @param input.orgId - The workspace.
 * @param input.objectId - The record.
 * @param input.reason - Why, as the action run states it — the version's summary.
 * @param input.written - The field keys the write touched.
 * @param input.invokedBy - Who asked for the write.
 * @param input.reviewedBy - Who approved it, when a person did.
 * @param input.actionRunId - The `action_run` that wrote it.
 */
export async function writeRecordBodyVersion(input: {
  orgId: string;
  objectId: number;
  reason: string;
  written: string[];
  invokedBy?: string | null;
  reviewedBy?: string | null;
  actionRunId?: number | null;
}): Promise<BodyWriteResult> {
  try {
    const rec = await readRecord(input.orgId, input.objectId);
    if (!rec) {
      return { status: 'skipped', reason: 'no such record' };
    }
    if (!recordBodyEnabled(rec.typeSlug, rec.schema)) {
      return { status: 'skipped', reason: `type ${rec.typeSlug} carries no body` };
    }
    const body = await recordBody(input.orgId, input.objectId);
    if (!body) {
      return { status: 'skipped', reason: 'no body' };
    }
    const meta: WriteMeta = {
      written: [...new Set(input.written)].sort(),
      ...(input.actionRunId ? { actionRunId: input.actionRunId } : {}),
      ...(input.invokedBy ? { invokedBy: input.invokedBy } : {}),
      ...(input.reviewedBy ? { reviewedBy: input.reviewedBy } : {}),
    };
    const spec = specFor(rec, meta);
    const headFields = ((body.spec as MarkdownSpec).record?.fields ?? null) as Record<string, unknown> | null;
    // A write that changed only what the type keeps for itself
    // (`x-bookkeeping` — a drawing mark, the runs already handled) is not a
    // version of the record: nobody reading its history asked for it.
    const quiet = bookkeepingPaths(rec.schema);
    if (headFields && stableJson(withoutBookkeeping(headFields, quiet)) === stableJson(withoutBookkeeping(spec.record!.fields as Record<string, unknown>, quiet)) && body.title === rec.title) {
      return { status: 'unchanged', artifactId: body.id, version: body.currentVersion };
    }
    const { version } = await updateArtifact({
      orgId: input.orgId,
      id: body.id,
      title: rec.title,
      spec,
      author: authorFor(input.reviewedBy ?? input.invokedBy),
      changeSummary: input.reason.slice(0, 500),
      runId: input.actionRunId ? String(input.actionRunId) : null,
      noCollapse: true,
    });
    return { status: 'written', artifactId: body.id, version: version.version };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('record body: the version write FAILED; the record write stands', { orgId: input.orgId, objectId: input.objectId, actionRunId: input.actionRunId ?? null, error: reason });
    return { status: 'failed', reason };
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export type RecordVersion = {
  version: number;
  createdAt: string;
  authorKind: 'agent' | 'human' | 'system';
  authorId: string | null;
  /** A person's name, an agent's slug, or `Vocion`. */
  authorName: string;
  /** The write's reason. */
  reason: string | null;
  /** The `action_run` that wrote it, for Review › Decided. */
  actionRunId: number | null;
  /** What this write changed, field by field, against the version before it. */
  changes: FieldChange[];
  /** Fields that moved since the version before without this write touching them (rollups, bookkeeping). */
  drift: FieldChange[];
  /** Whether Restore would change anything. */
  restorable: boolean;
};

export type RecordHistory = {
  objectId: number;
  objectType: string;
  title: string;
  artifactId: number;
  current: number;
  versions: RecordVersion[];
};

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const people = ids.filter(id => !id.startsWith('agent:') && !id.startsWith('token:') && id !== 'trust-ladder');
  if (people.length === 0) {
    return new Map();
  }
  const rows = await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, people));
  return new Map(rows.map(r => [r.id, r.name?.trim() || r.email]));
}

/**
 * A record's versions, newest first: who, when, why, and a field-level diff
 * against the version before each one.
 * @param orgId - The workspace.
 * @param objectId - The record.
 * @param limit - How many versions, newest first.
 * @returns The history, or null when the record has no body.
 */
export async function recordHistory(orgId: string, objectId: number, limit = 50): Promise<RecordHistory | null> {
  const body = await recordBody(orgId, objectId);
  const rec = body ? await readRecord(orgId, objectId) : null;
  if (!body || !rec) {
    return null;
  }
  // One more than shown, so the oldest shown version still has a "before".
  const rows = await listArtifactVersions({ orgId, artifactId: body.id, limit: limit + 1 });
  const names = await namesFor([...new Set(rows.flatMap(r => [r.authorId, (r.spec as MarkdownSpec).record?.reviewedBy].filter((x): x is string => typeof x === 'string')))]);
  const now = recordFields(rec.metadata, rec.schema);
  const versions: RecordVersion[] = rows.slice(0, limit).map((row, i) => {
    const rec2 = (row.spec as MarkdownSpec).record;
    const fields = (rec2?.fields ?? {}) as Record<string, unknown>;
    const prev = rows[i + 1] ? ((rows[i + 1]!.spec as MarkdownSpec).record?.fields ?? {}) as Record<string, unknown> : null;
    const all = prev ? fieldDiff(rec.schema, prev, fields) : [];
    const written = rec2?.written;
    const changes = written ? all.filter(c => written.includes(c.key)) : all;
    const drift = written ? all.filter(c => !written.includes(c.key)) : [];
    const authorName = row.authorId
      ? names.get(row.authorId) ?? (row.authorId.startsWith('agent:') ? row.authorId.slice('agent:'.length) : row.authorKind === 'system' ? 'Vocion' : row.authorId)
      : 'Vocion';
    return {
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      authorKind: row.authorKind,
      authorId: row.authorId ?? null,
      authorName,
      reason: row.changeSummary ?? null,
      actionRunId: rec2?.actionRunId ?? (row.runId && /^\d+$/.test(row.runId) ? Number(row.runId) : null),
      changes,
      drift,
      restorable: row.version !== body.currentVersion && Object.keys(restoreSet(now, fields, restoreKeys(rows, row.version, fields, now))).length > 0,
    };
  });
  return { objectId: rec.id, objectType: rec.typeSlug, title: rec.title, artifactId: body.id, current: body.currentVersion, versions };
}

/**
 * The fields a restore to `version` puts back: every field a write after it
 * touched. A figure only a rollup moved is not a write and stays as it is.
 * A version written before `written` existed falls back to every field that
 * differs.
 * @param rows - The body's versions, newest first.
 * @param version - The version being restored.
 * @param target - Its fields.
 * @param now - The record's fields now.
 */
function restoreKeys(rows: Array<{ version: number; spec: Record<string, unknown> }>, version: number, target: Record<string, unknown>, now: Record<string, unknown>): string[] {
  const later = rows.filter(r => r.version > version);
  const keys = new Set<string>();
  for (const r of later) {
    const written = (r.spec as MarkdownSpec).record?.written;
    if (!written) {
      return [...new Set([...Object.keys(target), ...Object.keys(now)])];
    }
    written.forEach(k => keys.add(k));
  }
  return [...keys];
}

/* ------------------------------------------------------------------ */
/* Restore and Change — both are objects.update_meta                   */
/* ------------------------------------------------------------------ */

export type RecordWriteOutcome = {
  status: 'done' | 'pending' | 'unchanged' | string;
  runId: number | null;
  fields: string[];
  /** The body's version after the write, when it landed. */
  version: number | null;
  error?: string;
};

async function writeThroughUpdateMeta(input: {
  orgId: string;
  userId: string;
  objectType: string;
  objectId: number;
  set: Record<string, unknown>;
  reason: string;
}): Promise<RecordWriteOutcome> {
  const { proposeAction } = await import('@/services/ActionService');
  // A person's own gesture, under their own grant: the same action and
  // ledger an agent's write goes through, decided by the person who made it
  // (`authz`: a user holding the grant is not gated), with Undo on the run.
  const res = await proposeAction({
    orgId: input.orgId,
    actionId: 'objects.update_meta',
    input: { objectType: input.objectType, id: input.objectId, set: input.set, reason: input.reason },
    principal: { kind: 'user', id: input.userId, role: 'member', scope: { orgId: input.orgId } },
    invokedBy: input.userId,
  });
  const body = res.status === 'done' ? await findBody(input.orgId, input.objectId) : null;
  return {
    status: res.status,
    runId: res.runId,
    fields: Object.keys(input.set).sort(),
    version: body?.currentVersion ?? null,
    ...(res.error ? { error: res.error } : {}),
  };
}

/**
 * Put a record back to what one of its versions said, through
 * `objects.update_meta`, so trust rules, Undo and the ledger apply and the
 * restore is a version of its own.
 * @param input - Which record, which version, who.
 * @param input.orgId - The workspace.
 * @param input.objectId - The record.
 * @param input.version - The body version to restore.
 * @param input.userId - The person restoring.
 */
export async function restoreRecordVersion(input: { orgId: string; objectId: number; version: number; userId: string }): Promise<RecordWriteOutcome> {
  const body = await recordBody(input.orgId, input.objectId);
  const rec = body ? await readRecord(input.orgId, input.objectId) : null;
  if (!body || !rec) {
    throw new Error(`Record #${input.objectId} has no history to restore from.`);
  }
  const rows = await listArtifactVersions({ orgId: input.orgId, artifactId: body.id, limit: 500 });
  const target = rows.find(r => r.version === input.version);
  const fields = (target?.spec as MarkdownSpec | undefined)?.record?.fields as Record<string, unknown> | undefined;
  if (!target || !fields) {
    throw new Error(`Record #${input.objectId} has no version ${input.version} with fields to restore.`);
  }
  const now = recordFields(rec.metadata, rec.schema);
  const set = restoreSet(now, fields, restoreKeys(rows, input.version, fields, now));
  if (Object.keys(set).length === 0) {
    return { status: 'unchanged', runId: null, fields: [], version: body.currentVersion };
  }
  return writeThroughUpdateMeta({ orgId: input.orgId, userId: input.userId, objectType: rec.typeSlug, objectId: rec.id, set, reason: `Restored version ${input.version}` });
}

/**
 * A person saving a record's body artifact from the artifact pane (edit,
 * or a version's Restore there): the ROW is the source of truth, the way a
 * workspace file is for a mission, so the save is read back into fields
 * (`recordBodyParse.ts`) and written through `objects.update_meta` — plus
 * `objects.rename` for a new heading — and the new version comes out of that
 * write. Never a version the row does not know about.
 * @param input - The save.
 * @param input.orgId - The workspace.
 * @param input.userId - The person.
 * @param input.artifact - The body artifact.
 * @param input.spec - The saved spec (`record.fields`, else `md`).
 * @param input.contentMarkdown - The saved markdown.
 * @param input.title - A new title.
 * @param input.changeSummary - The person's line, when they gave one.
 * @returns The body after the write, and its head version.
 * @throws {Error} When nothing changed, the body does not parse, or the write did not land.
 */
export async function saveRecordBodyAsPerson(input: { orgId: string; userId: string; artifact: ArtifactRow; spec?: Record<string, unknown>; contentMarkdown?: string; title?: string; changeSummary?: string }): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow }> {
  const objectId = Number(input.artifact.recordId);
  const rec = await readRecord(input.orgId, objectId);
  if (!rec) {
    throw new Error(`The record behind this body (#${objectId}) is gone.`);
  }
  const { parseRecordBody, setBetween } = await import('./recordBodyParse');
  const current = recordFields(rec.metadata, rec.schema);
  const specFields = (input.spec as MarkdownSpec | undefined)?.record?.fields;
  const md = input.contentMarkdown ?? (typeof input.spec?.md === 'string' ? input.spec.md : null);
  const parsed = specFields && typeof specFields === 'object' ? { fields: specFields as Record<string, unknown>, title: null } : md !== null ? parseRecordBody(md, rec.schema, current) : { fields: current, title: null };
  const set = setBetween(current, parsed.fields);
  const title = (input.title ?? parsed.title ?? '').trim();
  const reason = input.changeSummary?.trim() || 'Edited the record';
  if (title && title !== rec.title) {
    const { proposeAction } = await import('@/services/ActionService');
    const res = await proposeAction({
      orgId: input.orgId,
      actionId: 'objects.rename',
      input: { objectType: rec.typeSlug, id: rec.id, title, reason },
      principal: { kind: 'user', id: input.userId, role: 'member', scope: { orgId: input.orgId } },
      invokedBy: input.userId,
    });
    if (res.status !== 'done') {
      throw new Error(res.error ?? `The rename is ${res.status}.`);
    }
  }
  if (Object.keys(set).length > 0) {
    const out = await writeThroughUpdateMeta({ orgId: input.orgId, userId: input.userId, objectType: rec.typeSlug, objectId: rec.id, set, reason });
    if (out.status !== 'done') {
      throw new Error(out.error ?? `The change is ${out.status}.`);
    }
  } else if (!title || title === rec.title) {
    throw new Error('Nothing changed: the body says what the record already says.');
  }
  return headOf(input.orgId, input.artifact.id);
}

/**
 * Restore from the artifact pane's version menu on a record's body: the
 * record's own Restore (`restoreRecordVersion`), then the body's head.
 * @param input - Which body, which version, who.
 * @param input.orgId - The workspace.
 * @param input.userId - The person.
 * @param input.artifact - The body artifact.
 * @param input.version - The version to restore.
 */
export async function restoreRecordBodyAsPerson(input: { orgId: string; userId: string; artifact: ArtifactRow; version: number }): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow }> {
  const out = await restoreRecordVersion({ orgId: input.orgId, objectId: Number(input.artifact.recordId), version: input.version, userId: input.userId });
  if (out.status !== 'done' && out.status !== 'unchanged') {
    throw new Error(out.error ?? `The restore is ${out.status}.`);
  }
  return headOf(input.orgId, input.artifact.id);
}

async function headOf(orgId: string, artifactId: number): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow }> {
  const { getArtifact, getArtifactVersion } = await import('@/services/ArtifactService');
  const artifact = await getArtifact({ orgId, id: artifactId });
  const version = artifact ? await getArtifactVersion({ orgId, artifactId, version: artifact.currentVersion }) : null;
  if (!artifact || !version) {
    throw new Error(`Artifact #${artifactId} is gone.`);
  }
  return { artifact, version };
}

/**
 * Is this artifact a record's body? Then its source of truth is the row.
 * @param a - The artifact.
 */
export function isRecordBodyArtifact(a: Pick<ArtifactRow, 'recordType' | 'recordRole' | 'recordId'> | null | undefined): boolean {
  return !!a && a.recordType === 'object' && a.recordRole === RECORD_BODY_ROLE && /^\d+$/.test(a.recordId ?? '');
}
