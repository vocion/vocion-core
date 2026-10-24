/**
 * EVERY ANSWER THAT NAMES AN ARTIFACT CARRIES ITS CHIP.
 *
 * A turn's chips came only from the artifacts it wrote. An answer that pointed
 * at one it had not touched ("the chart is already rendered … as artifact
 * #5261", 2026-10-23) had nothing to tap, and on a phone with the pane closed
 * the artifact was out of reach. The server links an artifact mention only
 * when it is the workspace's (`services/chat/recordMentionLinks.ts`); this
 * reads those links back out, so the chip row can carry them too.
 *
 * Pure and safe on the client.
 */

import type { ChatMessageArtifact } from '@/features/dashboard/chat/types';

/** An answer names a handful at most; past this it is a list, and the list has its own links. */
const MAX_REFERENCED = 6;

/**
 * The artifacts an answer links to, in the order it names them, once each.
 * Reads markdown link targets only (`[…](/w/<slug>/dashboard/artifacts/12)`):
 * a plain number is the server's to resolve, never guessed here.
 * @param text - The answer.
 */
export function linkedArtifactIds(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\]\((?:https?:\/\/[^/\s)]+)?(?:\/[a-z]{2}(?:-[A-Z]{2})?)?(?:\/w\/[^/\s)]+)?\/dashboard\/artifacts\/(\d+)(?:\/open)?(?:[?#][^)\s]*)?\)/g)) {
    const id = Number(m[1]);
    if (Number.isSafeInteger(id) && id > 0 && !out.includes(id)) {
      out.push(id);
    }
    if (out.length >= MAX_REFERENCED) {
      break;
    }
  }
  return out;
}

/**
 * One chip per artifact: what the turn wrote first, then what it only named.
 * A re-render in the same turn (v2, then v3) is ONE chip at its newest
 * version, never two; an artifact both written and named keeps the written one.
 * @param own - What the turn wrote, in order.
 * @param referenced - What it named without writing.
 */
export function mergeArtifactChips(own: readonly ChatMessageArtifact[], referenced: readonly ChatMessageArtifact[] = []): ChatMessageArtifact[] {
  const byId = new Map<number, ChatMessageArtifact>();
  for (const a of own) {
    const seen = byId.get(a.id);
    if (!seen || a.version > seen.version) {
      byId.set(a.id, seen ? { ...a } : a);
    }
  }
  for (const a of referenced) {
    if (!byId.has(a.id)) {
      byId.set(a.id, { ...a, referenced: true });
    }
  }
  return [...byId.values()];
}
