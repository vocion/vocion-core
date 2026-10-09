/**
 * query_state — "what is in this state", for every kind of thing a workspace
 * keeps: owed email replies, meetings to prepare, stale deals, overdue tasks,
 * reviews requested, unpaid invoices, decisions waiting, broken connections.
 * One tool, one shape (`services/state/state.ts`), instead of a tool per
 * question.
 *
 * The agent either runs a SAVED VIEW by slug — named, described queries kept
 * as rows, the core ones shipped as data (`libs/state/coreViews.json`), plus
 * the Org's, the workspace's and the person's own (`services/state/state.ts`)
 * — or composes an ad-hoc query over the declared facets. Each row is citable
 * and lands in the sources sidebar; the output says how fresh the index is.
 *
 * A question the person keeps asking is noticed by its shape
 * (`services/state/state.ts`), and the output tells the agent it may
 * offer to save it as the person's view — a Decision the agent raises, never
 * one the system files on its own.
 */
import type { RuntimeContext } from '../types';
import type { StateQuery, StateRead, StateRow, StateView } from '@/services/state/state';
import { tool } from '@langchain/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { describeSet, FACET_SETS, handlesOf } from '@/libs/retrieval/facets';
import coreViewsData from '@/libs/state/coreViews.json';
import { DEFAULT_TIME_ZONE, formatDate } from '@/libs/time/zone';
import { userSchema } from '@/models/Schema';
import { dateStamp, toSearchDocument } from '../search';

/** The facets a row's line shows, beside its title and date. */
const LINE_FACETS = ['reply_state', 'category', 'counterpart', 'ask', 'start', 'stage', 'amount', 'assignee', 'status', 'due', 'balance', 'customer', 'channel', 'author', 'kind', 'risk', 'error'];

/**
 * One row as the model reads it.
 * @param r - The row.
 * @param n - Its citation number.
 * @param now - The clock.
 * @param tz - The person's zone.
 */
function rowLine(r: StateRow, n: number, now: Date, tz: string): string {
  const facts = LINE_FACETS
    .filter(k => r.facets[k] !== undefined && r.facets[k] !== null && r.facets[k] !== '')
    .map(k => `${k} ${String(r.facets[k]).slice(0, 140)}`);
  return [
    `[${n}] **${r.title}**${r.live ? ' · LIVE' : ''}`,
    `   ${[r.noun, r.at ? dateStamp(r.at.toISOString(), now, tz) : '', ...facts].filter(Boolean).join(' · ')}`,
  ].join('\n');
}

/**
 * What the model reads for one read. Pure.
 * @param read - The read.
 * @param opts - How to say it.
 * @param opts.view - The view it ran, when it ran one.
 * @param opts.base - The citation number before the first row.
 * @param opts.now - The clock.
 * @param opts.tz - The person's zone.
 */
export function renderStateRead(read: StateRead & { live?: { checked: number; error?: string } }, opts: { view?: StateView; base: number; now: Date; tz: string }): string {
  const head: string[] = [];
  if (opts.view) {
    head.push(`${opts.view.name} — ${opts.view.description}`);
  }
  if (read.sources.length > 0) {
    head.push(`From the synced index (${read.sources.map(s => `${s.slug} synced ${s.syncedAt ? formatDate(s.syncedAt, opts.tz) : 'never'}`).join('; ')}).`);
  }
  if (read.live) {
    head.push(read.live.error
      ? `A live check for newer items failed (${read.live.error}); the list may miss the last few hours.`
      : `Live check past the sync: ${read.live.checked} newer item${read.live.checked === 1 ? '' : 's'} read (marked LIVE; labelled from headers, not read for meaning).`);
  }
  if (read.missing.length > 0) {
    head.push(`Nothing connected here carries ${read.missing.join(', ')}: say so rather than guessing.`);
  }
  head.push('This is the complete list for the query: do not search for more with other phrases.');
  if (read.rows.length === 0) {
    return [...head, '', 'Nothing matches.'].join('\n');
  }
  return [
    ...head,
    '',
    `${read.rows.length}${read.total > read.rows.length ? ` of ${read.total}` : ''}:`,
    ...read.rows.map((r, i) => rowLine(r, opts.base + i + 1, opts.now, opts.tz)),
  ].join('\n');
}

/** Vocion's own record kinds (`services/state/state.ts` RECORD_SETS), named here so the tool's import graph stays small. */
const RECORD_KINDS = [
  { id: 'vocion.decision', description: 'decisions in the review queue that are the person\'s to make (asks, approvals, proposed actions)' },
  { id: 'vocion.connection', description: 'connected systems whose last sync failed, with the reason' },
];

const SET_IDS = [...FACET_SETS.map(s => s.id), ...RECORD_KINDS.map(s => s.id)] as [string, ...string[]];

/**
 * The tool. Present for every agent; `$me` needs a person in the turn.
 * @param ctx - The turn.
 */
export function queryStateTool(ctx: RuntimeContext) {
  const views = (coreViewsData as { views: Array<{ slug: string; name: string }> }).views.map(v => `${v.slug} (${v.name})`).join(', ');
  const kinds = [
    ...FACET_SETS.map(s => `${s.id} — ${s.noun}s: ${describeSet(s)}`),
    ...RECORD_KINDS.map(s => `${s.id} — ${s.description}`),
  ].join(' | ');
  return tool(
    async (args) => {
      // The state services reach the database and the inbox; loaded when the tool runs, not when it is listed.
      const [{ noteQuery, suggestionNote }, { withLiveGap }, { checkQuery, runStateQuery }, { viewBySlug, viewsFor }, { actAs }] = await Promise.all([
        import('@/services/state/state'),
        import('@/services/state/state'),
        import('@/services/state/state'),
        import('@/services/state/state'),
        import('@/services/workspace/actAs'),
      ]);
      const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
      const identity = ctx.userId ? await actAs(ctx.userId, ctx.orgId).catch(() => null) : null;
      const where = { orgId: ctx.orgId, accountId: identity?.accountId ?? null, userId: ctx.userId ?? null };
      if (args.list) {
        const all = await viewsFor(where);
        return all.map(v => `- ${v.slug} — ${v.name}: ${v.description}${v.scope === 'core' ? '' : ` (${v.scope}'s)`}`).join('\n') || 'No views.';
      }
      let view: StateView | undefined;
      let query: StateQuery;
      if (args.view) {
        view = await viewBySlug(args.view, where);
        if (!view) {
          const all = await viewsFor(where);
          return `No view "${args.view}". Views here: ${all.map(v => v.slug).join(', ')}. Or compose a query with sets and filter.`;
        }
        query = { ...view.query, ...(args.limit ? { limit: args.limit } : {}) };
      } else {
        query = { sets: args.sets ?? [], ...(args.filter ? { filter: args.filter as StateQuery['filter'] } : {}), ...(args.sort ? { sort: args.sort } : {}), ...(args.limit ? { limit: args.limit } : {}) };
      }
      const problems = checkQuery(query);
      if (problems.length > 0) {
        return `Query not run: ${problems.map(p => p.message).join('; ')}. Correct it and call again.`;
      }
      const [person] = ctx.userId ? await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, ctx.userId)).limit(1) : [];
      const stateCtx = { orgIds: [ctx.orgId], allowedSourceSlugs: ctx.allowedSourceSlugs, userId: ctx.userId, me: person ? handlesOf(person) : [], now: new Date() };
      let read: StateRead & { live?: { checked: number; error?: string } } = await runStateQuery(query, stateCtx);
      if (args.live) {
        read = await withLiveGap(read, query, stateCtx);
      }
      const base = ctx.citationSeq.current;
      ctx.citationSeq.current += read.rows.length;
      ctx.emit({
        type: 'documents',
        documents: read.rows.map((r, i) => toSearchDocument({
          document_id: r.documentId ? String(r.documentId) : (r.key ?? `${r.set}:${i}`),
          semantic_identifier: r.title,
          link: r.link ?? '',
          source_type: r.sourceSlug ?? r.set,
          blurb: String(r.facets.ask ?? r.facets.error ?? r.noun),
          updated_at: r.at?.toISOString(),
        }, base + i + 1)),
      });
      let out = renderStateRead(read, { view, base, now: stateCtx.now, tz });
      if (ctx.userId) {
        const own = (await viewsFor(where)).filter(v => v.scope === 'person');
        const habit = await noteQuery({ orgId: ctx.orgId, userId: ctx.userId, query, viewSlug: view?.slug, ownViews: own });
        if (habit) {
          out = `${out}\n\n${suggestionNote(habit)}`;
        }
      }
      return out;
    },
    {
      name: 'query_state',
      // The one way to state questions: loaded from day one, never behind tool search (`toolTiers.ts`).
      // A read that does not change within a turn: a repeat is answered from the first (turn evidence).
      metadata: { alwaysLoaded: true, turnMemo: true },
      description: [
        'What is in a given STATE right now, read from the records and the synced index in one call: email replies owed or awaited, meetings to prepare for, stale deals, overdue tasks, reviews requested, overdue invoices, Slack mentions, decisions waiting on the person, broken connections. Use it for any "what do I need to…", "what is waiting / overdue / stale / next" question instead of searching for phrases.',
        `Run a saved VIEW by slug (core views: ${views}; the person and workspace may have more — list: true shows them), or compose a query: sets (kinds) + filter (facets) + sort.`,
        `Kinds and their facets: ${kinds}.`,
        'Filter values: a value or list (any of), {"not": …}, {"since": "-14d", "until": "now"} for dates (ISO or relative: -30m, -24h, -14d, +24h, now), {"gt": 0} / {"lt": …} for numbers, {"exists": true}; "$me" is the person asking. Example: "what sales emails do I need to answer" is view "owed-replies" with nothing else, or sets ["mail.thread"] filter {"reply_state": "needs_my_reply", "category": "sales", "mailbox": "$me"}.',
        'Set live: true only when the person asks about right now, today or the latest: mail newer than the last sync is then read live too.',
      ].join(' '),
      schema: z.object({
        view: z.string().optional().describe('A saved view\'s slug, e.g. "owed-replies".'),
        sets: z.array(z.enum(SET_IDS)).optional().describe('Kinds to read, for an ad-hoc query.'),
        filter: z.record(z.string(), z.unknown()).optional().describe('Facet filter, for an ad-hoc query.'),
        sort: z.object({ facet: z.string(), dir: z.enum(['asc', 'desc']) }).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        live: z.boolean().optional().describe('Also read mail newer than the last sync, live. Only for "right now" / "today" / "latest".'),
        list: z.boolean().optional().describe('List the views in reach instead of running one.'),
      }),
    },
  );
}
