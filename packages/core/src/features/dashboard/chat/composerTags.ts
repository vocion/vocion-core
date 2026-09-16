import type { ContextRef } from './types';
import type { PageContext, RecordType } from '@/services/chat/pageContext';
import { ARTIFACT_TAG, DELIVERABLE_REF_TYPE } from '@/libs/chat/deliverable';

/**
 * What can be pulled into a turn explicitly — the pool behind BOTH the `@`
 * popover and the `(+)` menu beside the composer.
 *
 * There is one interaction here, not two (Manifesto §19). `@` at the caret is
 * already how a person points a turn at an agent, a team or a mission; the
 * things this module adds — the artifact contract, the page you are on, the
 * record in view — join that list rather than growing a second mechanism. The
 * `(+)` is the pointer path to the same list: it types the tag into the box at
 * the caret and the same reader resolves it into the same chip.
 *
 * Pure on purpose: no React, no i18n provider, no network. `tagSearch.ts` adds
 * the fetched half (teams, missions) and the translations.
 */

/** English fallbacks, so a bare render (tests, Storybook) still reads right. */
export type TagLabels = {
  /** The artifact contract's tag. */
  artifact: string;
  /** The page the person is on. */
  page: string;
};

export const DEFAULT_TAG_LABELS: TagLabels = { artifact: 'Artifact', page: 'This page' };

/**
 * The tag that arms the deliverable contract. Its `type` is not a record
 * type — it points at nothing in the database, it states what the turn owes.
 * @param label - Translated name, defaulting to English.
 */
export function artifactRef(label: string = DEFAULT_TAG_LABELS.artifact): ContextRef {
  return { type: DELIVERABLE_REF_TYPE, id: ARTIFACT_TAG, label };
}

/** Record types the composer can render a chip for; anything else travels as `object`. */
const CHIP_TYPES = new Set<string>(['agent', 'team', 'mission', 'ask', 'object', 'briefing', 'deal', 'page']);

function chipType(type: RecordType): ContextRef['type'] {
  return CHIP_TYPES.has(type) ? (type as ContextRef['type']) : 'object';
}

/**
 * The token a person types (and the `(+)` menu injects) for one tag.
 *
 * `@artifact` and `@page` are fixed words because they name a role, not a
 * record; everything else slugs its own label, which is what somebody would
 * type anyway ("@pipeline-analyst").
 * @param ref - The tag.
 */
export function tagSlug(ref: ContextRef): string {
  if (ref.type === DELIVERABLE_REF_TYPE) {
    return ARTIFACT_TAG;
  }
  if (ref.type === 'page') {
    return 'page';
  }
  const fromId = ref.id.split(':').pop() ?? ref.id;
  const slug = fromId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || ref.label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Does a typed `@query` name this tag? The slug is matched as well as the
 * label and the id, so `@art` finds the artifact tag and `@page` finds the
 * page whatever the page happens to be called.
 * @param ref - A candidate tag.
 * @param term - What is after the `@`, lower-cased and trimmed by the caller.
 */
export function matchesTag(ref: ContextRef, term: string): boolean {
  if (!term) {
    return true;
  }
  return tagSlug(ref).includes(term) || ref.label.toLowerCase().includes(term) || ref.id.toLowerCase().includes(term);
}

/**
 * Everything this surface can bring into the turn from where the person is
 * standing: the artifact contract always, then the page, then the record the
 * page is about. Ordered so the one thing that changes what the turn PRODUCES
 * comes first.
 * @param ctx - The page context this surface sends, or null/undefined off a page.
 * @param labels - Translated names for the two fixed tags.
 */
export function contextTagRefs(ctx: PageContext | null | undefined, labels: TagLabels = DEFAULT_TAG_LABELS): ContextRef[] {
  const out: ContextRef[] = [artifactRef(labels.artifact)];
  if (ctx?.path) {
    out.push({ type: 'page', id: ctx.path, label: ctx.title?.trim() || labels.page });
  }
  if (ctx?.record) {
    out.push({ type: chipType(ctx.record.type), id: ctx.record.id, label: ctx.record.label?.trim() || ctx.record.id });
  }
  return out;
}

/**
 * Splice a tag into a draft at the caret, the way the `(+)` menu does.
 *
 * Returns the whole next value and where the caret lands, so the composer can
 * put it back — the existing `@` reader then sees the token under the caret
 * and offers it, exactly as if it had been typed.
 * @param value - The draft.
 * @param caret - Where the caret is (clamped into the draft).
 * @param slug - The tag's word, without the `@`.
 */
export function insertTagAt(value: string, caret: number, slug: string): { value: string; caret: number } {
  const at = Math.max(0, Math.min(caret, value.length));
  const head = value.slice(0, at);
  const tail = value.slice(at);
  // `@` only reads as a mention at the start of a word.
  const token = `${head.length > 0 && !/\s$/.test(head) ? ' ' : ''}@${slug}`;
  const next = head + token;
  return { value: next + tail, caret: next.length };
}
