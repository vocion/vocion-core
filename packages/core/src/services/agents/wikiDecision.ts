/**
 * A PRODUCT DECISION IS CHECKED AGAINST THE WIKI, BY RELEVANCE (Chris,
 * 2026-09-29, on a ruling that offered "Show with upsell": "the Wiki should be
 * part of a rag lookup or context on major product decisions"). Nothing names
 * a page: the decision's own words are searched against the workspace wiki
 * (`wikiIndex.ts`), and the pages that bear on it are handed to the turn once,
 * before it files — a request, a plan, a product, or a ruling / recommendation
 * put to a person. The turn then files again, changed if a page says so.
 */

import type { RuntimeContext } from './types';
import { noteTurnRead, readsThisTurn } from '@/services/gates/turnReads';
import { persistToolCall } from './toolCallRecord';

/** Record types whose filing is a product decision. */
const DECISION_TYPES = new Set(['request', 'architecture_plan', 'product']);
/** Ask kinds that put a product decision to a person. */
const DECISION_ASKS = new Set(['ruling', 'recommendation']);

const text = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(text).join(' ') : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).map(text).join(' ') : '');

/**
 * What is being decided, in its own words, or null when this is not a product decision.
 * @param actionId - The action proposed.
 * @param input - Its input.
 */
export function decisionText(actionId: string, input: Record<string, unknown>): string | null {
  if (actionId === 'objects.propose_candidate' && DECISION_TYPES.has(String(input.objectType ?? ''))) {
    const f = (input.fields ?? {}) as Record<string, unknown>;
    return [input.title, f.title, f.story, f.outcome, f.acceptance, f.approach, f.mainRisk, f.components].map(text).filter(Boolean).join(' \n').slice(0, 1_500) || null;
  }
  if (actionId === 'ask.file' && DECISION_ASKS.has(String(input.kind ?? ''))) {
    return [input.title, input.body, input.options].map(text).filter(Boolean).join(' \n').slice(0, 1_500) || null;
  }
  return null;
}

/**
 * The answer to send instead of filing — the wiki pages that bear on this
 * decision and that this turn has not read — or undefined to file.
 * @param ctx - The turn.
 * @param actionId - The action proposed.
 * @param input - Its input.
 */
export async function wikiDecisionCheck(ctx: RuntimeContext, actionId: string, input: Record<string, unknown>): Promise<string | undefined> {
  const query = decisionText(actionId, input);
  if (!query) {
    return undefined;
  }
  try {
    const { describeWikiContext, wikiContextFor } = await import('@/services/wiki/wikiIndex');
    const passages = await wikiContextFor(ctx.orgId, query, 3);
    if (passages.length === 0) {
      return undefined;
    }
    const read = new Set(await readsThisTurn(ctx));
    const unread = passages.filter(p => !read.has(`wiki:${p.slug}`));
    if (unread.length === 0) {
      return undefined;
    }
    // Handed over now, so the next filing in this turn goes through.
    for (const p of unread) {
      const output = `Wiki page "${p.title}" (slug ${p.slug} · passage handed over by the decision check): ${p.excerpt}`;
      noteTurnRead(ctx, 'read_wiki_page', { slug: p.slug }, output);
      await persistToolCall({ ctx, tool: 'read_wiki_page', input: { slug: p.slug, via: 'decision check' }, output, durationMs: 0, ns: '' }).catch(() => undefined);
    }
    return `Not filed yet: this is a product decision, and the workspace wiki has pages that bear on it. Check it against them — the options, scope and acceptance must fit what they say — then file it again (unchanged if it already fits; read a whole page with read_wiki_page if a passage is not enough).\n\n${describeWikiContext(unread)}`;
  } catch (err) {
    console.warn('wiki decision check failed', { orgId: ctx.orgId, message: (err as Error).message });
    return undefined;
  }
}
