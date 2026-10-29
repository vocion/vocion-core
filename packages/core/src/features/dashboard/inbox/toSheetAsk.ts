import type { SheetAsk } from '@/features/dashboard/inbox/AskSheet';
import type { Ask } from '@/services/AskService';

/**
 * The slice of an ask the client stepper needs — no decision fields, no
 * source bookkeeping, so the page never ships more than the question.
 * @param ask
 * @param alignment - The asker's 30-day alignment on this kind, when the page looked it up.
 * @param listeners - What each answer starts (`services/inbox/answerListeners`), when the page looked it up.
 * @param extras - Who the answer goes back to, and the draft it is about (`services/inbox/sheetExtras`).
 * @param extras.handsBackTo - The asking agent's name, when the answer goes back to it.
 * @param extras.artifact - The ask's primary artifact.
 */
export function toSheetAsk(ask: Ask, alignment?: SheetAsk['alignment'], listeners?: SheetAsk['listeners'], extras?: { handsBackTo: string | null; artifact: SheetAsk['artifact'] }): SheetAsk {
  return {
    ...(listeners ? { listeners } : {}),
    ...(extras?.handsBackTo ? { handsBackTo: extras.handsBackTo } : {}),
    ...(extras?.artifact ? { artifact: extras.artifact } : {}),
    alignment: alignment ?? null,
    id: ask.id,
    kind: ask.kind,
    title: ask.title,
    body: ask.body,
    options: ask.options,
    contextUrl: ask.contextUrl,
    contextMd: ask.contextMd,
    agentSlug: ask.agentSlug,
    teamSlug: ask.teamSlug,
    risk: ask.risk,
    ...(ask.outcomes ? { outcomes: ask.outcomes } : {}),
  };
}
