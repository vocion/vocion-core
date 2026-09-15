/**
 * Connector inspection — looking at a third party with candidate connection
 * details, before any source row or credential exists.
 *
 * Built for Strapi's Add-source dialog (which needs the collection list to
 * offer a pick-list) and generalized here, because the same affordance answers
 * a much more common question: does this key work, and what does this account's
 * plan actually open? A connector implements `inspect`, the route dispatches to
 * it, and the Sources page renders whatever comes back.
 *
 * Nothing is persisted by an inspection. The credential is used for the
 * outbound calls and dropped.
 */

/** One thing an inspection established, as the Sources page lists it. */
export type ConnectorCheck = {
  /** Stable key, so a caller can find one check without matching on wording. */
  key: string;
  /** What the check is, in the operator's words. */
  label: string;
  ok: boolean;
  /** What was actually observed — the vendor's own message on a failure. */
  detail: string | null;
};

/**
 * The result shape a connector returns when it has no bespoke renderer.
 *
 * Strapi's richer payload flows through the route untouched; the generic
 * checklist renderer is what every other connector gets for free.
 */
export type ConnectorInspection = {
  /** The service answered at all. */
  reachable: boolean;
  /** The supplied credential was accepted. */
  authorized: boolean;
  checks: ConnectorCheck[];
  /** Anything worth saying that is not a pass or a fail. */
  note: string | null;
  /** Why the inspection could not be completed, or null when it was. */
  error: string | null;
};

/**
 * What a connector's `inspect` receives: the config and credential values as
 * typed (or as loaded from the vault on a re-test), plus whatever else the
 * caller sent — Strapi's collection list rides in `options`.
 */
export type InspectInput = {
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  options: Record<string, unknown>;
};

/**
 * The input a connector cannot inspect with, thrown by `inspect` and answered
 * as a 400.
 *
 * Its own type because the message is written for whoever is typing into the
 * dialog: "The base URL must start with http:// or https://" is what a pasted
 * bare hostname earns, and a 502 would say nothing they can act on.
 */
export class InspectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InspectInputError';
  }
}

/**
 * Whether a payload is the generic checklist shape, so the Sources page knows
 * to render it rather than looking for a connector-specific renderer.
 * @param value - Whatever the inspect route returned.
 */
export function isConnectorInspection(value: unknown): value is ConnectorInspection {
  const candidate = value as ConnectorInspection | null;
  return typeof candidate === 'object'
    && candidate !== null
    && typeof candidate.reachable === 'boolean'
    && typeof candidate.authorized === 'boolean'
    && Array.isArray(candidate.checks);
}
