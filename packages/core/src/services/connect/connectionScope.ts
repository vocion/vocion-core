/**
 * WHICH CONNECTIONS A PIECE OF WORK MAY USE — the one resolver.
 *
 * An agency runs many clients in one workspace. Client A's GitHub or
 * Squarespace must never be usable for client B's work (Chris, 2026-10-29: "the
 * GitHub auth should scope to the Metacto project, and only be usable for work
 * and chats scoped to that project"). So a connection (`knowledge_source`) can
 * belong to one Project (`data_room_id`, a `business_object` of type
 * `data_room`); null is the whole workspace, as every connection was before.
 *
 * The rule is one sentence, and this file is the only place it is written:
 * **work for project P may use the workspace's connections and P's, never
 * another project's; work for no project uses the workspace's only.**
 *
 * Where the work's project comes from is decided where work starts
 * (`workProjectFor`, below): an SEO page or batch's `projectId`, a conversation
 * scoped to a project, a mission or background run's input, the record the
 * person is on. It rides the call context (`services/spend/callContext.ts`,
 * `workProjectId`) like the person and the run do, so a token looked up five
 * frames down a tool call is resolved for the right work without every frame
 * passing it, and it is on the agent's `RuntimeContext` for the tools that
 * build from the agent's sources.
 *
 * Every credential lookup that serves work reads through `connectionsFor`:
 * GitHub tokens (`tokenForRepo`, `sourceConfigForRepo`), publishing (GitHub and
 * Squarespace), the connector families and direct tools, credentials by slug
 * (`resolveApiTokenIdForSource`), retrieval in a turn, and the collector after a
 * sync. A connection's own sync is not work for a project — it reads with its
 * own credential, and what it brings in is fenced by the same rule on the way
 * out.
 *
 * A refusal says so, naming the project (principle 10): "GitHub for
 * example-org/northwind-site is connected for project Northwind Home
 * Services, not for this work." Never a silent "not connected", which would
 * send a person to connect something that is already connected.
 */

import type { SQL } from 'drizzle-orm';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema, conversationSchema, knowledgeSourceSchema, missionRunSchema } from '@/models/Schema';
import { currentCallContext, withCallContext } from '@/services/spend/callContext';

/** The record type a Project is (`services/DataRoomService.ts` `DATA_ROOM_TYPE`), read here without that module's weight. */
const PROJECT_TYPE = 'data_room';

/** What a piece of work is scoped to: one project, or none (the workspace's connections only). */
export type ConnectionScope = { projectId: number | null };

/** A connection row, whole. */
export type Connection = typeof knowledgeSourceSchema.$inferSelect;

/**
 * The project the current work is for, from the call context: null when the
 * work names none (a schedule, an unscoped chat), which is the safe answer —
 * it reaches the workspace's connections and no project's.
 */
export function workProjectId(): number | null {
  const id = currentCallContext().workProjectId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The scope a lookup reads with: the one it was handed, else the current work's.
 * @param scope - An explicit scope, when the caller has one.
 */
export function scopeOf(scope?: Partial<ConnectionScope> | null): ConnectionScope {
  return scope && scope.projectId !== undefined ? { projectId: scope.projectId ?? null } : { projectId: workProjectId() };
}

/**
 * Run `fn` as work for a project. Undefined leaves the open scope alone; null
 * narrows to the workspace's connections.
 * @param projectId - The project, null for none, undefined to keep the outer one.
 * @param fn - The work.
 */
export function withWorkProject<T>(projectId: number | null | undefined, fn: () => T): T {
  return projectId === undefined ? fn() : withCallContext({ workProjectId: projectId }, fn);
}

/**
 * Whether a connection may serve work in a scope: it belongs to the whole
 * workspace or to that very project.
 * @param row - The connection's project.
 * @param row.dataRoomId - `knowledge_source.data_room_id`.
 * @param scope - The work's scope.
 */
export function inScope(row: { dataRoomId: number | null }, scope: ConnectionScope): boolean {
  return row.dataRoomId === null || row.dataRoomId === scope.projectId;
}

/**
 * The SQL form of {@link inScope}, for a query that reads connection rows itself.
 * @param scope - The work's scope.
 */
export function inScopeWhere(scope: ConnectionScope): SQL {
  return scope.projectId === null
    ? isNull(knowledgeSourceSchema.dataRoomId)
    : or(isNull(knowledgeSourceSchema.dataRoomId), eq(knowledgeSourceSchema.dataRoomId, scope.projectId))!;
}

/**
 * THE RESOLVER: the workspace's connections a piece of work may use — every
 * whole-workspace connection plus the work's own project's, never another
 * project's. Enabled ones only unless asked.
 * @param orgId - The workspace.
 * @param scope - The work's scope; the current work's when omitted.
 * @param opts - Options.
 * @param opts.includeDisabled - Paused connections too.
 */
export async function connectionsFor(orgId: string, scope?: Partial<ConnectionScope> | null, opts: { includeDisabled?: boolean } = {}): Promise<Connection[]> {
  const s = scopeOf(scope);
  return db.select().from(knowledgeSourceSchema).where(and(
    eq(knowledgeSourceSchema.orgId, orgId),
    inScopeWhere(s),
    ...(opts.includeDisabled ? [] : [eq(knowledgeSourceSchema.enabled, 'true')]),
  )).orderBy(knowledgeSourceSchema.id);
}

/**
 * The connections that belong to OTHER projects than the work's — what the
 * resolver withholds — each with its project's title, so a refusal can name
 * it. Enabled ones only.
 * @param orgId - The workspace.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function connectionsWithheld(orgId: string, scope?: Partial<ConnectionScope> | null): Promise<Array<Connection & { projectTitle: string }>> {
  const s = scopeOf(scope);
  const rows = await db.select({ source: knowledgeSourceSchema, projectTitle: businessObjectSchema.title })
    .from(knowledgeSourceSchema)
    .innerJoin(businessObjectSchema, eq(businessObjectSchema.id, knowledgeSourceSchema.dataRoomId))
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.enabled, 'true')))
    .orderBy(knowledgeSourceSchema.id);
  return rows.filter(r => !inScope(r.source, s)).map(r => ({ ...r.source, projectTitle: r.projectTitle }));
}

/**
 * The slugs of the connections another project holds, for a filter that works
 * on slugs (an agent's sources, retrieval).
 * @param orgId - The workspace.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function slugsWithheld(orgId: string, scope?: Partial<ConnectionScope> | null): Promise<string[]> {
  const s = scopeOf(scope);
  const rows = await db.select({ slug: knowledgeSourceSchema.slug, dataRoomId: knowledgeSourceSchema.dataRoomId })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.orgId, orgId));
  return rows.filter(r => !inScope(r, s)).map(r => r.slug);
}

/**
 * The refusal for work outside a connection's project, in plain words naming
 * the project: "GitHub for example-org/northwind-site is connected for project
 * Northwind Home Services, not for this work."
 * @param what - What was asked for, as a person says it ("GitHub for owner/repo").
 * @param projectTitle - The project the connection belongs to.
 */
export function outOfScopeLine(what: string, projectTitle: string): string {
  return `${what} is connected for project ${projectTitle}, not for this work.`;
}

/** Thrown where a lookup has a connection by name that belongs to another project. Its message is written for a person. */
export class ConnectionOutOfScopeError extends Error {
  readonly projectTitle: string;
  constructor(what: string, projectTitle: string) {
    super(outOfScopeLine(what, projectTitle));
    this.name = 'ConnectionOutOfScopeError';
    this.projectTitle = projectTitle;
  }
}

/**
 * The project a connection belongs to, by id, with its title — null for a
 * whole-workspace connection or one that is not in this workspace.
 * @param orgId - The workspace.
 * @param sourceId - The connection.
 */
export async function connectionProject(orgId: string, sourceId: number): Promise<{ id: number; title: string } | null> {
  const [row] = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title })
    .from(knowledgeSourceSchema)
    .innerJoin(businessObjectSchema, eq(businessObjectSchema.id, knowledgeSourceSchema.dataRoomId))
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)))
    .limit(1);
  return row ?? null;
}

/**
 * The titles of the given projects in this workspace, by id. An id that is not
 * a project here is absent.
 * @param orgId - The workspace.
 * @param ids - Project ids.
 */
export async function projectTitles(orgId: string, ids: readonly number[]): Promise<Map<number, string>> {
  const wanted = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, PROJECT_TYPE), inArray(businessObjectSchema.id, wanted)));
  return new Map(rows.map(r => [r.id, r.title]));
}

/**
 * Whether an id is a project in this workspace — what a person may scope a
 * connection to.
 * @param orgId - The workspace.
 * @param projectId - The candidate.
 */
export async function isProject(orgId: string, projectId: number): Promise<boolean> {
  return (await projectTitles(orgId, [projectId])).has(projectId);
}

/**
 * Put a connection in a scope: a project of this workspace, or null for the
 * whole workspace. Refuses an id that is not a project here.
 * @param orgId - The workspace.
 * @param sourceId - The connection.
 * @param projectId - The project, or null.
 * @returns The project's title (null for the whole workspace), or a refusal.
 */
export async function setConnectionScope(orgId: string, sourceId: number, projectId: number | null): Promise<{ ok: true; projectTitle: string | null } | { ok: false; why: string }> {
  let projectTitle: string | null = null;
  if (projectId !== null) {
    projectTitle = (await projectTitles(orgId, [projectId])).get(projectId) ?? null;
    if (projectTitle === null) {
      return { ok: false, why: `#${projectId} is not a project in this workspace.` };
    }
  }
  const updated = await db.update(knowledgeSourceSchema)
    .set({ dataRoomId: projectId })
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)))
    .returning({ id: knowledgeSourceSchema.id });
  return updated.length > 0 ? { ok: true, projectTitle } : { ok: false, why: 'There is no such connection in this workspace.' };
}

/* ------------------------------------------------------------------ */
/* The work's project — decided where work starts                       */
/* ------------------------------------------------------------------ */

/** What a piece of work can say about which project it is for. */
export type WorkProjectHints = {
  /** A project named outright: an SEO batch's or page's `projectId`, a run's input. */
  projectId?: unknown;
  /** The conversation's scope (`conversation.scope_ref`): `project:<id>` names one. */
  scopeRef?: string | null;
  /** Records the work is about, most specific first: the page's record, the conversation's saved one. */
  records?: Array<{ type?: string; id?: string; objectType?: string } | null | undefined>;
  /** A run's input, read for `projectId`. */
  input?: unknown;
};

/**
 * The scope ref a conversation about a project carries.
 * @param projectId - The project.
 */
export function projectScopeRef(projectId: number): string {
  return `project:${projectId}`;
}

/**
 * The project a scope ref names, or null.
 * @param scopeRef - `conversation.scope_ref`.
 */
export function projectOfScopeRef(scopeRef: string | null | undefined): number | null {
  const m = /^project:(\d{1,10})$/.exec(scopeRef ?? '');
  return m ? Number(m[1]) : null;
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d{1,10}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The project one record belongs to: itself when it is a project, else the
 * project its `metadata.projectId` names (an SEO page, a batch, any work
 * record). Null for a record of no project, or one not in this workspace.
 * @param orgId - The workspace.
 * @param recordId - A `business_object` id.
 */
export async function projectOfRecord(orgId: string, recordId: number): Promise<number | null> {
  const [row] = await db.select({ id: businessObjectSchema.id, metadata: businessObjectSchema.metadata, typeSlug: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId)))
    .limit(1);
  if (!row) {
    return null;
  }
  if (row.typeSlug === PROJECT_TYPE) {
    return row.id;
  }
  const named = positiveInt((row.metadata as Record<string, unknown> | null)?.projectId);
  return named !== null && await isProject(orgId, named) ? named : null;
}

/**
 * THE WORK'S PROJECT, from whatever the work carries, in order: a project
 * named outright (an SEO page's or batch's `projectId`, a run's input), the
 * conversation's scope, then the records it is about (the person's page, the
 * conversation's saved one) — a project, or a record that names one. Null when
 * nothing names a project of this workspace: the work gets the workspace's
 * connections only. Never throws.
 * @param orgId - The workspace.
 * @param hints - What the work carries.
 */
export async function workProjectFor(orgId: string, hints: WorkProjectHints): Promise<number | null> {
  try {
    const named = positiveInt(hints.projectId) ?? positiveInt((hints.input as Record<string, unknown> | null | undefined)?.projectId);
    if (named !== null) {
      return await isProject(orgId, named) ? named : null;
    }
    const scoped = projectOfScopeRef(hints.scopeRef);
    if (scoped !== null) {
      return await isProject(orgId, scoped) ? scoped : null;
    }
    for (const record of hints.records ?? []) {
      if (record?.type !== 'object') {
        continue;
      }
      const id = positiveInt(record.id);
      if (id !== null) {
        const project = await projectOfRecord(orgId, id);
        if (project !== null) {
          return project;
        }
      }
    }
    return null;
  } catch (error) {
    console.warn('[connections] the work\'s project could not be read; workspace connections only', { orgId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * The project an agent turn works for, from what the turn belongs to, in
 * order: the mission run it is part of (started for a project), the
 * conversation (its scope, then the record it was opened about — a
 * conversation keeps one project), then the page the person is on. Null when
 * none names a project. Never throws.
 * @param orgId - The workspace.
 * @param turn - What the turn belongs to.
 * @param turn.conversationId - The persisted conversation.
 * @param turn.missionRunId - The mission run driving it.
 * @param turn.pageContext - Where the person is: its `record`, the record the page is about.
 */
export async function turnWorkProject(orgId: string, turn: { conversationId?: number | null; missionRunId?: number | null; pageContext?: { record?: { type?: string; id?: string } } | null }): Promise<number | null> {
  try {
    if (turn.missionRunId) {
      const [run] = await db.select({ dataRoomId: missionRunSchema.dataRoomId })
        .from(missionRunSchema)
        .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, turn.missionRunId)))
        .limit(1);
      if (run?.dataRoomId) {
        return workProjectFor(orgId, { projectId: run.dataRoomId });
      }
    }
    let conversation: { scopeRef: string | null; contextJson: { record?: { type?: string; id?: string } } | null } | undefined;
    if (turn.conversationId) {
      [conversation] = await db.select({ scopeRef: conversationSchema.scopeRef, contextJson: conversationSchema.contextJson })
        .from(conversationSchema)
        .where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, turn.conversationId)))
        .limit(1);
    }
    return await workProjectFor(orgId, {
      scopeRef: conversation?.scopeRef ?? null,
      records: [conversation?.contextJson?.record, turn.pageContext?.record],
    });
  } catch (error) {
    console.warn('[connections] the turn\'s project could not be read; workspace connections only', { orgId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * The project a background job works for: its input's `projectId`, or the
 * `projectId` in the input it carries for a workflow, checked against the
 * input's workspace. Null for any other job. Never throws.
 * @param input - The job's input.
 */
export async function jobWorkProject(input: unknown): Promise<number | null> {
  const i = (input ?? {}) as { orgId?: unknown; projectId?: unknown; input?: { projectId?: unknown } | null };
  if (typeof i.orgId !== 'string' || !i.orgId) {
    return null;
  }
  const projectId = i.projectId ?? i.input?.projectId;
  return projectId === undefined || projectId === null ? null : workProjectFor(i.orgId, { projectId });
}
