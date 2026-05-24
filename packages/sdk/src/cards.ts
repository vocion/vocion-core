import type { ComponentType, ReactNode } from 'react';
import type { z, ZodTypeAny } from 'zod';

/**
 * Cards SDK — v0.4 Stage 1 (deterministic resolution only).
 *
 * A Card is a typed UI renderer for a structured payload. The framework
 * resolves a card for any output payload via three mechanisms in priority
 * order:
 *
 *   1. **Deterministic** (Stage 1, this release) — payload declares
 *      `__card: 'slug'`; the registry looks it up and renders.
 *   2. **LLM-picked** (Stage 2, v0.5) — a classifier matches the payload
 *      shape + surface against registered cards' `description`s.
 *   3. **A2UI fallback** (Stage 3, v0.6+) — when nothing matches, an agent
 *      emits a structured component tree that renders via a constrained
 *      primitive palette.
 *
 * Anything that fails all three falls through to a generic `<JsonDump>`.
 *
 * **API stability:** marked `@experimental` in v0.4. Treat as breaking until
 * v0.5 freezes the surface; once a third-party plugin ships a CardRenderer
 * the contract becomes load-bearing.
 */

/**
 * Where a Card can render. Different surfaces have different visual budgets
 * (chat is tight + inline; run-detail is wider + scrollable). A Card declares
 * the surfaces it knows how to render in.
 */
export type CardSurface = 'chat' | 'workflow-run' | 'review-queue' | 'activity-feed';

/**
 * Props passed to a Card's `Renderer`. `data` is the validated payload (it's
 * already been Zod-parsed); `surface` lets the renderer adapt density / actions
 * to the host context.
 */
export type CardRendererProps<TData> = {
  data: TData;
  surface: CardSurface;
  /** Optional slot for surface-supplied actions (Approve / Reject buttons, etc). */
  actions?: ReactNode;
};

/**
 * A registered Card renderer. Plugins author one and surface it via
 * `PluginManifest.renderers`; the framework ships a small set of first-party
 * Cards (sendStub, keyValue, jsonDump) and looks them up by slug.
 *
 * Generic over the Zod schema so the `Renderer`'s `data` prop is inferred —
 * authors write `Renderer: ({ data }) => <div>{data.envelope.body}</div>` and
 * TypeScript infers `data` from the schema attached to the same object.
 *
 * Slugs are namespaced by plugin id when registered through a manifest — a
 * first-party card uses a bare slug (`send-stub`); a plugin card uses
 * `<plugin-id>.<slug>` (`support-reply.sent-email`). Slug priority resolves
 * collisions: a more-specific (plugin-namespaced) slug wins over a generic
 * one when both could match.
 */
export type CardRenderer<TSchema extends ZodTypeAny = ZodTypeAny> = {
  /** Stable identifier. Convention: `<plugin-id>.<name>` for plugin cards, bare `<name>` for first-party. */
  readonly slug: string;
  /** Display name for the catalog. */
  readonly name: string;
  /**
   * One-paragraph description of what this card renders. Used at Stage 2
   * (v0.5) by the LLM picker to match payload shapes to renderers. Write
   * it like a function docstring: "Renders X when the payload contains Y."
   */
  readonly description: string;
  /** Surfaces the card knows how to render in. Subset of {@link CardSurface}. */
  readonly surfaces: readonly CardSurface[];
  /**
   * Zod schema for the payload. Resolution validates against this before
   * invoking `Renderer`; on validation failure the resolver falls through
   * to the next mechanism in the chain.
   */
  readonly dataSchema: TSchema;
  /** The React component that does the rendering. Receives `data` + `surface`. */
  readonly Renderer: ComponentType<CardRendererProps<z.infer<TSchema>>>;
};

/**
 * Type-erased Card — what the registry stores + manifests declare. Uses
 * `any` for the prop type so contravariance works when assigning a
 * specifically-typed `CardRenderer<TSchema>` (where `data` is the inferred
 * Zod output) into a generic slot. Internal callers use `defineCard` /
 * `CardRenderer<TSchema>` for the typed authoring experience; storage and
 * transport go through this erased shape.
 */
export type AnyCardRenderer = {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly surfaces: readonly CardSurface[];
  readonly dataSchema: ZodTypeAny;
  readonly Renderer: ComponentType<CardRendererProps<any>>;
};

/**
 * Ergonomic constructor with type inference from the schema. Authoring style:
 *
 *   const myCard = defineCard({
 *     slug: 'my-plugin.kind',
 *     name: 'Kind card',
 *     description: '...',
 *     surfaces: ['workflow-run'],
 *     dataSchema: z.object({ foo: z.string() }),
 *     Renderer: ({ data }) => <div>{data.foo}</div>,
 *   });
 *
 * Returns the same shape — preserving the schema generic so the resulting
 * `Renderer` keeps its typed `data` prop at the call site. Casts to
 * `AnyCardRenderer` happen at the registry boundary.
 * @param card
 */
export function defineCard<TSchema extends ZodTypeAny>(
  card: CardRenderer<TSchema>,
): CardRenderer<TSchema> {
  return card;
}

/**
 * The sentinel field a payload uses to opt into deterministic card
 * resolution. Producers (workflow action handlers, agent tools) set this on
 * their output to skip the LLM picker / A2UI fallback.
 *
 *   { __card: 'send-stub', envelope: { to: '...', body: '...' } }
 *
 * Convention only — readers should tolerate payloads without this field.
 */
export const CARD_SLUG_FIELD = '__card' as const;
