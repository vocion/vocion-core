import type { RecommendedActionPayload } from '@/services/agents/types';
/**
 * THE CARD — one typed noun for everything an agent surfaces inline for a
 * person to act on (backlog 025).
 *
 * Until now a card was a tool (`recommend_action`), an event
 * (`recommended_action`), a React component, a backstop pass and an auto-file
 * branch in the SSE route, and the seams between them were where cards were
 * lost (findings 16–18, 2026-09-24/25). Nothing said what a card IS. This does.
 *
 * Kinds are registered by descriptor — a schema for the payload and the name
 * of a renderer — so a plugin adds a kind without touching this file. Core
 * ships `action` (today's recommendation), `decision`, `ask` and `record`.
 * A card is emitted INTO this contract by exactly three producers: the
 * `recommend_action`/`put_card` tool, a tool's result-to-card descriptor, and
 * the gated backstop. Tools are the door, not the feature.
 */
import { z } from 'zod';

export const CARD_STATES = ['proposed', 'filed', 'decided', 'deferred', 'expired'] as const;
export type CardState = (typeof CARD_STATES)[number];

export const CardActionSchema = z.object({
  label: z.string().min(1),
  actionId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  style: z.enum(['primary', 'secondary', 'danger']).default('primary'),
  /** A sentence the person must confirm before this action runs. */
  confirm: z.string().optional(),
});
export type CardAction = z.infer<typeof CardActionSchema>;

export const CardSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  fields: z.array(z.object({ label: z.string(), value: z.string(), href: z.string().optional() })).optional(),
  actions: z.array(CardActionSchema).default([]),
  source: z.object({ agentSlug: z.string().optional(), tool: z.string().optional() }).default({}),
  /** The proposal this card was filed as, once it was. */
  runId: z.number().int().optional(),
  state: z.enum(CARD_STATES).default('proposed'),
  /** How the person decided, once they did. */
  decision: z.object({ action: z.string(), at: z.string(), by: z.string().optional() }).optional(),
  /** The agent's own recommendation for the decision, and why — both or neither. */
  suggestedDecision: z.enum(['approve', 'reject', 'snooze']).optional(),
  suggestedDecisionReason: z.string().optional(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type Card = z.infer<typeof CardSchema>;

/** What a kind declares: how its payload is checked and what draws it. */
export type CardKindDescriptor = {
  kind: string;
  /** The renderer's name in the UI registry (`features/dashboard/chat/cards`). */
  renderer: string;
  /** Extra checks on the card beyond `CardSchema`; a kind with none accepts any well-formed card. */
  refine?: (card: Card) => string | null;
};

const KINDS = new Map<string, CardKindDescriptor>();

/**
 * Register a kind. Registering the same kind twice replaces it — a plugin
 * that ships a sharper `decision` wins, and a re-import in tests is harmless.
 * @param descriptor - The kind.
 */
export function registerCardKind(descriptor: CardKindDescriptor): void {
  KINDS.set(descriptor.kind, descriptor);
}

/**
 * The descriptor for a kind, or undefined for one nobody registered.
 * @param kind
 */
export function cardKind(kind: string): CardKindDescriptor | undefined {
  return KINDS.get(kind);
}

/** Every registered kind, for the UI registry and the docs. */
export function cardKinds(): CardKindDescriptor[] {
  return [...KINDS.values()];
}

// Core kinds. `action` is today's recommendation: one primary action.
registerCardKind({ kind: 'action', renderer: 'action', refine: c => (c.actions.length === 0 ? 'an action card needs at least one action' : null) });
registerCardKind({ kind: 'decision', renderer: 'decision', refine: c => (c.actions.length < 2 ? 'a decision card offers at least two ways to decide' : null) });
registerCardKind({ kind: 'ask', renderer: 'ask' });
registerCardKind({ kind: 'record', renderer: 'record' });

export type CardCheck = { ok: true; card: Card } | { ok: false; reason: string };

/**
 * Check a card against the contract and its kind. The one gate every
 * producer passes; an invalid card never reaches the wire or the ledger.
 * @param raw - Whatever a producer handed over.
 */
export function readCard(raw: unknown): CardCheck {
  const parsed = CardSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map(i => `${i.path.join('.') || 'card'}: ${i.message}`).join('; ') };
  }
  const kind = cardKind(parsed.data.kind);
  if (!kind) {
    return { ok: false, reason: `no such card kind: ${parsed.data.kind}` };
  }
  const problem = kind.refine?.(parsed.data) ?? null;
  return problem ? { ok: false, reason: problem } : { ok: true, card: parsed.data };
}

/** A new card id — short, unique enough per conversation, safe in a URL. */
export function newCardId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `card_${rand}`;
}

/**
 * Today's recommendation as a card of kind `action` — the shim that lets every
 * existing producer (`recommend_action`, the backstop, the runtime) emit into
 * the contract without changing.
 * @param rec - The recommendation as the tool emitted it.
 * @param id - A stable id; a fresh one when absent.
 */
export function cardFromRecommendation(rec: RecommendedActionPayload, id?: string): Card {
  return CardSchema.parse({
    id: id ?? newCardId(),
    kind: 'action',
    title: rec.label,
    // A recommendation with no action is still a card — the agent's
    // recommendation, read but not pressed (a refused action, finding 20).
    actions: rec.actionId ? [{ label: rec.label, actionId: rec.actionId, input: rec.input ?? {}, style: 'primary' }] : [],
    source: { agentSlug: rec.agentSlug, tool: 'recommend_action' },
    ...(rec.runId !== undefined ? { runId: rec.runId, state: 'filed' } : {}),
    ...(rec.suggestedDecision ? { suggestedDecision: rec.suggestedDecision, suggestedDecisionReason: rec.suggestedDecisionReason } : {}),
    ...(rec.rationale ? { rationale: rec.rationale } : {}),
    ...(typeof rec.confidence === 'number' ? { confidence: rec.confidence } : {}),
  });
}

/**
 * The card as the recommendation the existing UI and proposal path take —
 * its first action is the one that files. Kept until the renderer registry
 * (phase 2) draws every kind from the card itself.
 * @param card - The card.
 */
export function recommendationFromCard(card: Card): RecommendedActionPayload & { id: string; state: CardState } {
  const primary = card.actions[0];
  return {
    id: card.id,
    state: card.state,
    actionId: primary?.actionId ?? '',
    input: primary?.input ?? {},
    label: card.title,
    ...(card.rationale ? { rationale: card.rationale } : {}),
    ...(typeof card.confidence === 'number' ? { confidence: card.confidence } : {}),
    ...(card.source.agentSlug ? { agentSlug: card.source.agentSlug } : {}),
    ...(card.runId !== undefined ? { runId: card.runId } : {}),
    ...(card.suggestedDecision ? { suggestedDecision: card.suggestedDecision, suggestedDecisionReason: card.suggestedDecisionReason } : {}),
  };
}
