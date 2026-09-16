/**
 * What the page is showing, written out as canonical for the model.
 *
 * > "The page contains a generated brief and sequence recommendation. The chat
 * > says 'there's no brief or proposal to review here'. It also says the
 * > contact 'hasn't engaged since (no page views, no clicks beyond the ad
 * > itself)' while the brief explicitly says those engagement fields were
 * > **unavailable** and nothing can be inferred from them. Two Vocion surfaces
 * > looking at the same object, giving contradictory answers."
 * > — `docs/specs/personalization-v2.md`, P0
 *
 * The fix is not a better prompt. It is that the artifacts the page is
 * rendering **travel with every turn**, resolved from the store rather than
 * described by the client, and are declared canonical.
 *
 * Three properties make the contradiction structurally hard rather than merely
 * discouraged:
 *
 * 1. **The content is in the turn.** "There is no brief here" is contradicted
 *    by the brief being in the message. The model is not being asked to
 *    remember or to fetch; it is being handed the text.
 * 2. **The server resolves it.** The client sends `RecordRef`s — ids — and the
 *    server reads the artifact rows under the caller's org. A client cannot
 *    assert content, only point at it.
 * 3. **The epistemic classes are named.** CRM fact, research finding,
 *    inference and unavailable data are four different things, and the block
 *    says so in the same breath as the content. "Unavailable" is the one that
 *    was being converted into a finding, so it gets its own sentence.
 *
 * This is grounding, NOT rendering. The rail still must not re-render what the
 * page shows (#378, `pageShowsRecord`): what changes is what the model KNOWS,
 * not what the rail DRAWS.
 */

import type { PageContext, RecordRef } from './pageContext';
import type { ArtifactRow } from '@/services/ArtifactService';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema } from '@/models/Schema';

/** How much of one artifact travels. Enough to answer from; not a whole book. */
const MAX_ARTIFACT_CHARS = 6000;
/** Total budget across all attached artifacts. */
const MAX_TOTAL_CHARS = 16_000;

/** One artifact, resolved and flattened to text. */
export type GroundedArtifact = {
  id: number;
  title: string;
  kind: string;
  version: number;
  /** What it is to its record — `brief` | `recommendation` | `sequence`. */
  role: string | null;
  /** The artifact's content as the model should read it. */
  text: string;
  truncated: boolean;
};

const clip = (text: string, max: number): { text: string; truncated: boolean } =>
  text.length <= max ? { text, truncated: false } : { text: `${text.slice(0, max)}\n…[truncated]`, truncated: true };

/**
 * Flatten one artifact's spec into readable text.
 *
 * Typed kinds get a shape the model can quote back exactly — a sequence's
 * sends are numbered and labelled, so "make Send 2 less salesy" has a
 * referent — rather than a JSON dump it has to parse.
 * @param row - The artifact row.
 */
export function artifactText(row: Pick<ArtifactRow, 'kind' | 'title' | 'spec'>): string {
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  if (row.kind === 'markdown' && typeof spec.md === 'string') {
    return spec.md;
  }
  if (row.kind === 'sequence') {
    const sends = Array.isArray(spec.sends) ? spec.sends as Array<Record<string, unknown>> : [];
    const head = [
      spec.sequenceName ? `Sequence: ${String(spec.sequenceName)}` : null,
      spec.rationale ? `Rationale: ${String(spec.rationale)}` : null,
      `${sends.length} ${sends.length === 1 ? 'send' : 'sends'}`,
    ].filter(Boolean).join('\n');
    const body = sends.map((s) => {
      const label = s.day === undefined ? `Send ${String(s.step)}` : `Send ${String(s.step)} · Day ${String(s.day)}`;
      return `${label}\nSubject: ${String(s.subject ?? '')}\n${String(s.body ?? '')}`;
    }).join('\n\n');
    return [head, body].filter(Boolean).join('\n\n');
  }
  if (row.kind === 'link' && typeof spec.href === 'string') {
    return `${String(spec.title ?? row.title)} — ${spec.href}`;
  }
  return JSON.stringify(spec);
}

/**
 * Resolve the artifacts a page declared into their current content.
 *
 * Reads under `orgId` only, so a ref pointing at somebody else's artifact
 * resolves to nothing rather than to a leak. A ref that resolves to nothing is
 * simply dropped: a stale id must never fail the turn.
 * @param orgId - The project id.
 * @param refs - What the page said it is showing.
 */
export async function resolveGroundedArtifacts(orgId: string, refs: readonly RecordRef[]): Promise<GroundedArtifact[]> {
  const ids = [...new Set(refs.filter(r => r.type === 'artifact').map(r => Number(r.id)).filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, ids)));
  // Keep the page's order — brief, recommendation, sequence is the causal
  // chain, and the model should read it in that order.
  const byId = new Map(rows.map(r => [r.id, r]));
  const out: GroundedArtifact[] = [];
  let budget = MAX_TOTAL_CHARS;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      continue;
    }
    const { text, truncated } = clip(artifactText(row), Math.min(MAX_ARTIFACT_CHARS, Math.max(0, budget)));
    budget -= text.length;
    out.push({
      id: row.id,
      title: row.title,
      kind: row.kind,
      version: row.currentVersion,
      role: row.recordRole ?? null,
      text,
      truncated,
    });
  }
  return out;
}

/**
 * The instruction that makes the attached artifacts canonical, and names the
 * four epistemic classes the chat was collapsing.
 *
 * Built in code rather than left to the system prompt for the same reason
 * `describeThread`'s gap sentence is: a model told to "use the page context"
 * writes "there's no brief here"; a model handed the brief, told it is
 * canonical, and told that "unavailable" is not "zero", does not.
 */
export const GROUNDING_RULE = [
  'These are the artifacts currently on the page beside this conversation. They are CANONICAL: they are what the person is looking at right now.',
  'Never say there is no brief, no recommendation or no proposal here when one is attached below — the page is showing it.',
  'When you talk about this record, keep four things apart and say which one you are using:',
  '- CRM fact — recorded on the contact record.',
  '- Research finding — something research retrieved and cited.',
  '- Inference — your reasoning from the above. Say that it is.',
  '- Unavailable — a field the source did not return. UNAVAILABLE IS NOT ZERO AND NOT A FINDING: if the brief says engagement data was unavailable, you may not say the contact has not engaged, has not opened anything, or has gone quiet. The honest sentence is that we cannot see it.',
  'If the person asks for something the artifacts do not contain, say what is missing rather than filling it in.',
].join('\n');

/**
 * The whole grounding block, or null when the page attached nothing.
 * @param artifacts - The resolved artifacts.
 * @param state - The page's user-visible state.
 */
export function describeGrounding(
  artifacts: readonly GroundedArtifact[],
  state?: PageContext['state'],
): string | null {
  if (artifacts.length === 0) {
    return null;
  }
  const parts = ['--- what the page is showing (canonical) ---', GROUNDING_RULE, ''];
  if (state && state.length > 0) {
    parts.push(`Page state: ${state.map(p => `${p.label}: ${p.value}`).join(' · ')}`, '');
  }
  for (const a of artifacts) {
    parts.push(`### ${a.role ? `${a.role}: ` : ''}${a.title} (artifact ${a.id}, v${a.version})`, a.text, '');
  }
  return parts.join('\n').trimEnd();
}

/**
 * Resolve and describe in one call — what the stream route needs.
 * @param orgId - The project id.
 * @param ctx - The page context the turn carried.
 */
export async function buildGrounding(orgId: string, ctx: PageContext | null | undefined): Promise<{
  text: string | null;
  artifacts: GroundedArtifact[];
}> {
  if (!ctx?.artifacts || ctx.artifacts.length === 0) {
    return { text: null, artifacts: [] };
  }
  const artifacts = await resolveGroundedArtifacts(orgId, ctx.artifacts);
  return { text: describeGrounding(artifacts, ctx.state), artifacts };
}
