import type { SheetAsk } from '@/features/dashboard/inbox/AskSheet';
import type { Ask } from '@/services/AskService';

/**
 * The slice of an ask the client stepper needs — no decision fields, no
 * source bookkeeping, so the page never ships more than the question.
 * @param ask
 */
export function toSheetAsk(ask: Ask): SheetAsk {
  return {
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
  };
}
