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
 * ships `action` (today's recommendation), `decision`, `ask`, `record` and `link`.
 * A card is emitted INTO this contract by exactly three producers: the
 * `recommend_action`/`put_card` tool, a tool's result-to-card descriptor, and
 * the gated backstop. Tools are the door, not the feature.
 */
import { z } from 'zod';

export const CARD_STATES = ['proposed', 'filed', 'decided', 'deferred', 'expired', 'unfiled'] as const;
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

/**
 * Where a card's proposal lives, when that is not the conversation's own
 * workspace: a card a person's assistant brought back from a workspace it
 * asked (`ask_workspace`). The record stays in that workspace, visible to its
 * members; the card is decided from the thread it shows in, as the person,
 * through `actAs` (`routers/actingWorkspace.ts`). Absent: the conversation's
 * own workspace, as every card was before.
 */
export const CardWorkspaceSchema = z.object({
  /** `project.id` — what the review routes act in. */
  id: z.string().min(1),
  /** For the link that opens it there. */
  slug: z.string().min(1),
  /** What the card says it is in. */
  name: z.string().min(1),
  /** Slugs are unique only inside an account, so a link names it. */
  accountSlug: z.string().min(1).optional(),
});
export type CardWorkspace = z.infer<typeof CardWorkspaceSchema>;

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
  /** The workspace that proposal lives in, when it is not this conversation's. */
  workspace: CardWorkspaceSchema.optional(),
  /** The page of the record the card is about — its title links there. */
  href: z.string().min(1).optional(),
  /** The words on that link: "Open feature". */
  hrefLabel: z.string().min(1).optional(),
  /**
   * A second way in, beside `href`: "Paste a token" next to "Connect with
   * GitHub". Same rule as `href` — a path inside the app.
   */
  secondaryHref: z.string().min(1).optional(),
  /** The words on that second link. */
  secondaryHrefLabel: z.string().min(1).optional(),
  /**
   * The last connect attempt that failed, already worded for a person
   * ("GitHub denied access"). `at` is an ISO time so the card can say the
   * date it happened; `reason` is the short code the log carries.
   */
  lastAttempt: z.object({ at: z.string(), reason: z.string(), summary: z.string() }).optional(),
  /** The record the card's action created when it ran — the id the next turn needs. */
  ref: z.object({ type: z.string().min(1), id: z.number().int() }).optional(),
  state: z.enum(CARD_STATES).default('proposed'),
  /** How the person decided, once they did. */
  decision: z.object({ action: z.string(), at: z.string(), by: z.string().optional() }).optional(),
  /** The agent's own recommendation for the decision, and why — both or neither. */
  suggestedDecision: z.enum(['approve', 'reject', 'snooze']).optional(),
  suggestedDecisionReason: z.string().optional(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  /**
   * DRAFT NEEDED: a filing that misses its type's bar (`cardBackstop.ts`).
   * Never filed as it stands; its button sends `prompt` to the agent, which
   * drafts the whole record in the conversation.
   */
  draft: z.object({ prompt: z.string().min(1), missing: z.string() }).optional(),
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
registerCardKind({ kind: 'link', renderer: 'link', refine: c => (c.href ? null : 'a link card names where it opens (href)') });

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
    ...(rec.href ? { href: rec.href, ...(rec.hrefLabel ? { hrefLabel: rec.hrefLabel } : {}) } : {}),
    ...(rec.draft ? { draft: rec.draft } : {}),
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
    ...(card.href ? { href: card.href, ...(card.hrefLabel ? { hrefLabel: card.hrefLabel } : {}) } : {}),
    ...(card.draft ? { draft: card.draft } : {}),
  };
}
