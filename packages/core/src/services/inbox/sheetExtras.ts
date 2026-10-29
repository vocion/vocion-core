/**
 * What a decision sheet shows beside an ask that the ask row alone cannot
 * say, read once for the page on the server:
 *
 *   - `handsBackTo`: the asking agent's name when the answer goes back to it
 *     (`handBack.answerGoesBack`), so the choice says "Your answer goes back
 *     to <agent>, who carries on" rather than "nothing runs".
 *   - `artifact`: the ask's primary artifact (the first `artifact` in its
 *     `object_refs`), so a sign-off shows the draft it is about, in place,
 *     with one move to open it in the pane.
 *   - `deciders`: the people who answered, by name (else email), for the
 *     answered list and the receipts, never a raw user id.
 */

import type { SheetArtifact } from '@/features/dashboard/inbox/AskSheet';
import type { Ask } from '@/services/AskService';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema } from '@/models/Schema';
import { answerGoesBack } from './handBack';

/** The most of a draft's text a sheet carries for its preview; the pane has the rest. */
const PREVIEW_CHARS = 40_000;

export type SheetExtras = { handsBackTo: string | null; artifact: SheetArtifact | null };

/**
 * The first artifact an ask is about, by id.
 * @param ask - The ask.
 * @param ask.objectRefs - What it is about.
 */
export function primaryArtifactId(ask: Pick<Ask, 'objectRefs'>): number | null {
  const ref = (ask.objectRefs ?? []).find(r => r.type === 'artifact');
  const id = ref ? Number(ref.id) : Number.NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The sheet extras for each ask, keyed by ask id.
 * @param orgId - The workspace.
 * @param asks - The asks on the page.
 */
export async function loadSheetExtras(orgId: string, asks: Ask[]): Promise<Map<number, SheetExtras>> {
  const out = new Map<number, SheetExtras>();
  if (asks.length === 0) {
    return out;
  }
  const slugs = [...new Set(asks.filter(answerGoesBack).map(a => a.agentSlug!))];
  const agents = slugs.length > 0
    ? await db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, slugs))).catch(() => [])
    : [];
  const names = new Map(agents.map(a => [a.slug, a.name?.trim() || a.slug]));
  const { getArtifact } = await import('@/services/ArtifactService');
  for (const ask of asks) {
    const artifactId = primaryArtifactId(ask);
    const row = artifactId ? await getArtifact({ orgId, id: artifactId }).catch(() => null) : null;
    const md = row?.kind === 'markdown' ? String((row.spec as { md?: unknown } | null)?.md ?? '') : null;
    out.set(ask.id, {
      handsBackTo: answerGoesBack(ask) ? names.get(ask.agentSlug!) ?? null : null,
      artifact: row
        ? { id: row.id, title: row.title, kind: row.kind, version: row.currentVersion, ...(md ? { markdown: md.length > PREVIEW_CHARS ? `${md.slice(0, PREVIEW_CHARS)}\n\n…` : md } : {}) }
        : null,
    });
  }
  return out;
}

/**
 * The people who answered these asks, by name (else email). An id that is
 * not a person (the trust bar, a default, an agent) is not in the map.
 * @param asks - Decided asks.
 * @param asks[].decidedBy - Who answered.
 */
export async function decidersNamed(asks: Array<{ decidedBy: string | null }>): Promise<Map<string, string>> {
  const ids = [...new Set(asks.map(a => a.decidedBy).filter((id): id is string => Boolean(id) && !id!.includes(':')))];
  if (ids.length === 0) {
    return new Map();
  }
  const { userNamesById } = await import('@/services/AutomationService');
  return userNamesById(ids).catch(() => new Map<string, string>());
}
