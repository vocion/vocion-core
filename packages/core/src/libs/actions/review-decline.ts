import type { Action, ReviewCard } from './types';
import { z } from 'zod';

/**
 * review.decline — decline many open decisions on the Review queue in one
 * move, as a Decision the person approves (2026-10-23).
 *
 * "Can we kill all these old GTM recommendations? anything older than 5
 * days?" is one judgement about many rows. The page has "Accept all N" for a
 * batch that recommends the same thing; chat had neither that nor its
 * opposite, so the agent asked the person for ids one at a time. The agent
 * now selects the rows from the queue (`decline_review_items`, reading
 * `services/inbox/queueSelection.ts`) and puts ONE card in front of the
 * person: what it would decline, how many, a sample. Approving declines each
 * one as its own row's Decline / Reject does: an ask is answered `reject`
 * (`AskService.decideAsk`), a recommended action is rejected
 * (`ReviewService.decide`), by the person who approved, with the reason as
 * the note. Something decided since the card was drafted is skipped and said
 * so; a failure on one never stops the rest.
 *
 * Never run without a person: every run an agent proposes waits for one
 * (`approvalRequired`), and execution refuses a run no person decided.
 * There is no Undo, as there is none on a row's Decline: a declined ask or
 * recommendation is a person's answer, and it stands.
 */

export const REVIEW_DECLINE_ACTION_ID = 'review.decline';

/** One card declines at most this many (the page's "Accept all" takes the same). */
export const MAX_DECLINE = 100;

const REF = /^(?:ask|proposal):\d+$/;

const input = z.object({
  /** The decisions to decline: `ask:<id>` | `proposal:<id>`, longest waiting first. */
  refs: z.array(z.string().regex(REF)).min(1).max(MAX_DECLINE),
  /** How they were chosen, in words: "Recommendations waiting 5 days or more". */
  selection: z.string().min(3).max(200),
  /** A few of them, for the card: their titles and how long each has waited. */
  sample: z.array(z.object({ title: z.string().max(200), days: z.number().int().min(0) })).max(8).optional(),
  /** Matching decisions beyond `refs`, when the selection was larger than one card takes. */
  beyond: z.number().int().min(0).optional(),
  /** Why, in the person's words: written on each as the decision note. */
  reason: z.string().max(300).optional(),
});

export type ReviewDeclineInput = z.infer<typeof input>;

type Outcome = { ref: string; outcome: 'declined' | 'skipped' | 'failed'; reason?: string };

/**
 * The card's title: "Decline 64 open decisions: Recommendations waiting 5 days or more". Pure.
 * @param i - The input.
 */
export function declineTitle(i: Pick<ReviewDeclineInput, 'refs' | 'selection'>): string {
  return `Decline ${i.refs.length} ${i.refs.length === 1 ? 'decision' : 'decisions'}: ${i.selection}`;
}

/**
 * Decline one, as its row's verb does.
 * @param orgId - The workspace.
 * @param ref - `ask:<id>` | `proposal:<id>`.
 * @param decidedBy - The person.
 * @param note - The reason.
 */
async function declineOne(orgId: string, ref: string, decidedBy: string, note: string | null): Promise<Outcome> {
  const [subject, raw] = ref.split(':') as ['ask' | 'proposal', string];
  const id = Number(raw);
  try {
    if (subject === 'ask') {
      const { decideAsk, getAsk } = await import('@/services/AskService');
      const ask = await getAsk(orgId, id);
      if (!ask) {
        return { ref, outcome: 'skipped', reason: 'not in this workspace' };
      }
      if (ask.status !== 'open') {
        return { ref, outcome: 'skipped', reason: `already ${ask.status}` };
      }
      await decideAsk({ orgId, id, decision: 'reject', note, decidedBy, via: 'chat' });
      return { ref, outcome: 'declined' };
    }
    const [{ and, eq }, { db }, { actionRunSchema }] = await Promise.all([import('drizzle-orm'), import('@/libs/DB'), import('@/models/Schema')]);
    const [run] = await db.select({ status: actionRunSchema.status }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id))).limit(1);
    if (!run) {
      return { ref, outcome: 'skipped', reason: 'not in this workspace' };
    }
    if (run.status !== 'pending') {
      return { ref, outcome: 'skipped', reason: `already ${run.status}` };
    }
    const { decide } = await import('@/services/ReviewService');
    // A clear-out by age is not a verdict on what each one said: it trains nothing.
    await decide({ kind: 'action', id }, 'reject', orgId, { reviewedBy: decidedBy, ...(note ? { reason: note } : {}), learn: false });
    return { ref, outcome: 'declined' };
  } catch (err) {
    return { ref, outcome: 'failed', reason: (err as Error).message.slice(0, 160) };
  }
}

/**
 * The person who decided this run: the reviewer, else the person whose own
 * word it was. Never an agent or a token.
 * @param ctx - The action's context.
 * @param ctx.reviewedBy - Who approved it on the queue.
 * @param ctx.origin - Where it was proposed.
 * @param ctx.origin.userId - The person whose turn it was.
 * @param ctx.origin.byPerson - True when that person asked for it themselves.
 */
export function personDeciding(ctx: { reviewedBy?: string; origin?: { userId?: string | null; byPerson?: boolean } }): string | null {
  const person = (id: string | null | undefined) => (id && !id.startsWith('agent:') && !id.startsWith('token:') && !id.startsWith('system') ? id : null);
  return person(ctx.reviewedBy) ?? (ctx.origin?.byPerson ? person(ctx.origin.userId) : null);
}

export const reviewDeclineAction: Action<typeof input> = {
  id: REVIEW_DECLINE_ACTION_ID,
  name: 'Decline decisions on the Review queue',
  description: 'Decline many open decisions on the Review queue at once, chosen by how long they have waited, their kind, the agent that raised them or a search: each is declined as its row\'s Decline / Reject does. Use the decline_review_items tool, which reads the queue and drafts the card. Always a card the person approves; never undone.',
  inputSchema: input,
  grant: 'review_proposal',
  external: false,
  approvalRequired: true,
  dedupKeyFor: i => `review.decline:${[...i.refs].sort().join(',')}`,
  async reviewCard(_ctx, i): Promise<ReviewCard> {
    const sample = i.sample ?? [];
    return {
      title: declineTitle(i),
      system: 'Review queue',
      headline: `Approving declines ${i.refs.length} open ${i.refs.length === 1 ? 'decision' : 'decisions'} on the Review queue, each as its own Decline would.${i.beyond ? ` ${i.beyond} more match; a card takes ${MAX_DECLINE} at a time.` : ''}`,
      badges: [{ label: 'Review queue' }, { label: `${i.refs.length} decisions` }],
      ...(i.reason ? { summary: i.reason } : {}),
      fields: [
        { label: 'Chosen by', value: i.selection },
        { label: 'Count', value: String(i.refs.length) },
        ...(sample.length > 0 ? [{ label: 'Among them', value: sample.map(s => `${s.title} (${s.days}d)`).join('; ') }] : []),
      ],
      nextAction: 'Approving declines each one now; anything decided since this card was drafted is skipped. A declined decision stays declined.',
      verbs: { approve: `Decline ${i.refs.length}`, reject: 'Keep them' },
    };
  },
  async execute(ctx, i) {
    const decidedBy = personDeciding(ctx);
    if (!decidedBy) {
      throw new Error('Only a person declines decisions on the Review queue: this run has no person who approved it.');
    }
    const results: Outcome[] = [];
    for (const ref of [...new Set(i.refs)]) {
      results.push(await declineOne(ctx.orgId, ref, decidedBy, i.reason ?? null));
    }
    const declined = results.filter(r => r.outcome === 'declined').length;
    const skipped = results.filter(r => r.outcome === 'skipped').length;
    const failed = results.filter(r => r.outcome === 'failed');
    return {
      declined,
      skipped,
      failed: failed.length,
      results,
      href: '/dashboard/inbox',
      line: `Declined ${declined} of ${results.length}${skipped ? `; ${skipped} were already decided` : ''}${failed.length ? `; ${failed.length} failed (${failed[0]!.reason})` : ''}.`,
    };
  },
};
