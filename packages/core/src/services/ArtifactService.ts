/**
 * ArtifactService — one live, versioned artifact, written by agents and
 * people through the same door.
 *
 * An artifact is one thing beside a conversation: a table, a markdown note, a
 * chart, a record card, a link, or a file. 0095 made it data; 0101 made it
 * EDITABLE and VERSIONED. The person types in the pane and saves; the agent
 * calls `update_artifact` from chat ("make the third column currency"). Both
 * land here, both write an `artifact_version` row, so the version menu is a
 * single honest audit trail instead of two half-histories.
 *
 * Rules the rest of the app depends on:
 *
 *   - `artifact.title` / `artifact.spec` ALWAYS mirror the head version.
 *   - A version is never rewritten. Restoring v2 writes v6 carrying v2's
 *     content, so "what did this look like on Tuesday" stays answerable.
 *   - A burst of human saves inside {@link COLLAPSE_WINDOW_MS} collapses into
 *     the head version — autosave must not turn the menu into keystrokes.
 *   - Every read and write filters on orgId.
 */

import type { ArtifactKind } from '@/libs/cards/specs';
import type { ArtifactPayload } from '@/services/agents/types';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ARTIFACT_KINDS, SPEC_SCHEMA_FOR_KIND } from '@/libs/cards/specs';
import { db } from '@/libs/DB';
import { artifactSchema, artifactVersionSchema, conversationSchema } from '@/models/Schema';

export type ArtifactRow = typeof artifactSchema.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersionSchema.$inferSelect;

/** Who made an edit. `agent` carries `agent:<slug>`; `human` a user id. */
export type AuthorKind = 'agent' | 'human' | 'system';
export type Author = { kind: AuthorKind; id?: string | null };

/**
 * Saves by the same person inside this window fold into the head version.
 * Long enough that ⌘S-⌘S-⌘S is one version; short enough that a pause and a
 * second thought is two.
 */
export const COLLAPSE_WINDOW_MS = 30_000;

/** Folder paths are flat text, not a tree — `revenue/weekly`, never `../`. */
const MAX_FOLDER = 120;

export class ArtifactError extends Error {
  constructor(public readonly code: 'INVALID_SPEC' | 'NOT_FOUND' | 'INVALID_KIND' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

/**
 * Validate a spec against its kind's schema. Throws `INVALID_SPEC` with the
 * zod issues flattened into one line — the tool returns that line to the
 * model so it can fix the payload on the next call.
 * @param kind
 * @param spec
 */
export function validateSpec(kind: string, spec: unknown): { kind: ArtifactKind; spec: Record<string, unknown> } {
  if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
    throw new ArtifactError('INVALID_KIND', `unknown artifact kind "${kind}" (expected one of ${ARTIFACT_KINDS.join(', ')})`);
  }
  const k = kind as ArtifactKind;
  const parsed = SPEC_SCHEMA_FOR_KIND[k].safeParse(spec);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ArtifactError('INVALID_SPEC', `invalid ${k} spec — ${issues}`);
  }
  return { kind: k, spec: parsed.data as Record<string, unknown> };
}

/**
 * `revenue / Weekly ` → `revenue/weekly`; anything empty or traversing → null.
 * @param raw - What a person typed into the folder field, or a tool passed.
 */
export function normaliseFolder(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const parts = raw
    .toLowerCase()
    .split('/')
    .map(p => p.trim().replaceAll(/[^a-z0-9\- _]+/g, '').replaceAll(/\s+/g, '-'))
    .filter(p => p !== '' && p !== '.' && p !== '..');
  const path = parts.join('/').slice(0, MAX_FOLDER);
  return path || null;
}

export function toPayload(row: ArtifactRow): ArtifactPayload {
  return {
    id: row.id,
    conversationId: row.conversationId ?? null,
    kind: row.kind as ArtifactPayload['kind'],
    title: row.title,
    spec: row.spec,
    url: row.url,
    messageId: row.messageId ?? null,
    folder: row.folder ?? null,
    recordType: row.recordType ?? null,
    recordId: row.recordId ?? null,
    recordRole: row.recordRole ?? null,
    version: row.currentVersion,
    authorKind: row.lastAuthorKind,
    authorId: row.lastAuthorId ?? null,
    shareAudience: row.shareAudience,
    shareOwnerId: row.shareOwnerId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVersionPayload(row: ArtifactVersionRow): ArtifactVersionPayload {
  return {
    id: row.id,
    artifactId: row.artifactId,
    version: row.version,
    title: row.title,
    spec: row.spec,
    authorKind: row.authorKind,
    authorId: row.authorId ?? null,
    changeSummary: row.changeSummary ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ArtifactVersionPayload = {
  id: number;
  artifactId: number;
  version: number;
  title: string;
  spec: Record<string, unknown>;
  authorKind: AuthorKind;
  authorId: string | null;
  changeSummary: string | null;
  createdAt: string;
};

function authorId(author: Author): string | null {
  return author.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Write path                                                          */
/* ------------------------------------------------------------------ */

export type CreateArtifactInput = {
  orgId: string;
  projectId?: string | null;
  conversationId?: number | null;
  messageId?: number | null;
  runId?: string | null;
  kind: string;
  title: string;
  spec: unknown;
  url?: string | null;
  folder?: string | null;
  /**
   * The RECORD this artifact belongs to (0112) — a flat `RecordRef`. Artifacts
   * were conversation-scoped; a research brief belongs to a lead, not to
   * whichever conversation happened to produce it.
   */
  record?: ArtifactRecordScope | null;
  author: Author;
  changeSummary?: string | null;
  /**
   * `user` (the default) is what a person opens. `system` is work output that
   * belongs in the audit trail rather than the list — a mission check report,
   * or a recommendation already rendered on its decision card.
   *
   * Decided by PROVENANCE at the call site, never by asking the model to
   * classify its own output: an artifact produced inside an unattended mission
   * run is system output whatever it is called.
   */
  visibility?: 'user' | 'system';
};

/**
 * Where an artifact lives when it lives on a record rather than (only) in a
 * conversation. `type`/`id` are a `RecordRef` (`services/chat/pageContext.ts`)
 * stored flat; `role` says what the artifact IS to that record.
 */
export type ArtifactRecordScope = {
  type: string;
  id: string;
  /** `brief` | `recommendation` | `sequence` — one artifact per (record, role). */
  role: string;
};

/**
 * Create an artifact and its v1 in one go.
 * @param input
 */
export async function createArtifact(input: CreateArtifactInput): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow }> {
  const { kind, spec } = validateSpec(input.kind, input.spec);
  const title = input.title.trim() || kind;
  const [row] = await db
    .insert(artifactSchema)
    .values({
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      kind,
      title,
      spec,
      url: input.url ?? null,
      folder: normaliseFolder(input.folder),
      recordType: input.record?.type ?? null,
      recordId: input.record?.id ?? null,
      recordRole: input.record?.role ?? null,
      currentVersion: 1,
      visibility: input.visibility ?? 'user',
      lastAuthorKind: input.author.kind,
      lastAuthorId: authorId(input.author),
      createdBy: authorId(input.author),
    })
    .returning();
  const artifact = row!;
  const [version] = await db
    .insert(artifactVersionSchema)
    .values({
      orgId: input.orgId,
      artifactId: artifact.id,
      version: 1,
      kind,
      title,
      spec,
      authorKind: input.author.kind,
      authorId: authorId(input.author),
      runId: input.runId ?? null,
      messageId: input.messageId ?? null,
      changeSummary: input.changeSummary?.trim() || 'Created',
    })
    .returning();
  const [withHead] = await db
    .update(artifactSchema)
    .set({ headVersionId: version!.id })
    .where(and(eq(artifactSchema.orgId, input.orgId), eq(artifactSchema.id, artifact.id)))
    .returning();
  announceSaved(withHead ?? artifact, 'created', input.author);
  return { artifact: withHead ?? artifact, version: version! };
}

/**
 * Tell the rest of the system an artifact was saved — the `artifact.saved`
 * event for automations (the wiki indexes its pages this way) and the
 * adoption stream. Fire-and-forget: a save never waits on a subscriber, and a
 * subscriber that fails is logged, never surfaced to the writer. Dynamic
 * imports keep this module free of the event bus's dependency graph.
 * @param row - The saved artifact, head already moved.
 * @param change - v1, or a later version.
 * @param author - Who saved it.
 */
function announceSaved(row: ArtifactRow, change: 'created' | 'revised', author: Author): void {
  void (async () => {
    try {
      const { ARTIFACT_SAVED, emitEvent } = await import('@/services/EventService');
      await emitEvent({
        orgId: row.orgId,
        type: ARTIFACT_SAVED,
        payload: {
          artifactId: row.id,
          kind: row.kind,
          folder: row.folder ? row.folder.split('/')[0]! : null,
          title: row.title,
          version: row.currentVersion,
          change,
          authorKind: author.kind,
          recordType: row.recordType ?? null,
          recordId: row.recordId ?? null,
        },
        dedupeKey: `artifact.saved:${row.id}:${row.currentVersion}`,
        invokedBy: authorId(author) ?? `artifact:${row.id}`,
      });
      if (change === 'created') {
        const { track } = await import('@/services/adoption/track');
        await track({ orgId: row.orgId, userId: authorId(author) ?? 'system' }, 'artifact.created', {
          agentSlug: author.kind === 'agent' ? (author.id ?? '').replace(/^agent:/, '') || undefined : undefined,
          meta: { kind: row.kind.slice(0, 20), ...(row.folder ? { folder: row.folder.split('/')[0]!.slice(0, 40) } : {}) },
        });
      }
    } catch (err) {
      const { logger } = await import('@/libs/Logger');
      logger.warn('artifact.saved announcement failed', { artifactId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

export type UpdateArtifactInput = {
  orgId: string;
  id: number;
  title?: string | null;
  /** Full replacement spec. Mutually exclusive with `contentMarkdown` in practice. */
  spec?: unknown;
  /** Sugar for markdown artifacts: replaces `spec.md` and leaves the rest alone. */
  contentMarkdown?: string | null;
  folder?: string | null;
  author: Author;
  changeSummary?: string | null;
  runId?: string | null;
  messageId?: number | null;
  /**
   * Refuse the write when the head has moved on (the agent edited while a
   * person was typing). The pane sends it on an ordinary save and omits it
   * for "Keep mine", which deliberately writes on top.
   */
  ifVersion?: number | null;
  /**
   * Never fold into the head version, whatever the collapse window says. Set
   * by a restore: "I put the old wording back" is a deliberate act with its
   * own line in the menu, not a continuation of the save before it.
   */
  noCollapse?: boolean;
};

/**
 * Write a new head version. Returns the artifact, the version row, and
 * whether the write folded into the previous version instead of adding one.
 * @param input
 */
export async function updateArtifact(input: UpdateArtifactInput): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; collapsed: boolean }> {
  const existing = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!existing) {
    throw new ArtifactError('NOT_FOUND', `artifact #${input.id} not found`);
  }
  if (typeof input.ifVersion === 'number' && input.ifVersion !== existing.currentVersion) {
    throw new ArtifactError('CONFLICT', `artifact #${input.id} is at v${existing.currentVersion}, not v${input.ifVersion}`);
  }

  const nextSpecRaw = input.spec !== undefined && input.spec !== null
    ? input.spec
    : typeof input.contentMarkdown === 'string'
      ? { ...existing.spec, md: input.contentMarkdown }
      : existing.spec;
  const { spec } = validateSpec(existing.kind, nextSpecRaw);
  const title = (input.title ?? '').trim() || existing.title;
  const folder = input.folder === undefined ? existing.folder : normaliseFolder(input.folder);
  const summary = input.changeSummary?.trim() || null;

  const head = existing.headVersionId ? await getVersionRowById(input.orgId, existing.headVersionId) : null;
  const collapsed = Boolean(
    !input.noCollapse
    && head
    && head.authorKind === 'human'
    && input.author.kind === 'human'
    && head.authorId === authorId(input.author)
    && Date.now() - head.createdAt.getTime() < COLLAPSE_WINDOW_MS,
  );

  const version = collapsed
    ? (await db
        .update(artifactVersionSchema)
        .set({ title, spec, changeSummary: summary ?? head!.changeSummary })
        .where(and(eq(artifactVersionSchema.orgId, input.orgId), eq(artifactVersionSchema.id, head!.id)))
        .returning())[0]!
    : (await db
        .insert(artifactVersionSchema)
        .values({
          orgId: input.orgId,
          artifactId: existing.id,
          version: existing.currentVersion + 1,
          kind: existing.kind,
          title,
          spec,
          authorKind: input.author.kind,
          authorId: authorId(input.author),
          runId: input.runId ?? null,
          messageId: input.messageId ?? null,
          changeSummary: summary,
        })
        .returning())[0]!;

  const [artifact] = await db
    .update(artifactSchema)
    .set({
      title,
      spec,
      folder,
      currentVersion: version.version,
      headVersionId: version.id,
      lastAuthorKind: input.author.kind,
      lastAuthorId: authorId(input.author),
      updatedAt: new Date(),
    })
    .where(and(eq(artifactSchema.orgId, input.orgId), eq(artifactSchema.id, existing.id)))
    .returning();
  announceSaved(artifact!, 'revised', input.author);
  return { artifact: artifact!, version, collapsed };
}

/**
 * Restore an older version by writing it forward as a NEW head. History is
 * append-only, so "restore v2" is a v6 that happens to carry v2's content.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.version
 * @param opts.author
 */
export async function restoreArtifactVersion(opts: { orgId: string; id: number; version: number; author: Author }): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow }> {
  const source = await getArtifactVersion({ orgId: opts.orgId, artifactId: opts.id, version: opts.version });
  if (!source) {
    throw new ArtifactError('NOT_FOUND', `artifact #${opts.id} has no v${opts.version}`);
  }
  const { artifact, version } = await updateArtifact({
    orgId: opts.orgId,
    id: opts.id,
    title: source.title,
    spec: source.spec,
    author: opts.author,
    changeSummary: `Restored v${source.version}`,
    noCollapse: true,
  });
  return { artifact, version };
}

/**
 * Folder is metadata, not content: moving an artifact does not make a version.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.folder
 */
/**
 * Who this artifact opens for (`libs/share/audience.ts`). `me` records the
 * chooser as the owner; the other audiences clear it.
 * @param opts
 * @param opts.orgId - Tenant.
 * @param opts.id - Artifact id.
 * @param opts.audience - me | workspace | anyone.
 * @param opts.userId - The person choosing — the owner when the audience is `me`.
 */
export async function setArtifactShare(opts: { orgId: string; id: number; audience: 'me' | 'workspace' | 'anyone'; userId: string | null }): Promise<ArtifactRow | null> {
  // An artifact narrowed to `me` belongs to the person who narrowed it, and
  // only they may widen it again. Without this, any member of the org could
  // flip someone else's private document to `anyone` and be handed the public
  // link in the same response — the org check alone never looked at the owner.
  //
  // `workspace` and `anyone` rows carry no owner and stay changeable by any
  // member, which is exactly what they already were, so nobody loses a
  // capability they had. A caller with no user id (an API token) can never
  // satisfy the owner match, so it cannot re-share a private artifact either.
  // `me` with no owner is nobody's: it cannot happen through this function,
  // which always stamps the chooser, but a row that reached that state some
  // other way has no owner to protect and must not become unchangeable by
  // everyone. So the refusal needs an owner to point at.
  const unowned = or(ne(artifactSchema.shareAudience, 'me'), isNull(artifactSchema.shareOwnerId));
  const ownerGate = opts.userId
    ? or(unowned, eq(artifactSchema.shareOwnerId, opts.userId))
    : unowned;

  const [row] = await db
    .update(artifactSchema)
    .set({ shareAudience: opts.audience, shareOwnerId: opts.audience === 'me' ? opts.userId : null })
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id), ownerGate))
    .returning();
  return row ?? null;
}

/**
 * Put an artifact on a record after the fact — the document a chat rendered
 * before anyone named the room, filed as that room's deliverable. One truth:
 * a deliverable with an `artifactId` IS the record's artifact, so the board
 * and the room page read the same row. Unchanged when already anchored there.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.record
 */
export async function anchorArtifact(opts: { orgId: string; id: number; record: ArtifactRecordScope }): Promise<ArtifactRow | null> {
  const [row] = await db
    .update(artifactSchema)
    .set({ recordType: opts.record.type, recordId: opts.record.id, recordRole: opts.record.role, updatedAt: new Date() })
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

export async function setArtifactFolder(opts: { orgId: string; id: number; folder: string | null }): Promise<ArtifactRow | null> {
  const [row] = await db
    .update(artifactSchema)
    .set({ folder: normaliseFolder(opts.folder), updatedAt: new Date() })
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

/**
 * Attach the assistant message a turn produced to the artifacts it touched.
 *
 * The message does not exist while the tools run — it is persisted as the
 * stream closes — so the link is made afterwards. Without it a reloaded
 * transcript has no chip saying which turn made which artifact, and the only
 * way back to one is the log.
 * @param opts
 * @param opts.orgId
 * @param opts.artifactIds
 * @param opts.messageId
 */
export async function stampArtifactsWithMessage(opts: { orgId: string; artifactIds: number[]; messageId: number }): Promise<void> {
  if (opts.artifactIds.length === 0) {
    return;
  }
  await db
    .update(artifactSchema)
    .set({ messageId: opts.messageId })
    .where(and(eq(artifactSchema.orgId, opts.orgId), inArray(artifactSchema.id, opts.artifactIds)));
}

/**
 * File the person's uploads under the turn that carried them: the user
 * message they were attached to, and the conversation it belongs to (an
 * upload happens before the first turn creates the thread, so the row may
 * have neither yet). Only a human-authored `file` artifact in the caller's
 * org is touched — an id that names anything else is ignored, not claimed.
 * @param opts
 * @param opts.orgId - Tenant.
 * @param opts.artifactIds - The upload rows the message named.
 * @param opts.conversationId - The thread.
 * @param opts.messageId - The user message row.
 */
export async function claimAttachments(opts: { orgId: string; artifactIds: number[]; conversationId: number; messageId: number }): Promise<void> {
  if (opts.artifactIds.length === 0) {
    return;
  }
  await db
    .update(artifactSchema)
    .set({ conversationId: opts.conversationId, messageId: opts.messageId })
    .where(and(
      eq(artifactSchema.orgId, opts.orgId),
      inArray(artifactSchema.id, opts.artifactIds),
      eq(artifactSchema.kind, 'file'),
      eq(artifactSchema.lastAuthorKind, 'human'),
    ));
}

/**
 * The uploads attached to each message of a conversation — human-authored
 * `file` artifacts, keyed by the message that carried them — so a reloaded
 * transcript shows the chips the person saw when they sent it.
 * @param opts
 * @param opts.orgId - Tenant.
 * @param opts.conversationId - The thread.
 */
export async function listAttachmentsByMessage(opts: { orgId: string; conversationId: number }): Promise<Map<number, ArtifactRow[]>> {
  const rows = await db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, opts.orgId),
      eq(artifactSchema.conversationId, opts.conversationId),
      eq(artifactSchema.kind, 'file'),
      eq(artifactSchema.lastAuthorKind, 'human'),
    ))
    .orderBy(asc(artifactSchema.id));
  const out = new Map<number, ArtifactRow[]>();
  for (const row of rows) {
    if (row.messageId === null) {
      continue;
    }
    const list = out.get(row.messageId) ?? [];
    list.push(row);
    out.set(row.messageId, list);
  }
  return out;
}

export async function deleteArtifact(opts: { orgId: string; id: number }): Promise<void> {
  await db.delete(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)));
}

/* ------------------------------------------------------------------ */
/* Read path                                                           */
/* ------------------------------------------------------------------ */

/**
 * Several artifacts by id, in the caller's org. Ids that are not the org's are
 * simply absent from the result — the caller learns nothing about them.
 * @param opts
 * @param opts.orgId - Tenant.
 * @param opts.ids - Artifact ids.
 */
export async function listArtifactsByIds(opts: { orgId: string; ids: number[] }): Promise<ArtifactRow[]> {
  if (opts.ids.length === 0) {
    return [];
  }
  return db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), inArray(artifactSchema.id, opts.ids))).orderBy(asc(artifactSchema.id));
}

export async function getArtifact(opts: { orgId: string; id: number }): Promise<ArtifactRow | null> {
  const [row] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)));
  return row ?? null;
}

async function getVersionRowById(orgId: string, id: number): Promise<ArtifactVersionRow | null> {
  const [row] = await db.select().from(artifactVersionSchema).where(and(eq(artifactVersionSchema.orgId, orgId), eq(artifactVersionSchema.id, id)));
  return row ?? null;
}

export async function getArtifactVersion(opts: { orgId: string; artifactId: number; version: number }): Promise<ArtifactVersionRow | null> {
  const [row] = await db
    .select()
    .from(artifactVersionSchema)
    .where(and(
      eq(artifactVersionSchema.orgId, opts.orgId),
      eq(artifactVersionSchema.artifactId, opts.artifactId),
      eq(artifactVersionSchema.version, opts.version),
    ));
  return row ?? null;
}

/**
 * Newest first — the order the version menu reads in.
 * @param opts
 * @param opts.orgId
 * @param opts.artifactId
 * @param opts.limit
 */
export async function listArtifactVersions(opts: { orgId: string; artifactId: number; limit?: number }): Promise<ArtifactVersionRow[]> {
  return db
    .select()
    .from(artifactVersionSchema)
    .where(and(eq(artifactVersionSchema.orgId, opts.orgId), eq(artifactVersionSchema.artifactId, opts.artifactId)))
    .orderBy(desc(artifactVersionSchema.version))
    .limit(opts.limit ?? 50);
}

/**
 * Every artifact of one conversation, oldest first — what the chat's chips refer to.
 * @param opts
 * @param opts.orgId
 * @param opts.conversationId
 */
/**
 * The artifacts the AGENT produced in a conversation — what hangs as a chip
 * under a turn. A person's own uploads are attachments, filed separately.
 * @param opts
 * @param opts.orgId - Tenant.
 * @param opts.conversationId - The thread.
 */
export async function listArtifactsByIdsForChips(opts: { orgId: string; conversationId: number }): Promise<ArtifactRow[]> {
  const rows = await listArtifactsForConversation(opts);
  return rows.filter(r => !(r.kind === 'file' && r.lastAuthorKind === 'human'));
}

export async function listArtifactsForConversation(opts: { orgId: string; conversationId: number }): Promise<ArtifactRow[]> {
  return db
    .select()
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.conversationId, opts.conversationId)))
    .orderBy(asc(artifactSchema.createdAt), asc(artifactSchema.id));
}

/**
 * Key-order-independent JSON, for deciding whether a spec actually changed.
 *
 * `spec` is a jsonb column, and Postgres jsonb does NOT preserve key order —
 * it stores keys sorted by length then value. A plain `JSON.stringify`
 * comparison therefore reports a change on every read-back, which would make
 * every idempotent sync write a version that changed nothing.
 * @param value - Any JSON value.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

/**
 * Every artifact that belongs to one record, oldest first.
 *
 * The record-scoped half of the artifact model (0112). A record page asks for
 * its artifacts by the same `RecordRef` it already declares to the shell, so
 * nothing new has to be threaded anywhere.
 * @param opts - The org and the record.
 * @param opts.orgId - The project id.
 * @param opts.record - `{ type, id }` of the record; `role` is ignored here.
 * @param opts.record.type
 * @param opts.record.id
 */
export async function listArtifactsForRecord(opts: {
  orgId: string;
  record: { type: string; id: string };
}): Promise<ArtifactRow[]> {
  return db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, opts.orgId),
      eq(artifactSchema.recordType, opts.record.type),
      eq(artifactSchema.recordId, opts.record.id),
    ))
    .orderBy(asc(artifactSchema.createdAt), asc(artifactSchema.id));
}

/**
 * The same, for many records of one type at once — a board that shows the
 * latest document per room asks once, not once per row.
 * @param opts - The org, the record type and the record ids.
 * @param opts.orgId - The project id.
 * @param opts.recordType - e.g. `object`.
 * @param opts.recordIds - The records' ids, as the artifact rows store them.
 */
export async function listArtifactsForRecords(opts: {
  orgId: string;
  recordType: string;
  recordIds: string[];
}): Promise<ArtifactRow[]> {
  if (opts.recordIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, opts.orgId),
      eq(artifactSchema.recordType, opts.recordType),
      inArray(artifactSchema.recordId, opts.recordIds),
    ))
    .orderBy(asc(artifactSchema.createdAt), asc(artifactSchema.id));
}

/**
 * Create the artifact for `(record, role)`, or write a NEW VERSION of the one
 * that is already there — never a silent overwrite, and never a second
 * artifact for the same role.
 *
 * Role uniqueness is enforced here rather than by a unique index because
 * `artifact` is a populated table: CONVENTIONS.md rule 1 sends its index
 * builds to `concurrent/`, where `UNIQUE` is refused. The read-then-write is
 * therefore the contract, and it is documented rather than assumed.
 *
 * Content-identical writes are a no-op: a regeneration that produced the same
 * brief should not fill the version menu with versions that changed nothing
 * (`docs/design/reduction.md` — showing the workings is not the same as doing
 * work). `changeSummary` carries the reason, which is what the version history
 * reads back: "v3 — regenerated: the angle leans on an industry pattern".
 * @param input - The artifact, its record scope, and why it changed.
 */
export async function upsertRecordArtifact(input: CreateArtifactInput & {
  record: ArtifactRecordScope;
  /** Skip the version-collapse window; a regeneration is always its own version. */
  noCollapse?: boolean;
}): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; created: boolean; unchanged: boolean }> {
  const [existing] = await db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, input.orgId),
      eq(artifactSchema.recordType, input.record.type),
      eq(artifactSchema.recordId, input.record.id),
      eq(artifactSchema.recordRole, input.record.role),
    ))
    .orderBy(asc(artifactSchema.id))
    .limit(1);

  if (!existing) {
    const made = await createArtifact(input);
    return { ...made, created: true, unchanged: false };
  }

  const { spec } = validateSpec(input.kind, input.spec);
  const title = input.title.trim() || existing.title;
  if (existing.title === title && stableJson(existing.spec) === stableJson(spec)) {
    const head = await getArtifactVersion({ orgId: input.orgId, artifactId: existing.id, version: existing.currentVersion });
    return { artifact: existing, version: head!, created: false, unchanged: true };
  }

  const updated = await updateArtifact({
    orgId: input.orgId,
    id: existing.id,
    title,
    spec,
    author: input.author,
    changeSummary: input.changeSummary ?? null,
    runId: input.runId ?? null,
    messageId: input.messageId ?? null,
    noCollapse: input.noCollapse ?? true,
  });
  return { artifact: updated.artifact, version: updated.version, created: false, unchanged: false };
}

/** One row of the artifacts log. */
export type ArtifactListItem = ArtifactPayload & {
  versions: number;
  conversationTitle: string | null;
};

export type ArtifactListFilter = {
  orgId: string;
  /** Substring of the title. */
  search?: string | null;
  kinds?: string[] | null;
  folder?: string | null;
  limit?: number;
  /**
   * Which artifacts to list. Defaults to `user` — the log is the things a
   * person would go looking for. Pass `all` for an audit view.
   *
   * In production before this existed, 13 of 39 artifacts were mission check
   * reports and 7 were outreach recommendations: more than half the list was
   * something nobody would open on purpose.
   */
  visibility?: 'user' | 'all';
};

/**
 * The log: a workspace's artifacts, most recently edited first, with the
 * version count and the conversation that produced each one.
 * @param filter
 */
export async function listArtifacts(filter: ArtifactListFilter): Promise<ArtifactListItem[]> {
  const where = [eq(artifactSchema.orgId, filter.orgId)];
  if ((filter.visibility ?? 'user') === 'user') {
    where.push(eq(artifactSchema.visibility, 'user'));
  }
  const search = filter.search?.trim();
  if (search) {
    where.push(ilike(artifactSchema.title, `%${search}%`));
  }
  const kinds = (filter.kinds ?? []).filter(k => (ARTIFACT_KINDS as readonly string[]).includes(k));
  if (kinds.length > 0) {
    where.push(inArray(artifactSchema.kind, kinds));
  }
  const folder = normaliseFolder(filter.folder);
  if (folder) {
    where.push(or(eq(artifactSchema.folder, folder), ilike(artifactSchema.folder, `${folder}/%`))!);
  }
  const rows = await db
    .select({
      artifact: artifactSchema,
      conversationTitle: conversationSchema.title,
      versions: sql<number>`(select count(*) from ${artifactVersionSchema} v where v.artifact_id = ${artifactSchema.id})`,
    })
    .from(artifactSchema)
    .leftJoin(conversationSchema, eq(conversationSchema.id, artifactSchema.conversationId))
    .where(and(...where))
    .orderBy(desc(artifactSchema.updatedAt), desc(artifactSchema.id))
    .limit(filter.limit ?? 200);
  return rows.map(r => ({
    ...toPayload(r.artifact),
    versions: Number(r.versions) || 1,
    conversationTitle: r.conversationTitle ?? null,
  }));
}

/**
 * Distinct folder paths with a count — the log's chip filters.
 * @param opts
 * @param opts.orgId
 */
export async function listArtifactFolders(opts: { orgId: string }): Promise<Array<{ folder: string; count: number }>> {
  const rows = await db
    .select({ folder: artifactSchema.folder, n: count() })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, opts.orgId), sql`${artifactSchema.folder} is not null`))
    .groupBy(artifactSchema.folder)
    .orderBy(asc(artifactSchema.folder));
  return rows.filter(r => r.folder).map(r => ({ folder: r.folder!, count: Number(r.n) }));
}

/**
 * Artifacts with no conversation (mission files) for a project — the mission page's fallback list.
 * @param opts
 * @param opts.orgId
 * @param opts.limit
 */
export async function listOrphanFileArtifacts(opts: { orgId: string; limit?: number }): Promise<ArtifactRow[]> {
  return db
    .select()
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, opts.orgId), isNull(artifactSchema.conversationId), eq(artifactSchema.kind, 'file')))
    .orderBy(desc(artifactSchema.createdAt))
    .limit(opts.limit ?? 50);
}
