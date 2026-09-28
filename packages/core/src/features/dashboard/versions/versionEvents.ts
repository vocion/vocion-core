'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * A NEW VERSION, ON THE SCREEN THAT SHOWS IT (backlog 035).
 *
 * Chris, 2026-09-28: "if we change the current object we're looking at from
 * sidebar chat, it should trigger refresh and highlight (fade) sections that
 * changed — that should be native chat/artifact functionality."
 *
 * One client bus for it. Every write that makes a version — an agent's
 * record change or artifact revise (the chat stream's typed
 * `version_written`, relayed by `useChatSession`), and a person's own
 * Change, Restore or Undo on the page — is announced here, and whatever is
 * showing that ref (the record page, the feature page, the artifact page,
 * the preview pane, the history) refetches in place and marks what changed.
 * No surface listens to the chat directly, and no surface polls.
 */

/** What a version write says about itself. */
export type VersionWritten = {
  ref: Pick<RecordRef, 'type' | 'id'> & { label?: string };
  /** The artifact the version belongs to (a record's body, or the artifact itself). */
  artifactId?: number;
  from: number | null;
  to: number;
  /** The record fields the write touched. */
  fields?: string[];
};

const EVENT = 'vocion:version-written';

/**
 * Tell every surface on the page that a version was written.
 * @param v - The version.
 */
export function announceVersionWritten(v: VersionWritten): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<VersionWritten>(EVENT, { detail: v }));
}

/** Ref types that name a `business_object` by id — one record, two spellings. */
const RECORD_TYPES: ReadonlySet<string> = new Set(['object', 'request']);

/**
 * Is this version about one of these refs? A record is the same record
 * whether the page calls it `object` or `request`; an artifact matches by
 * id, and a record's body artifact matches the record's artifact id too.
 * @param v - The version written.
 * @param refs - What the surface shows.
 */
export function versionMatches(v: VersionWritten, refs: ReadonlyArray<Pick<RecordRef, 'type' | 'id'>>): boolean {
  return refs.some((r) => {
    if (RECORD_TYPES.has(r.type) && RECORD_TYPES.has(v.ref.type)) {
      return r.id === v.ref.id;
    }
    if (r.type === 'record_history') {
      return RECORD_TYPES.has(v.ref.type) && r.id.split('@')[0] === v.ref.id;
    }
    if (r.type === 'artifact') {
      return (v.ref.type === 'artifact' && v.ref.id === r.id) || (v.artifactId !== undefined && String(v.artifactId) === r.id);
    }
    return r.type === v.ref.type && r.id === v.ref.id;
  });
}

/**
 * Run `onVersion` for every version written about one of `refs`.
 * @param refs - What the surface shows.
 * @param onVersion - What to do (refetch, mark).
 */
export function useVersionWritten(refs: ReadonlyArray<Pick<RecordRef, 'type' | 'id'>>, onVersion: (v: VersionWritten) => void): void {
  const handler = useRef(onVersion);
  useLayoutEffect(() => {
    handler.current = onVersion;
  });
  const key = refs.map(r => `${r.type}:${r.id}`).join('|');
  useEffect(() => {
    if (!key) {
      return;
    }
    const wanted = key.split('|').map((k) => {
      const at = k.indexOf(':');
      return { type: k.slice(0, at) as RecordRef['type'], id: k.slice(at + 1) };
    });
    const listen = (e: Event) => {
      const v = (e as CustomEvent<VersionWritten>).detail;
      if (v && versionMatches(v, wanted)) {
        handler.current(v);
      }
    };
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [key]);
}

/* ------------------------------------------------------------------ */
/* Marking what changed                                                 */
/* ------------------------------------------------------------------ */

/** The regions a page is made of, for a before/after comparison. */
export const SECTION_SELECTOR = '[data-record-field],[data-version-section],[data-comment-field],[id^="report-"]';

/** How long a change stays marked. */
export const MARK_MS = 2000;

/**
 * A key for a region: its field, else its section name, else its id.
 * @param el - The region.
 */
function keyOf(el: HTMLElement): string | null {
  return el.dataset.recordField ?? el.dataset.versionSection ?? el.dataset.commentField ?? (el.id || null);
}

/** Block-level elements, for a surface that names no regions (a preview's markdown). */
const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,dd,td,blockquote,pre';

/** What a surface said before a refetch. */
export type SectionSnapshot = { sections: Map<string, string>; blocks: Set<string> };

const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * What each region says now — the "before" of a refetch. A surface with no
 * named regions is remembered block by block, by its words.
 * @param root - Where to look.
 */
export function snapshotSections(root: ParentNode | null): SectionSnapshot {
  const sections = new Map<string, string>();
  const blocks = new Set<string>();
  root?.querySelectorAll<HTMLElement>(SECTION_SELECTOR).forEach((el) => {
    const k = keyOf(el);
    if (k && !sections.has(k)) {
      sections.set(k, words(el));
    }
  });
  if (sections.size === 0) {
    root?.querySelectorAll(BLOCK_SELECTOR).forEach(el => blocks.add(words(el)));
  }
  return { sections, blocks };
}

/**
 * The regions that changed: every region whose words differ from the
 * snapshot, every region that is new, and every region named by a field the
 * write touched. The innermost region wins, so a changed acceptance list is
 * marked, not the whole page around it. A surface that names no regions
 * marks the blocks whose words are new.
 * @param root - Where to look.
 * @param before - {@link snapshotSections} before the refetch.
 * @param fields - The fields the write touched, when it says.
 */
export function changedSections(root: ParentNode | null, before: SectionSnapshot, fields: readonly string[] = []): HTMLElement[] {
  if (!root) {
    return [];
  }
  const hits: HTMLElement[] = [];
  if (before.sections.size > 0 || fields.length > 0) {
    root.querySelectorAll<HTMLElement>(SECTION_SELECTOR).forEach((el) => {
      const k = keyOf(el);
      if (!k) {
        return;
      }
      const was = before.sections.get(k);
      if ((was !== undefined && was !== words(el)) || (was === undefined && before.sections.size > 0) || fields.includes(k)) {
        hits.push(el);
      }
    });
  }
  if (hits.length === 0 && before.sections.size === 0 && before.blocks.size > 0) {
    root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach((el) => {
      const w = words(el);
      if (w && !before.blocks.has(w)) {
        hits.push(el);
      }
    });
  }
  return hits.filter(el => !hits.some(other => other !== el && el.contains(other)));
}

/**
 * Whether the person asked for less motion.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Mark regions as changed for {@link MARK_MS}: a highlight that fades, or —
 * with reduced motion — a still outline that is simply removed.
 * @param els - The regions.
 * @param opts - Options.
 * @param opts.reducedMotion - Override the media query (tests).
 * @returns A function that clears the marks early.
 */
export function markChanged(els: readonly HTMLElement[], opts: { reducedMotion?: boolean } = {}): () => void {
  const mode = (opts.reducedMotion ?? prefersReducedMotion()) ? 'still' : 'fade';
  for (const el of els) {
    el.dataset.versionChanged = mode;
  }
  const clear = () => {
    for (const el of els) {
      if (el.dataset.versionChanged === mode) {
        delete el.dataset.versionChanged;
      }
    }
  };
  const timer = setTimeout(clear, MARK_MS);
  return () => {
    clearTimeout(timer);
    clear();
  };
}
