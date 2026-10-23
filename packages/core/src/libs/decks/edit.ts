/**
 * Deck edits — how a deck changes without being rewritten (`edit_deck`).
 *
 * The unit of change is the slide, named by its id: replace one, insert one,
 * remove one, move one, change a literal run of text, set the notes, retitle,
 * set an asset. Ops apply in order to a copy and the result is validated as a
 * whole deck before anything is returned, so a batch lands entirely or not at
 * all, and a bad op is a plain sentence the author can act on.
 *
 * Pure. Bytes for a new asset are stored by the engine first; here an asset
 * is already a served URL.
 */

import type { DeckAsset, DeckSpec } from '@/libs/cards/specs';
import { z } from 'zod';
import { DECK_ASSET_ID, DECK_SLIDE_ID, deckAssetSchema, deckSpecSchema } from '@/libs/cards/specs';
import { checkSlide, normaliseSlideHtml, sectionId, withNotes } from './slides';

const slideHtml = z.string().min(20).max(200_000).describe('One complete <section id="…">…</section>');
const slideId = z.string().regex(DECK_SLIDE_ID);

export const deckOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace_slide'), id: slideId, html: slideHtml.describe('The whole slide, same id') }),
  z.object({
    op: z.literal('insert_slide'),
    html: slideHtml.describe('The new slide; its <section id> is its id and must be new'),
    after: z.string().optional().describe('The slide it follows; omit to append, "^" to put it first'),
  }),
  z.object({ op: z.literal('remove_slide'), id: slideId }),
  z.object({ op: z.literal('move_slide'), id: slideId, to: z.number().int().positive().describe('New 1-based position') }),
  z.object({
    op: z.literal('replace_text'),
    find: z.string().min(1).max(2000).describe('Literal text as it appears in the slide HTML'),
    replace: z.string().max(20_000),
    slide: slideId.optional().describe('Limit to one slide; default the whole deck'),
    all: z.boolean().optional().describe('Replace every occurrence instead of requiring exactly one'),
  }),
  z.object({ op: z.literal('set_notes'), id: slideId, notes: z.string().max(4000) }),
  z.object({ op: z.literal('set_title'), title: z.string().min(1).max(200) }),
  z.object({
    op: z.literal('set_asset'),
    asset: z.string().regex(DECK_ASSET_ID),
    /** A stored asset, or null to remove it. */
    value: deckAssetSchema.nullable(),
  }),
]);
export type DeckOp = z.infer<typeof deckOpSchema>;

export class DeckEditError extends Error {}

export type DeckEditResult = {
  spec: DeckSpec;
  /** One past-tense line per op, for the version's change summary. */
  applied: string[];
  /** The slide ids whose HTML changed (inserted, replaced, edited). */
  touched: string[];
};

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    n++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * Every structure problem in a deck — the slides as slides, then the spec as
 * a whole — as sentences. Empty when the deck can be written.
 * @param spec - A candidate deck.
 */
export function deckProblems(spec: unknown): string[] {
  const parsed = deckSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return parsed.error.issues.slice(0, 8).map(i => `${i.path.join('.') || '(deck)'}: ${i.message}`);
  }
  return parsed.data.order.flatMap(id => checkSlide(id, parsed.data.slides[id]!).errors);
}

/**
 * Apply ops in order, all or none.
 * @param spec - The current deck.
 * @param ops - The operations.
 */
export function applyDeckOps(spec: DeckSpec, ops: readonly DeckOp[]): DeckEditResult {
  if (ops.length === 0) {
    throw new DeckEditError('No ops given.');
  }
  const order = [...spec.order];
  const slides: Record<string, string> = { ...spec.slides };
  const assets: Record<string, DeckAsset> = { ...(spec.assets ?? {}) };
  let title = spec.title;
  const applied: string[] = [];
  const touched = new Set<string>();
  const need = (id: string, i: number) => {
    if (slides[id] === undefined) {
      throw new DeckEditError(`op ${i + 1}: there is no slide "${id}" (the deck has ${order.join(', ')}).`);
    }
  };
  ops.forEach((op, i) => {
    switch (op.op) {
      case 'replace_slide': {
        need(op.id, i);
        const declared = sectionId(op.html);
        if (declared !== op.id) {
          throw new DeckEditError(`op ${i + 1}: replace_slide "${op.id}" got a section with id ${declared ? `"${declared}"` : 'none'}; keep the id.`);
        }
        slides[op.id] = normaliseSlideHtml(op.html);
        touched.add(op.id);
        applied.push(`replaced slide ${order.indexOf(op.id) + 1} (${op.id})`);
        break;
      }
      case 'insert_slide': {
        const id = sectionId(op.html);
        if (!id) {
          throw new DeckEditError(`op ${i + 1}: insert_slide needs one <section id="…">; none was found.`);
        }
        if (slides[id] !== undefined) {
          throw new DeckEditError(`op ${i + 1}: a slide "${id}" already exists; give the new one its own id.`);
        }
        let at = order.length;
        if (op.after === '^') {
          at = 0;
        } else if (op.after !== undefined) {
          need(op.after, i);
          at = order.indexOf(op.after) + 1;
        }
        order.splice(at, 0, id);
        slides[id] = normaliseSlideHtml(op.html);
        touched.add(id);
        applied.push(`inserted slide ${at + 1} (${id})`);
        break;
      }
      case 'remove_slide': {
        need(op.id, i);
        const at = order.indexOf(op.id);
        order.splice(at, 1);
        delete slides[op.id];
        touched.delete(op.id);
        applied.push(`removed slide ${at + 1} (${op.id})`);
        break;
      }
      case 'move_slide': {
        need(op.id, i);
        if (op.to > order.length) {
          throw new DeckEditError(`op ${i + 1}: move_slide to ${op.to}, but the deck has ${order.length} slides.`);
        }
        const from = order.indexOf(op.id);
        order.splice(from, 1);
        order.splice(op.to - 1, 0, op.id);
        applied.push(`moved slide ${op.id} from ${from + 1} to ${op.to}`);
        break;
      }
      case 'replace_text': {
        const scope = op.slide ? [op.slide] : order;
        if (op.slide) {
          need(op.slide, i);
        }
        const hits = scope.map(id => ({ id, n: occurrences(slides[id]!, op.find) })).filter(h => h.n > 0);
        const total = hits.reduce((n, h) => n + h.n, 0);
        const where = op.slide ? `slide "${op.slide}"` : 'the deck';
        if (total === 0) {
          throw new DeckEditError(`op ${i + 1}: replace_text found no "${op.find.slice(0, 80)}" in ${where}. Text is matched literally against the slide HTML; read the slide first.`);
        }
        if (!op.all && total > 1) {
          throw new DeckEditError(`op ${i + 1}: replace_text matched "${op.find.slice(0, 80)}" ${total} times in ${where} (${hits.map(h => `${h.id}×${h.n}`).join(', ')}); name the slide, lengthen the text, or pass all: true.`);
        }
        for (const h of hits) {
          slides[h.id] = slides[h.id]!.split(op.find).join(op.replace);
          touched.add(h.id);
        }
        applied.push(`replaced ${total === 1 ? 'a line' : `${total} occurrences`} in ${hits.map(h => h.id).join(', ')}`);
        break;
      }
      case 'set_notes': {
        need(op.id, i);
        slides[op.id] = withNotes(slides[op.id]!, op.notes);
        touched.add(op.id);
        applied.push(`${op.notes.trim() ? 'set' : 'cleared'} the notes on ${op.id}`);
        break;
      }
      case 'set_title': {
        title = op.title.trim();
        applied.push(`retitled "${title}"`);
        break;
      }
      case 'set_asset': {
        if (op.value === null) {
          delete assets[op.asset];
          applied.push(`removed asset ${op.asset}`);
        } else {
          assets[op.asset] = op.value;
          applied.push(`set asset ${op.asset}`);
        }
        break;
      }
    }
  });
  const sections = spec.sections
    ? Object.fromEntries(Object.entries(spec.sections).filter(([, s]) => order.includes(s.start)))
    : undefined;
  const next: DeckSpec = {
    ...spec,
    title,
    order,
    slides,
    ...(sections ? { sections } : {}),
    ...(Object.keys(assets).length > 0 || spec.assets ? { assets } : {}),
  };
  const problems = deckProblems(next);
  if (problems.length > 0) {
    throw new DeckEditError(`The edit would leave the deck invalid, so nothing was changed:\n- ${problems.join('\n- ')}`);
  }
  return { spec: next, applied, touched: [...touched] };
}
