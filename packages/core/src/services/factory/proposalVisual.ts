/**
 * THE PLATFORM DRAWS THE PROPOSAL VISUAL.
 *
 * `libs/factory/proposalVisual.ts` decides what the picture looks like; this
 * is the half that knows the tables. It reads the request and its plan, draws
 * the SVG, files it as the artifact at role `proposal-visual`, and puts that
 * artifact's id on `visuals.drawnArtifactId` so the Work board and the
 * feature report both find it through the field they already read.
 *
 * WHEN IT RUNS. On every write to a request that could change what the
 * picture says — the surface it lands on, the contract it carries, the plan's
 * components. That is wider than "the plan step" as a state, and
 * deliberately: the board's Proposed lane is full of rows that will never
 * reach `in_scope`, and a picture that only ever appeared after planning
 * would have left sixteen of twenty-five cards blank on the day this shipped.
 * A replan redraws it for the same reason the gap check is re-read: what the
 * record says has changed.
 *
 * WHAT IT WILL NOT OVERWRITE. A visual somebody else filed. If
 * `beforeArtifactIds` names an artifact that is not ours, the record already
 * has a better answer than a diagram — a real picture of the real screen —
 * and the platform's job is to stop being the one that fills the gap. It
 * keeps its own artifact current either way, so removing the human one brings
 * the drawing back rather than leaving the card empty.
 *
 * FAILURE IS NOT THE CALLER'S PROBLEM. This hangs off a write that has
 * already landed. A picture that could not be drawn must not fail the write
 * that was the point of the turn, so everything here is caught and reported
 * as `skipped`.
 */

import type { ProposalVisualInput } from '@/libs/factory/proposalVisual';
import type { Author } from '@/services/ArtifactService';
import { Buffer } from 'node:buffer';
import { proposalVisualSvg } from '@/libs/factory/proposalVisual';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { upsertRecordArtifact } from '@/services/ArtifactService';
import { listBusinessObjects } from '@/services/BusinessObjectService';

/**
 * The artifact role the platform owns on a request. One per record, so a
 * redraw is a new VERSION of the same artifact rather than a fifth mockup on
 * a record that has one.
 */
export const PROPOSAL_VISUAL_ROLE = 'proposal-visual';

/** The fields whose change makes the drawing say something different. */
const DRAWN_FROM: ReadonlySet<string> = new Set(['surface', 'acceptance', 'state', 'visuals']);

/**
 * Whether this write could have changed the picture.
 *
 * Checked so an ordinary write — a priority, a cost, a tag — does not cost a
 * read of every architecture plan in the workspace. A write to `state` counts
 * because that is the plan step the picture is owed at.
 * @param written - The field keys the write touched.
 */
export function redrawNeeded(written: readonly string[]): boolean {
  return written.some(k => DRAWN_FROM.has(k));
}

function bag(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * What the drawing is allowed to read, gathered from the request and the
 * newest plan filed against it.
 * @param orgId - The workspace.
 * @param requestId - The request.
 * @param meta - The request's metadata as it stands after the write.
 */
export async function visualInputFor(orgId: string, requestId: number, meta: Record<string, unknown>): Promise<ProposalVisualInput> {
  // A workspace on an older plugin has no `architecture_plan` type at all,
  // and a missing type is not a plan: the drawing then falls back to the
  // shape it can make from the request alone.
  const plans = await listBusinessObjects(orgId, 'architecture_plan').catch(() => []);
  const mine = plans
    .map(p => ({ id: p.id, meta: bag(p.metadata), at: p.createdAt?.getTime() ?? 0 }))
    .filter(p => Number(p.meta.requestId) === requestId)
    .sort((a, b) => a.at - b.at);
  const plan = mine.at(-1)?.meta ?? {};
  return {
    surface: typeof meta.surface === 'string' ? meta.surface : null,
    acceptanceCount: Array.isArray(meta.acceptance) ? meta.acceptance.length : 0,
    components: strings(plan.components),
    interfaceCount: strings(plan.interfaces).length,
  };
}

export type ProposalVisualResult
  = | { status: 'skipped'; reason: string }
    | { status: 'drawn'; artifactId: number; shape: string; linked: boolean };

/**
 * Draw, file and link this request's proposal visual.
 * @param input - The workspace, the request, and its metadata after the write.
 * @param input.orgId - The workspace.
 * @param input.requestId - The request the picture is of.
 * @param input.meta - The request's metadata as it stands.
 * @param input.author - Who the artifact version is recorded as.
 * @returns What happened, for the action run's history.
 */
export async function ensureProposalVisual(input: {
  orgId: string;
  requestId: number;
  meta: Record<string, unknown>;
  author?: Author;
}): Promise<ProposalVisualResult> {
  const visuals = bag(input.meta.visuals);
  // A recorded way out is a decision somebody made. The platform does not
  // talk over it — that is the whole value of writing it down.
  if (typeof visuals.noVisualReason === 'string' && visuals.noVisualReason.trim() !== '') {
    return { status: 'skipped', reason: 'the record says why it carries no visual' };
  }

  const drawn = proposalVisualSvg(await visualInputFor(input.orgId, input.requestId, input.meta));
  const record = { type: 'object', id: String(input.requestId), role: PROPOSAL_VISUAL_ROLE };
  const file = await saveArtifact({
    orgId: input.orgId,
    data: Buffer.from(drawn.svg, 'utf8'),
    ext: 'svg',
    contentType: 'image/svg+xml',
  });
  const { artifact } = await upsertRecordArtifact({
    orgId: input.orgId,
    kind: 'file',
    title: 'Proposed change',
    spec: { filename: file.filename, contentType: file.contentType, bytes: file.bytes, url: file.url },
    url: file.url,
    record,
    author: input.author ?? { kind: 'system' },
    changeSummary: `Drawn from the record as a ${drawn.shape}`,
    // Work output that belongs beside the request, not a thing a person went
    // looking for in the artifact log.
    visibility: 'system',
  });

  // THE DRAWING IS NOT THE MOCKUP. It lands on its own key,
  // `visuals.drawnArtifactId`, never on `beforeArtifactIds`: a diagram
  // derived from the record is not evidence of a proposed experience, and
  // filing it where Design's mockup goes made an unfinished proposal look
  // decided — the row's `no mock` went quiet the moment the platform drew a
  // frame (review, 2026-09-24). The card still shows it when nothing real
  // exists (`workQueue.visualArtifactId` falls back to it); the gate does not.
  const drawnBefore = typeof visuals.drawnArtifactId === 'number' ? visuals.drawnArtifactId : null;
  if (drawnBefore === artifact.id) {
    return { status: 'drawn', artifactId: artifact.id, shape: drawn.shape, linked: true };
  }
  await linkVisual(input.orgId, input.requestId, artifact.id);
  return { status: 'drawn', artifactId: artifact.id, shape: drawn.shape, linked: true };
}

/**
 * Put the drawing's id on the record, leaving every other field alone.
 *
 * Read-modify-write on `visuals` only: this runs after the caller's own write
 * has landed, so the row is re-read rather than patched from a stale bag.
 * @param orgId - The workspace.
 * @param requestId - The request.
 * @param artifactId - The artifact to name.
 */
async function linkVisual(orgId: string, requestId: number, artifactId: number): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, requestId)))
    .limit(1);
  if (!row) {
    return;
  }
  const meta = bag(row.metadata);
  const visuals = bag(meta.visuals);
  await db
    .update(businessObjectSchema)
    .set({ metadata: { ...meta, visuals: { ...visuals, drawnArtifactId: artifactId } } })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, requestId)));
}
