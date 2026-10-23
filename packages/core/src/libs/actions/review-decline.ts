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
 * ALL OF IT, AND SAY WHAT IS LEFT (2026-10-23, the second clear-out). "Close
 * work older than 7 days" became a card capped at 100 of the oldest, and the
 * agent's reply was "Done. Cleared 100" beside a page still holding rows of 30
 * to 51 days. A card now takes every matching decision (up to
 * `MAX_DECLINE`, said on the card when more match), a suggested rule and a
 * failed run too, each through its row's own Reject. And the result says what
 * is still open in the same selection afterwards, by kind and why, which is
 * what the agent reports.
 *
 * Never run without a person: every run an agent proposes waits for one
 * (`approvalRequired`), and execution refuses a run no person decided.
 * There is no Undo, as there is none on a row's Decline: a declined ask or
 * recommendation is a person's answer, and it stands.
 */

export const REVIEW_DECLINE_ACTION_ID = 'review.decline';

/** One card declines at most this many; a queue is a few hundred rows, so a larger selection is said on the card. */
export const MAX_DECLINE = 1000;

const REF = /^(?:ask|proposal|learning):\d+$/;

/** The selection a card was drawn from, kept so the result can say what is still open in it. */
const filterInput = z.object({
  older_than_days: z.number().int().min(0).max(3650).optional(),
  newer_than_days: z.number().int().min(1).max(3650).optional(),
  kinds: z.array(z.string().max(40)).max(11).optional(),
  agents: z.array(z.string().max(80)).max(20).optional(),
  q: z.string().max(200).optional(),
});

const input = z.object({
  /** The decisions to decline: `ask:<id>` | `proposal:<id>` | `learning:<id>`, longest waiting first. */
  refs: z.array(z.string().regex(REF)).min(1).max(MAX_DECLINE),
  /** How they were chosen, in words: "Recommendations waiting 5 days or more". */
  selection: z.string().min(3).max(200),
  /** A few of them, for the card: their titles and how long each has waited. */
  sample: z.array(z.object({ title: z.string().max(200), days: z.number().int().min(0) })).max(8).optional(),
  /** Matching decisions beyond `refs`, when the selection was larger than one card takes. */
  beyond: z.number().int().min(0).optional(),
  /** Why, in the person's words: written on each as the decision note. */
  reason: z.string().max(300).optional(),
  /** The selection, when the card was drawn from one rather than from named refs. */
  filter: filterInput.optional(),
  /** Matching decisions a decline cannot take, by kind and why: said on the card before anyone approves. */
  left_open: z.array(z.object({ label: z.string().max(80), count: z.number().int().min(1), why: z.string().max(160) })).max(12).optional(),
  /** Of `refs`, the ones folded into another row (asked again, or a related decision). */
  folded: z.number().int().min(0).optional(),
});

export type ReviewDeclineInput = z.infer<typeof input>;

type Outcome = { ref: string; outcome: 'declined' | 'skipped' | 'failed'; reason?: string };

/** The note a suggested rule's rejection carries when the person gave none: a reject needs one, and this one says it was not judged. */
export const CLEAR_OUT_NOTE = 'Cleared from the Review queue by age; not reviewed on its merits.';

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
  const [subject, raw] = ref.split(':') as ['ask' | 'proposal' | 'learning', string];
  const id = Number(raw);
  try {
    if (subject === 'learning') {
      const { decideCandidate } = await import('@/services/LearningCandidateService');
      const r = await decideCandidate({ orgId, id, decision: 'reject', reason: note ?? CLEAR_OUT_NOTE, decidedBy });
      if (r.ok) {
        return { ref, outcome: 'declined' };
      }
      return r.error === 'not_found' ? { ref, outcome: 'skipped', reason: 'not in this workspace' } : r.error === 'already_decided' ? { ref, outcome: 'skipped', reason: 'already decided' } : { ref, outcome: 'failed', reason: r.error };
    }
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
    // Pending, or failed and waiting to be retried or dismissed: the row's Reject takes both.
    if (run.status !== 'pending' && run.status !== 'failed') {
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
  recordCount: i => i.refs.length,
  async reviewCard(_ctx, i): Promise<ReviewCard> {
    const sample = i.sample ?? [];
    const left = leftOpenLine(i.left_open);
    return {
      title: declineTitle(i),
      system: 'Review queue',
      headline: `Approving declines ${i.refs.length} open ${i.refs.length === 1 ? 'decision' : 'decisions'} on the Review queue, each as its own Decline would.${i.beyond ? ` These are the first ${i.refs.length} of ${i.refs.length + i.beyond}; ${i.beyond} more match.` : ''}${left ? ` Not included: ${left}.` : ''}`,
      badges: [{ label: 'Review queue' }, { label: `${i.refs.length} decisions` }],
      ...(i.reason ? { summary: i.reason } : {}),
      fields: [
        { label: 'Chosen by', value: i.selection },
        { label: 'Count', value: `${i.refs.length}${i.folded ? ` (${i.folded} of them folded into another row: asked again, or a related decision)` : ''}` },
        ...(sample.length > 0 ? [{ label: 'Among them', value: sample.map(s => `${s.title} (${s.days}d)`).join('; ') }] : []),
        ...(left ? [{ label: 'Not included', value: left }] : []),
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
    // What is still open in the same selection now: the number the reply
    // reports, so "done" can only be said when it is.
    const after = i.filter ? await stillOpen(ctx.orgId, i.filter) : null;
    return {
      declined,
      skipped,
      failed: failed.length,
      results,
      ...(after ? { stillOpen: after } : {}),
      href: '/dashboard/inbox',
      line: resultLine({ declined, chosen: results.length, skipped, failed: failed.map(f => f.reason ?? 'unknown'), after }),
    };
  },
};

/** What is still open in a card's selection after it ran. */
export type StillOpen = {
  /** Decisions a decline could still take (they arrived, or more matched than the card took). */
  declinable: number;
  /** Decisions a decline cannot take, by kind and why. */
  leftOpen: Array<{ label: string; count: number; why: string }>;
  /** The page's open count now, and of it the failed runs. */
  open: number;
  failed: number;
};

/**
 * "6 runs (a paused run is resumed or cancelled on its own page) and 2 exceptions (…)". Pure.
 * @param left - By kind and why.
 */
export function leftOpenLine(left: ReadonlyArray<{ label: string; count: number; why: string }> | undefined): string {
  if (!left || left.length === 0) {
    return '';
  }
  return left.map(l => `${l.count} ${l.label} (${l.why})`).join('; ');
}

/**
 * The result in one line, from the numbers: never "done" while the selection
 * still holds something. Pure.
 * @param r - What happened.
 * @param r.declined - Declined now.
 * @param r.chosen - On the card.
 * @param r.skipped - Already decided since the card was drawn.
 * @param r.failed - Why each failure failed.
 * @param r.after - What is still open in the selection, when the card kept one.
 */
export function resultLine(r: { declined: number; chosen: number; skipped: number; failed: string[]; after: StillOpen | null }): string {
  const parts = [`Declined ${r.declined} of the ${r.chosen} on the card`];
  if (r.skipped) {
    parts.push(`${r.skipped} were already decided`);
  }
  if (r.failed.length) {
    parts.push(`${r.failed.length} failed (${r.failed[0]})`);
  }
  let line = `${parts.join('; ')}.`;
  if (r.after) {
    const left = leftOpenLine(r.after.leftOpen);
    const still = r.after.declinable + r.after.leftOpen.reduce((n, l) => n + l.count, 0);
    line += still === 0
      ? ' Nothing in that selection is still open.'
      : ` Still open in that selection: ${[r.after.declinable ? `${r.after.declinable} that another card can decline` : '', left].filter(Boolean).join('; ')}.`;
    line += ` The Review queue now holds ${r.after.open - r.after.failed} ${r.after.open - r.after.failed === 1 ? 'decision' : 'decisions'}${r.after.failed ? ` and ${r.after.failed} failed ${r.after.failed === 1 ? 'run' : 'runs'} to retry or dismiss` : ''}.`;
  }
  return line;
}

/**
 * Read the selection again, after the declines.
 * @param orgId - The workspace.
 * @param f - The card's selection.
 */
async function stillOpen(orgId: string, f: z.infer<typeof filterInput>): Promise<StillOpen | null> {
  try {
    const [{ KIND_PLURAL, selectQueue }, { isInboxKind }] = await Promise.all([
      import('@/services/inbox/queueSelection'),
      import('@/services/inbox/kinds'),
    ]);
    const sel = await selectQueue(orgId, {
      ...(f.older_than_days !== undefined ? { olderThanDays: f.older_than_days } : {}),
      ...(f.newer_than_days !== undefined ? { newerThanDays: f.newer_than_days } : {}),
      ...(f.kinds?.length ? { kinds: f.kinds.filter(isInboxKind) } : {}),
      ...(f.agents?.length ? { agents: f.agents } : {}),
      ...(f.q ? { q: f.q } : {}),
    });
    return {
      declinable: sel.targets.length,
      leftOpen: sel.leftOpen.map(l => ({ label: KIND_PLURAL[l.kind].toLowerCase(), count: l.count, why: l.why })),
      open: sel.open,
      failed: sel.failed,
    };
  } catch {
    return null;
  }
}
