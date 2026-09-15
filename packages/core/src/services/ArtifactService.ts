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
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
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
    version: row.currentVersion,
    authorKind: row.lastAuthorKind,
    authorId: row.lastAuthorId ?? null,
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
  author: Author;
  changeSummary?: string | null;
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
      currentVersion: 1,
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
  return { artifact: withHead ?? artifact, version: version! };
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

export async function deleteArtifact(opts: { orgId: string; id: number }): Promise<void> {
  await db.delete(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)));
}

/* ------------------------------------------------------------------ */
/* Read path                                                           */
/* ------------------------------------------------------------------ */

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
export async function listArtifactsForConversation(opts: { orgId: string; conversationId: number }): Promise<ArtifactRow[]> {
  return db
    .select()
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.conversationId, opts.conversationId)))
    .orderBy(asc(artifactSchema.createdAt), asc(artifactSchema.id));
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
};

/**
 * The log: a workspace's artifacts, most recently edited first, with the
 * version count and the conversation that produced each one.
 * @param filter
 */
export async function listArtifacts(filter: ArtifactListFilter): Promise<ArtifactListItem[]> {
  const where = [eq(artifactSchema.orgId, filter.orgId)];
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
