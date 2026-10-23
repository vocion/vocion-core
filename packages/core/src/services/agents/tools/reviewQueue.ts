/**
 * THE REVIEW QUEUE FROM CHAT — read it the way the page shows it, and decline
 * many of its decisions on one card (2026-10-23).
 *
 * Beside a workspace's Review queue a person asked "can we kill all these old
 * GTM recommendations? anything older than 5 days?". The agent's one read of
 * the queue was `query_state`'s decision set: only the person's own rows, and
 * dates as a facet filter it wrote as "since 5 days ago", the opposite of the
 * request. It said the queue was current and asked for ids, beside a page
 * whose oldest row had waited 90 days.
 *
 * - `list_review_queue` reads the open queue as the page renders it
 *   (`services/inbox/queueSelection.ts`): the age window as two typed
 *   numbers of days, the page's own kind and agent filters and its search,
 *   a total, and each decision's ref. The agent never needs ids from the
 *   person.
 * - `decline_review_items` takes the same selection (or refs it listed) and
 *   puts ONE Decision card in front of the person (`review.decline`): what,
 *   how many, a sample. Nothing is declined until they approve it.
 *
 * The counts are the page's: "N decisions and M failed runs to retry or
 * dismiss", the header's own words, so a reply quotes what the person sees.
 *
 * Both need a person in the turn. While the person is on the Review queue
 * both stay loaded, never behind the tool search.
 */
import type { RuntimeContext } from '../types';
import type { QueueFilter, QueueSelection } from '@/services/inbox/queueSelection';
import type { InboxKind } from '@/services/InboxService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { workspaceWidePage } from '@/libs/chat/workspacePages';
import { INBOX_KINDS } from '@/services/inbox/kinds';
import { openCountLine } from '@/services/inbox/openCount';

/** How each kind reads on the page, for the model: the stored kind is not always the page's word. */
const KIND_WORDS: Record<InboxKind, string> = {
  proposal: 'Recommendations (an action an agent recommends: a CRM update, an email, an enrollment)',
  recommendation: 'Choices (a short list with one option recommended)',
  ruling: 'Rulings',
  approval: 'Approvals',
  merge: 'Merges',
  input: 'Inputs',
  credential: 'Credentials',
  gate: 'Gates',
  run: 'Runs',
  exception: 'Exceptions',
  learning: 'Suggested rules',
};

const PLURAL: Record<InboxKind, string> = Object.fromEntries(Object.entries(KIND_WORDS).map(([k, v]) => [k, v.split(' (')[0]!])) as Record<InboxKind, string>;

/** How many rows a listing names; the rest are the count. */
const LIST_TOP = 25;

const filterShape = {
  older_than_days: z.number().int().min(0).max(3650).optional().describe('Only decisions that have waited AT LEAST this many days. "Older than 5 days" / "more than 5 days old" is 5.'),
  newer_than_days: z.number().int().min(1).max(3650).optional().describe('Only decisions that have waited LESS than this many days. "From the past 5 days" / "this week" is 5 / 7.'),
  kinds: z.array(z.enum(INBOX_KINDS as unknown as [InboxKind, ...InboxKind[]])).max(11).optional().describe(`Kinds, as the page's chips filter them: ${INBOX_KINDS.map(k => `${k} = ${KIND_WORDS[k]}`).join('; ')}. "Recommendations" on the page is the kind proposal. Leave empty for every kind.`),
  agents: z.array(z.string().max(80)).max(20).optional().describe('Agent slugs whose decisions to keep, as the page\'s agent filter.'),
  q: z.string().max(200).optional().describe('The page\'s search text, when the person named words to match.'),
};

/**
 * The tool args as a selection.
 * @param args - The tool args.
 * @param args.older_than_days - Lower bound.
 * @param args.newer_than_days - Upper bound.
 * @param args.kinds - Kinds.
 * @param args.agents - Agents.
 * @param args.q - Search.
 */
export function filterOf(args: { older_than_days?: number; newer_than_days?: number; kinds?: InboxKind[]; agents?: string[]; q?: string }): QueueFilter {
  return {
    ...(args.older_than_days !== undefined ? { olderThanDays: args.older_than_days } : {}),
    ...(args.newer_than_days !== undefined ? { newerThanDays: args.newer_than_days } : {}),
    ...(args.kinds?.length ? { kinds: args.kinds } : {}),
    ...(args.agents?.length ? { agents: args.agents } : {}),
    ...(args.q?.trim() ? { q: args.q.trim() } : {}),
  };
}

/**
 * What the model reads for one listing. Pure.
 * @param sel - The selection read.
 * @param words - The selection in words.
 * @param now - The clock.
 * @param top - Rows to name.
 */
export function renderQueue(sel: QueueSelection, words: string, now: Date, top = LIST_TOP): string {
  const left = sel.leftOpen.map(l => `${l.count} ${(PLURAL[l.kind] ?? l.kind).toLowerCase()} (${l.why})`);
  const head = `Review queue, this workspace: ${openCountLine(sel.open, sel.failed)}, as the page header says. ${words}: ${sel.targets.length} ${sel.targets.length === 1 ? 'decision' : 'decisions'} a decline can take, from ${sel.rows} ${sel.rows === 1 ? 'row' : 'rows'} (a row can stand for several: a sheet, a question asked again, related decisions folded into it).`;
  if (sel.targets.length === 0) {
    return [head, left.length ? `Also matching, which a decline cannot take: ${left.join('; ')}.` : '', 'Nothing to decline. Say what the queue holds instead (the open count), never that it is empty when it is not.'].filter(Boolean).join('\n');
  }
  const days = (at: Date) => Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  return [
    head,
    `Longest waiting first${sel.targets.length > top ? `; the first ${top} named` : ''}:`,
    ...sel.targets.slice(0, top).map(t => `- ${t.ref} · ${PLURAL[t.kind] ?? t.kind} · ${t.title.slice(0, 120)} · waited ${days(t.at)}d${t.agentSlug ? ` · from ${t.agentSlug}` : ''}`),
    ...(left.length ? [`Also matching, which a decline cannot take: ${left.join('; ')}.`] : []),
    'To decline these, call decline_review_items with the same selection: it puts one card in front of the person. Never ask the person for ids.',
  ].join('\n');
}

/**
 * The tools. Empty without a person in the turn.
 * @param ctx - The turn.
 */
export function reviewQueueTools(ctx: RuntimeContext) {
  const userId = ctx.userId;
  if (!userId) {
    return [];
  }
  // On the Review queue these are the turn's tools, never behind the tool search.
  const onQueue = workspaceWidePage(ctx.pageContext?.path) === 'Review queue';
  const metadata = onQueue ? { alwaysLoaded: true } : {};

  const list = tool(
    async (args) => {
      const { describeFilter, selectQueue } = await import('@/services/inbox/queueSelection');
      const f = filterOf(args);
      const now = new Date();
      const sel = await selectQueue(ctx.orgId, f, now);
      return renderQueue(sel, describeFilter(f, k => PLURAL[k]), now, args.limit ?? LIST_TOP);
    },
    {
      name: 'list_review_queue',
      metadata,
      description: 'Read this workspace\'s Review queue (the page at /dashboard/inbox): the open decisions waiting on a person, as the page shows them, filtered by how long they have waited, their kind, the agent that raised them, or a search. Returns the page\'s counts, the total a decline can take and each decision\'s ref (ask:<id>, proposal:<id>, learning:<id>), longest waiting first, and what a decline cannot take, by kind and why. Use it for any question about what is on the Review queue or "these" decisions on it; call the page the Review queue.',
      schema: z.object({ ...filterShape, limit: z.number().int().min(1).max(50).optional() }),
    },
  );

  const decline = tool(
    async (args) => {
      const [{ describeFilter, selectQueue, waitedDays }, { MAX_DECLINE, REVIEW_DECLINE_ACTION_ID, declineTitle, reviewDeclineAction }] = await Promise.all([
        import('@/services/inbox/queueSelection'),
        import('@/libs/actions/review-decline'),
      ]);
      const f = filterOf(args);
      const now = new Date();
      const sel = await selectQueue(ctx.orgId, f, now);
      // Refs the agent listed narrow the selection; they never reach past it.
      const wanted = args.refs?.length ? new Set(args.refs) : null;
      const targets = wanted ? sel.targets.filter(t => wanted.has(t.ref)) : sel.targets;
      const words = describeFilter(f, k => PLURAL[k]);
      if (targets.length === 0) {
        return `Nothing to decline: ${renderQueue(sel, words, now, 5)}`;
      }
      const chosen = targets.slice(0, MAX_DECLINE);
      const folded = chosen.filter(t => t.folded).length;
      const input = {
        refs: chosen.map(t => t.ref),
        selection: wanted ? `${chosen.length} you named (${words})` : words,
        sample: chosen.filter(t => !t.folded).slice(0, 5).map(t => ({ title: t.title.slice(0, 200), days: waitedDays(t.at, now) })),
        ...(targets.length > chosen.length ? { beyond: targets.length - chosen.length } : {}),
        ...(args.reason?.trim() ? { reason: args.reason.trim().slice(0, 300) } : {}),
        // The selection, so the result can say what is still open in it.
        ...(wanted ? {} : { filter: { ...(args.older_than_days !== undefined ? { older_than_days: args.older_than_days } : {}), ...(args.newer_than_days !== undefined ? { newer_than_days: args.newer_than_days } : {}), ...(args.kinds?.length ? { kinds: args.kinds } : {}), ...(args.agents?.length ? { agents: args.agents } : {}), ...(args.q?.trim() ? { q: args.q.trim() } : {}) } }),
        ...(sel.leftOpen.length > 0 ? { left_open: sel.leftOpen.slice(0, 12).map(l => ({ label: (PLURAL[l.kind] ?? l.kind).toLowerCase(), count: l.count, why: l.why })) } : {}),
        ...(folded > 0 ? { folded } : {}),
      };
      const parsed = reviewDeclineAction.inputSchema.safeParse(input);
      if (!parsed.success) {
        return `Card not shown: ${parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}.`;
      }
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: REVIEW_DECLINE_ACTION_ID,
          input: parsed.data,
          label: declineTitle(parsed.data),
          rationale: `You asked to clear these from the Review queue: ${parsed.data.refs.length} ${parsed.data.refs.length === 1 ? 'decision' : 'decisions'} from ${sel.rows} of its rows (${openCountLine(sel.open, sel.failed)} in all).`,
          confidence: 0.9,
          agentSlug: ctx.agentSlug,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'You asked for it; the card shows what it covers so you can check before anything is declined.',
        },
      });
      return [
        `Put one card in front of ${userId.startsWith('token:') ? 'the caller' : 'the person'}: "${declineTitle(parsed.data)}". Nothing is declined until they approve it.`,
        ...(input.beyond ? [`${input.beyond} more match; a card takes ${MAX_DECLINE}. Say so, and offer the next card after this one is decided.`] : []),
        ...(sel.leftOpen.length > 0 ? [`Not on the card, and said on it: ${sel.leftOpen.map(l => `${l.count} ${(PLURAL[l.kind] ?? l.kind).toLowerCase()} (${l.why})`).join('; ')}. Say so in your sentence.`] : []),
        'Your turn ends there: say in one sentence what the card covers. Do not list the decisions as text.',
      ].join('\n');
    },
    {
      name: 'decline_review_items',
      metadata,
      description: 'Decline many open decisions on this workspace\'s Review queue at once, when the person asks to clear, dismiss, decline, reject or "kill" them: choose them by how long they have waited, their kind, the agent that raised them or a search (the same selection as list_review_queue), or by refs it listed. Puts ONE Decision card in front of the person with the count and a sample; each is declined, as its own row\'s Decline would, only when they approve. Never ask the person for ids.',
      schema: z.object({
        ...filterShape,
        refs: z.array(z.string().regex(/^(?:ask|proposal|learning):\d+$/)).max(1000).optional().describe('Only these, from list_review_queue (ask:<id>, proposal:<id>, learning:<id>), when the person picked particular ones.'),
        reason: z.string().max(300).optional().describe('Why, in the person\'s words: written on each as the decision note.'),
      }),
    },
  );

  return [list, decline] as const;
}
