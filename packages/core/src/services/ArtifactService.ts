/**
 * ArtifactService — rendered output as data (migration 0095).
 *
 * An artifact is one thing an agent rendered for a person: a table, a
 * markdown note, a chart, a record card, a link, or a file. The `render_*`
 * tools create them (validated against `libs/cards/specs`), the chat shows
 * the card inline, the conversation's canvas places a tile, and a person can
 * save the arrangement as a named canvas and export it as a workspace page.
 *
 * Tenant-scoped like everything else: every read and write filters on orgId.
 */

import type { ArtifactKind } from '@/libs/cards/specs';
import type { ArtifactPayload } from '@/services/agents/types';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { ARTIFACT_KINDS, SPEC_SCHEMA_FOR_KIND } from '@/libs/cards/specs';
import { db } from '@/libs/DB';
import { artifactSchema, canvasSchema } from '@/models/Schema';

export type ArtifactRow = typeof artifactSchema.$inferSelect;
export type CanvasRow = typeof canvasSchema.$inferSelect;
export type TileSpan = 1 | 2 | 3;
export type Tile = { slot: number; span: TileSpan };

export class ArtifactError extends Error {
  constructor(public readonly code: 'INVALID_SPEC' | 'NOT_FOUND' | 'INVALID_KIND', message: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

/**
 * Default span per kind: tables and charts want room; records and links don't.
 * @param kind
 */
export function defaultSpan(kind: ArtifactKind): TileSpan {
  return kind === 'table' || kind === 'chart' ? 2 : 1;
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

export function toPayload(row: ArtifactRow): ArtifactPayload {
  return {
    id: row.id,
    conversationId: row.conversationId ?? null,
    kind: row.kind as ArtifactPayload['kind'],
    title: row.title,
    spec: row.spec,
    url: row.url,
    tile: row.tile ?? null,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Next free slot on a conversation's canvas — one past the highest occupied
 * slot, so a new tile lands after the existing ones instead of over them.
 * @param orgId
 * @param conversationId
 */
async function nextSlot(orgId: string, conversationId: number | null): Promise<number> {
  if (conversationId === null) {
    return 0;
  }
  const [row] = await db
    .select({ m: max(sql<number>`(${artifactSchema.tile}->>'slot')::int`) })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.conversationId, conversationId), eq(artifactSchema.pinned, true)));
  // Drivers disagree on the type of an aggregated jsonb cast (number in
  // node-postgres, string in PGlite) — normalise before comparing.
  const m = row?.m === null || row?.m === undefined ? Number.NaN : Number(row.m);
  return Number.isFinite(m) ? m + 1 : 0;
}

export async function createArtifact(input: {
  orgId: string;
  projectId?: string | null;
  conversationId?: number | null;
  messageId?: number | null;
  kind: string;
  title: string;
  spec: unknown;
  url?: string | null;
  /** Requested slot (a "fill this tile" ask); default = next free slot. */
  slot?: number | null;
  span?: TileSpan | null;
  createdBy?: string | null;
}): Promise<ArtifactRow> {
  const { kind, spec } = validateSpec(input.kind, input.spec);
  const conversationId = input.conversationId ?? null;
  const slot = typeof input.slot === 'number' && input.slot >= 0 ? input.slot : await nextSlot(input.orgId, conversationId);
  const tile: Tile = { slot, span: input.span ?? defaultSpan(kind) };
  const [row] = await db
    .insert(artifactSchema)
    .values({
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      conversationId,
      messageId: input.messageId ?? null,
      kind,
      title: input.title.trim() || kind,
      spec,
      url: input.url ?? null,
      tile,
      pinned: true,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row!;
}

export async function getArtifact(opts: { orgId: string; id: number }): Promise<ArtifactRow | null> {
  const [row] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)));
  return row ?? null;
}

export async function listArtifactsForConversation(opts: { orgId: string; conversationId: number; includeUnpinned?: boolean }): Promise<ArtifactRow[]> {
  const where = [eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.conversationId, opts.conversationId)];
  if (!opts.includeUnpinned) {
    where.push(eq(artifactSchema.pinned, true));
  }
  return db.select().from(artifactSchema).where(and(...where)).orderBy(asc(artifactSchema.createdAt), asc(artifactSchema.id));
}

export async function updateArtifactSpec(opts: { orgId: string; id: number; title?: string; spec: unknown }): Promise<ArtifactRow | null> {
  const existing = await getArtifact(opts);
  if (!existing) {
    return null;
  }
  const { spec } = validateSpec(existing.kind, opts.spec);
  const [row] = await db
    .update(artifactSchema)
    .set({ spec, ...(opts.title ? { title: opts.title } : {}) })
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

export async function setArtifactTile(opts: { orgId: string; id: number; tile: Tile }): Promise<ArtifactRow | null> {
  const [row] = await db
    .update(artifactSchema)
    .set({ tile: opts.tile })
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

/**
 * Reorder several tiles at once (a drag). `tiles` is the full new placement.
 * @param opts
 * @param opts.orgId
 * @param opts.tiles
 */
export async function setArtifactTiles(opts: { orgId: string; tiles: Array<{ id: number; tile: Tile }> }): Promise<void> {
  for (const t of opts.tiles) {
    await setArtifactTile({ orgId: opts.orgId, id: t.id, tile: t.tile });
  }
}

export async function setArtifactPinned(opts: { orgId: string; id: number; pinned: boolean }): Promise<ArtifactRow | null> {
  const [row] = await db
    .update(artifactSchema)
    .set({ pinned: opts.pinned })
    .where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

export async function deleteArtifact(opts: { orgId: string; id: number }): Promise<void> {
  await db.delete(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), eq(artifactSchema.id, opts.id)));
}

/* ------------------------------------------------------------------ */
/* Canvases                                                            */
/* ------------------------------------------------------------------ */

/**
 * Save the conversation's current pinned tiles under a name. The layout is
 * copied so the saved canvas is stable even if tiles move later; the
 * artifacts themselves are shared (canvas_id points at the latest save).
 * @param opts
 * @param opts.orgId
 * @param opts.projectId
 * @param opts.conversationId
 * @param opts.name
 * @param opts.createdBy
 */
export async function saveCanvas(opts: {
  orgId: string;
  projectId?: string | null;
  conversationId: number;
  name: string;
  createdBy?: string | null;
}): Promise<{ canvas: CanvasRow; artifacts: ArtifactRow[] }> {
  const name = opts.name.trim();
  if (!name) {
    throw new ArtifactError('INVALID_SPEC', 'a canvas needs a name');
  }
  const artifacts = await listArtifactsForConversation({ orgId: opts.orgId, conversationId: opts.conversationId });
  const layout = artifacts.map((a, i) => ({ artifactId: a.id, slot: a.tile?.slot ?? i, span: a.tile?.span ?? defaultSpan(a.kind as ArtifactKind) }));
  const [canvas] = await db
    .insert(canvasSchema)
    .values({ orgId: opts.orgId, projectId: opts.projectId ?? null, conversationId: opts.conversationId, name, layout, createdBy: opts.createdBy ?? null })
    .returning();
  if (artifacts.length > 0) {
    await db
      .update(artifactSchema)
      .set({ canvasId: canvas!.id })
      .where(and(eq(artifactSchema.orgId, opts.orgId), inArray(artifactSchema.id, artifacts.map(a => a.id))));
  }
  return { canvas: canvas!, artifacts };
}

export async function listCanvases(opts: { orgId: string; limit?: number }): Promise<Array<CanvasRow & { tileCount: number }>> {
  const rows = await db
    .select()
    .from(canvasSchema)
    .where(eq(canvasSchema.orgId, opts.orgId))
    .orderBy(desc(canvasSchema.updatedAt))
    .limit(opts.limit ?? 100);
  return rows.map(r => ({ ...r, tileCount: r.layout.length }));
}

export async function getCanvas(opts: { orgId: string; id: number }): Promise<{ canvas: CanvasRow; artifacts: ArtifactRow[] } | null> {
  const [canvas] = await db.select().from(canvasSchema).where(and(eq(canvasSchema.orgId, opts.orgId), eq(canvasSchema.id, opts.id)));
  if (!canvas) {
    return null;
  }
  const ids = canvas.layout.map(l => l.artifactId);
  const artifacts = ids.length
    ? await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, opts.orgId), inArray(artifactSchema.id, ids)))
    : [];
  // Present the saved layout, not the live tiles.
  const bySlot = new Map(canvas.layout.map(l => [l.artifactId, l]));
  const placed = artifacts
    .map(a => ({ ...a, tile: bySlot.get(a.id) ? { slot: bySlot.get(a.id)!.slot, span: bySlot.get(a.id)!.span } : a.tile }))
    .sort((a, b) => (a.tile?.slot ?? 0) - (b.tile?.slot ?? 0));
  return { canvas, artifacts: placed };
}

export async function deleteCanvas(opts: { orgId: string; id: number }): Promise<void> {
  await db.delete(canvasSchema).where(and(eq(canvasSchema.orgId, opts.orgId), eq(canvasSchema.id, opts.id)));
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
