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
 *              "approved — do this, then say so" to whoever performs it
 *   done     → `done`, with who marked it, when, a note and a result URL
 *   reject   → `rejected`, as today, before or after approval
 *
 * The input is the same for every hand-off, because the person reading the
 * card needs the same things whatever the system: what it is, why, whether it
 * can be undone, what it costs, which account it touches, the exact steps, and
 * the sources. A specific kind extends the shape (a merge carries its risk
 * class); none of them removes a field.
 *
 * Generic on purpose. Nothing here knows about git or AWS — those are the
 * descriptors in `factory.ts`, and the next hand-off costs one more.
 */

import type { z as Z } from 'zod';
import type { Action, ReviewCard, ReviewContent } from './types';
import { z } from 'zod';

const externalRef = z.object({
  /** The system that holds the record — `github`, `vercel`, `aws`. */
  system: z.string().min(1).max(60),
  /** Its id there — a PR number, a deployment id, a change-set name. */
  id: z.string().min(1).max(200),
  /** Where a person opens it. */
  url: z.string().url().optional(),
});

/** One thing a person does, in order. */
const step = z.object({
  /** What to do, in words — "Register the domain in the metacto account." */
  say: z.string().min(1).max(300),
  /** The exact command, when there is one. Shown in its own block with a copy button. */
  run: z.string().min(1).max(4_000).optional(),
  /** Where the step happens — a console page, a PR. */
  url: z.string().url().optional(),
});

/** What approving commits the company to, as a number a person can weigh. */
const cost = z.object({
  amount: z.number().nonnegative(),
  currency: z.literal('USD'),
  /** `once` when unstated. */
  period: z.enum(['once', 'month', 'year']).optional(),
});

/** A source with a name — "Route 53 pricing", not a bare URL. */
const source = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url(),
});

/** What every hand-off carries. A kind extends it; none narrows it. */
export const manualInputShape = {
  /** One line naming the thing — "Merge #482: software-factory 1.1.0". */
  title: z.string().min(1).max(200),
  /**
   * One plain sentence saying what approving does, for the header a person
   * reads first. Falls back to the first sentence of `summary`.
   */
  headline: z.string().min(1).max(140).optional(),
  /** Why, in a few sentences a person can check against the evidence. */
  summary: z.string().min(1).max(4_000),
  /**
   * The steps, structured: what to do, the command if any, the link if any.
   * Preferred over `recipe`; one of the two is required.
   */
  steps: z.array(step).min(1).max(30).optional(),
  /**
   * The exact commands or steps as one block, whitespace kept. The fallback
   * when `steps` is absent; one of the two is required.
   */
  recipe: z.string().min(1).max(20_000).optional(),
  /** What it costs, when it costs anything — a domain, an instance, a seat. */
  cost: cost.optional(),
  /** Which account or environment it touches — "AWS account acme-prod (123456789012)". */
  target: z.string().min(1).max(200).optional(),
  /** Named sources behind the ask. Rendered first, as links with their labels. */
  sources: z.array(source).max(50).optional(),
  /** What backs the ask — URLs or record refs. URLs render as links. Kept for callers that predate `sources`. */
  evidence: z.array(z.string().min(1).max(2_000)).max(50).optional(),
  /** The record in the system that will perform or receive the work. */
  externalRef: externalRef.optional(),
} as const;

/**
 * A hand-off needs its steps in one form or the other. Applied to every
 * schema built from the shape, including a kind's extension of it.
 * @param input - The parsed payload.
 * @param input.steps - The structured steps, when written.
 * @param input.recipe - The one-block recipe, when written.
 * @param ctx - Where the refusal is filed.
 */
function requireStepsOrRecipe(input: { steps?: unknown[]; recipe?: string }, ctx: Z.RefinementCtx): void {
  if ((input.steps?.length ?? 0) === 0 && !input.recipe) {
    ctx.addIssue({ code: 'custom', path: ['steps'], message: 'A hand-off needs `steps` (say / run / url, in order) or a `recipe` block' });
  }
}

export const manualInputSchema = z.object(manualInputShape).superRefine(requireStepsOrRecipe);

export type ManualInput = z.infer<typeof manualInputSchema>;
export type ManualCost = z.infer<typeof cost>;

/**
 * Whether this action hands its execution to a person or an outside system.
 * @param action - The registered action, or nothing.
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
  return typeof input?.title === 'string'
    && typeof input?.summary === 'string'
    && (typeof input?.recipe === 'string' || (Array.isArray(input?.steps) && input.steps.length > 0));
}

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/**
 * The first sentence of a paragraph, cut to what a header holds.
 * @param text - The paragraph.
 * @param max - The longest the sentence may be.
 */
function firstSentence(text: string, max = 140): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
  const s = (m?.[1] ?? trimmed).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * `{ amount: 14, currency: 'USD', period: 'year' }` → `$14/year`; a one-off
 * reads as the number alone; nothing reads as `No cost`.
 * @param c - The cost, when the proposer named one.
 */
export function costLabel(c: ManualCost | undefined): string {
  if (!c) {
    return 'No cost';
  }
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: c.currency, maximumFractionDigits: Number.isInteger(c.amount) ? 0 : 2 }).format(c.amount);
  return c.period && c.period !== 'once' ? `${money}/${c.period}` : money;
}

/**
 * The card for one hand-off: a header a person reads first — one sentence and
 * the chips that matter (system, Irreversible or Reversible, cost, target) —
 * then the steps as a numbered list (or the recipe as a preformatted block
 * when the proposer wrote no steps), the named sources as links, and a
 * `nextAction` that says what approving does: hands it to a person, runs
 * nothing. Extra fields a kind added to the input are shown as labelled rows.
 * @param opts - What the card is built from.
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
  // Named sources first — a label beats a host — then any bare URL the
  // evidence carried that no source already names.
  const named = (input.sources ?? []).map(s => ({ label: s.label, href: s.url }));
  const namedHrefs = new Set(named.map(l => l.href));
  const links = [
    ...named,
    ...evidence.filter(e => isUrl(e) && !namedHrefs.has(e)).map(href => ({ label: linkLabel(href), href })),
  ];
  const refs = evidence.filter(e => !isUrl(e));
  const fields: ReviewCard['fields'] = [
    ...(opts.extraFields ?? []),
    ...(input.externalRef
      ? [{ label: 'Record', value: `${input.externalRef.system} ${input.externalRef.id}`, ...(input.externalRef.url ? { href: input.externalRef.url } : {}) }]
      : []),
    ...refs.map(value => ({ label: 'Evidence', value })),
  ];
  const content: ReviewContent[] = input.steps && input.steps.length > 0
    ? [{ kind: 'steps', id: 'recipe', label: 'Recipe', steps: input.steps }]
    : [{ kind: 'text', id: 'recipe', label: 'Recipe', body: input.recipe ?? '', preformatted: true }];
  const badges: NonNullable<ReviewCard['badges']> = [
    { label: opts.system },
    opts.reversible ? { label: 'Reversible' } : { label: 'Irreversible', tone: 'warn' },
    { label: costLabel(input.cost) },
    ...(input.target ? [{ label: input.target }] : []),
  ];
  return {
    title: input.title,
    system: opts.system,
    // The middle crumb: this queue is the one you APPROVE, so it is named for
    // that rather than for the recommendations the rest of the lane holds.
    object: { title: input.title, section: 'Approvals' },
    headline: input.headline ?? firstSentence(input.summary),
    badges,
    handoff: { reversible: opts.reversible },
    summary: input.summary,
    contentHeading: { label: 'Recipe' },
    content,
    fields,
    ...(links.length > 0 ? { links } : {}),
    nextAction: 'Approving hands this to a person to do. Nothing runs here; whoever does it marks it done, and the run records who and when.',
    verbs: { approve: 'Approve', reject: 'Reject' },
  };
}

/**
 * `https://github.com/acme/app/pull/482` → `github.com/acme/app/pull/482`.
 * @param href - The URL.
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
  /** Refuse a proposal before it is filed — a sentence for the proposer, or nothing. Runs with the org and the checked input. */
  precheck?: (ctx: import('./types').ActionContext, input: Record<string, unknown>) => Promise<string | void>;
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
  /** Whether a rule on the bare id governs derived keys with no rule of their own; see `Action.parentRuleGoverns`. */
  parentRuleGoverns?: boolean;
};

/**
 * Build a hand-off action from a descriptor. The result is an ordinary
 * `Action`: registered the same way, gated the same way, rendered on the same
 * card. `execute` is present because the type demands one, and it refuses:
 * `ActionService.executeAction` never calls it for a manual kind, and a path
 * that did would be a bug worth hearing about rather than a silent "done".
 * @param spec - The descriptor.
 */
export function manualAction<Extra extends Z.ZodRawShape = Record<never, never>>(spec: ManualActionSpec<Extra>): Action {
  // The extension is a kind's own shape; the shared fields are known. Inferring
  // the merged object type through zod's generics buries `externalRef` under a
  // union tsc cannot see through, so the callbacks read the parsed input as
  // the shared shape plus whatever the kind added.
  type Input = ManualInput & Z.infer<Z.ZodObject<Extra>>;
  const inputSchema = z.object({ ...manualInputShape, ...(spec.extend ?? {}) }).superRefine(requireStepsOrRecipe);
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
    ...(spec.precheck ? { precheck: (ctx, raw) => spec.precheck!(ctx, raw as Record<string, unknown>) } : {}),
    ...(spec.parentRuleGoverns ? { parentRuleGoverns: true } : {}),
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
