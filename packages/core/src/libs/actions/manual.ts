/**
 * Hand-off actions — the generic `manual` executor kind.
 *
 * Some of the work an agent asks for is done by a person, or by a system
 * core does not host: merge this branch, run this deploy, paste this
 * credential, announce this release. Until now that work could not be
 * proposed at all — `propose_action` needs a registered id, and every
 * registered kind executed in-process — so the factory had a trust rule for
 * a merge and no way to ask for one.
 *
 * A hand-off action rides the same path as every other kind, and only the
 * last step differs:
 *
 *   propose  → an `action_run`, gated by the kind's trust rule like any other
 *   approve  → `awaiting_execution`. Nothing runs here; the run now says
 *              "released — do this, then say so" to whoever performs it
 *   done     → `done`, with who marked it, when, a note and a result URL
 *   reject   → `rejected`, as today, before or after approval
 *
 * The input is the same for every hand-off, because the person reading the
 * card needs the same four things whatever the system: what it is, why, the
 * exact steps, and the evidence. A specific kind extends the shape (a merge
 * carries its risk class); none of them removes a field.
 *
 * Generic on purpose. Nothing here knows about git or AWS — those are the
 * descriptors in `factory.ts`, and the next hand-off costs one more.
 */

import type { z as Z } from 'zod';
import type { Action, ReviewCard } from './types';
import { z } from 'zod';

const externalRef = z.object({
  /** The system that holds the record — `github`, `vercel`, `aws`. */
  system: z.string().min(1).max(60),
  /** Its id there — a PR number, a deployment id, a change-set name. */
  id: z.string().min(1).max(200),
  /** Where a person opens it. */
  url: z.string().url().optional(),
});

/** What every hand-off carries. A kind extends it; none narrows it. */
export const manualInputShape = {
  /** One line naming the thing — "Merge #482: software-factory 1.1.0". */
  title: z.string().min(1).max(200),
  /** Why, in a few sentences a person can check against the evidence. */
  summary: z.string().min(1).max(4_000),
  /** The exact commands or steps, in order. Shown as written, whitespace kept. */
  recipe: z.string().min(1).max(20_000),
  /** What backs the ask — URLs or record refs. URLs render as links. */
  evidence: z.array(z.string().min(1).max(2_000)).max(50).optional(),
  /** The record in the system that will perform or receive the work. */
  externalRef: externalRef.optional(),
} as const;

export const manualInputSchema = z.object(manualInputShape);

export type ManualInput = z.infer<typeof manualInputSchema>;

/**
 * Whether this action hands its execution to a person or an outside system.
 * @param action
 */
export function isManualAction(action: Pick<Action, 'manual'> | undefined | null): boolean {
  return Boolean(action?.manual);
}

/**
 * Whether a payload has the hand-off shape — for the pure describers that
 * read a row without the registry in reach.
 * @param input - A run's input.
 */
export function looksLikeManualInput(input: Record<string, unknown> | null | undefined): input is ManualInput & Record<string, unknown> {
  return typeof input?.title === 'string' && typeof input?.recipe === 'string' && typeof input?.summary === 'string';
}

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/**
 * The card for one hand-off: the recipe as a preformatted block, the evidence
 * as links where it is a link and as a detail row where it is a reference,
 * and a `nextAction` that says what approving does — releases it, runs
 * nothing. Extra fields a kind added to the input are shown as labelled rows.
 * @param opts
 * @param opts.system - The badge — "Git", "Deploy".
 * @param opts.input - The validated input.
 * @param opts.extraFields - Rows a kind adds (a merge's risk class).
 * @param opts.reversible - Whether the kind says it can be put back.
 */
export function manualReviewCard(opts: {
  system: string;
  input: ManualInput;
  extraFields?: Array<{ label: string; value: string }>;
  reversible: boolean;
}): ReviewCard {
  const { input } = opts;
  const evidence = input.evidence ?? [];
  const links = evidence.filter(isUrl).map(href => ({ label: linkLabel(href), href }));
  const refs = evidence.filter(e => !isUrl(e));
  const fields: ReviewCard['fields'] = [
    ...(opts.extraFields ?? []),
    ...(input.externalRef
      ? [{ label: 'Record', value: `${input.externalRef.system} ${input.externalRef.id}`, ...(input.externalRef.url ? { href: input.externalRef.url } : {}) }]
      : []),
    ...refs.map(value => ({ label: 'Evidence', value })),
    { label: 'Performed by', value: 'a person, or the system that asked — not this app' },
    { label: 'Can be put back', value: opts.reversible ? 'yes' : 'no' },
  ];
  return {
    title: input.title,
    system: opts.system,
    summary: input.summary,
    contentHeading: { label: 'Recipe' },
    content: [{ kind: 'text', id: 'recipe', label: 'Recipe', body: input.recipe, preformatted: true }],
    fields,
    ...(links.length > 0 ? { links } : {}),
    nextAction: 'Approving releases this to be done by hand. Nothing runs here; whoever does it marks it done, and the run records who and when.',
    verbs: { approve: 'Release', reject: 'Decline' },
  };
}

/**
 * `https://github.com/acme/app/pull/482` → `github.com/acme/app/pull/482`.
 * @param href
 */
function linkLabel(href: string): string {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/$/, '');
    return `${u.host}${path.length > 48 ? `${path.slice(0, 45)}…` : path}`;
  } catch {
    return href;
  }
}

export type ManualActionSpec<Extra extends Z.ZodRawShape = Record<never, never>> = {
  id: string;
  name: string;
  description: string;
  /** The card's badge — "Git", "Deploy", "AWS". */
  system: string;
  /** authz grant the proposer needs. */
  grant: string;
  /** Whether what it does can be put back with one step. Default false: hand-offs usually cannot. */
  reversible?: boolean;
  /** Fields this kind adds to the shared hand-off input. */
  extend?: Extra;
  /** Labelled rows for the added fields, read off the validated input. */
  extraFields?: (input: ManualInput & Z.infer<Z.ZodObject<Extra>>) => Array<{ label: string; value: string }>;
  /** The ladder key for this input, when one id serves several ledgers. */
  policyKeyFor?: (input: ManualInput & Z.infer<Z.ZodObject<Extra>>) => string;
};

/**
 * Build a hand-off action from a descriptor. The result is an ordinary
 * `Action`: registered the same way, gated the same way, rendered on the same
 * card. `execute` is present because the type demands one, and it refuses:
 * `ActionService.executeAction` never calls it for a manual kind, and a path
 * that did would be a bug worth hearing about rather than a silent "done".
 * @param spec
 */
export function manualAction<Extra extends Z.ZodRawShape = Record<never, never>>(spec: ManualActionSpec<Extra>): Action {
  // The extension is a kind's own shape; the shared fields are known. Inferring
  // the merged object type through zod's generics buries `externalRef` under a
  // union tsc cannot see through, so the callbacks read the parsed input as
  // the shared shape plus whatever the kind added.
  type Input = ManualInput & Z.infer<Z.ZodObject<Extra>>;
  const inputSchema = z.object({ ...manualInputShape, ...(spec.extend ?? {}) });
  const reversible = spec.reversible === true;
  const action: Action = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    inputSchema,
    grant: spec.grant,
    // A hand-off always reaches the outside world — that is why it is handed off.
    external: true,
    manual: { reversible },
    // Two proposals about the same PR, deployment or change set are one card;
    // a proposal that names no record stands on its own.
    dedupKeyFor: (raw) => {
      const input = raw as Input;
      return input.externalRef ? `${spec.id}:${input.externalRef.system}:${input.externalRef.id}`.toLowerCase() : undefined;
    },
    ...(spec.policyKeyFor ? { policyKeyFor: (raw: unknown) => spec.policyKeyFor!(raw as Input) } : {}),
    async reviewCard(_ctx, raw) {
      const input = raw as Input;
      return manualReviewCard({
        system: spec.system,
        input,
        extraFields: spec.extraFields?.(input),
        reversible,
      });
    },
    async execute() {
      throw new Error(`${spec.id} is a hand-off: it is performed outside this app after approval and marked done by whoever did it, never executed here`);
    },
  };
  return action;
}
