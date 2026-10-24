/**
 * list_outbound_history — what an agent proposed to send outside, beside where
 * it landed, so a voice or quality pass can compare the draft with what the
 * person actually sent (2026-10-23).
 *
 * The person sends a draft from Gmail after editing it there, and the draft
 * is gone once it is sent. The only record of what the agent wrote is the
 * action run: its input (the copy that ran), its revisions (`proposed`,
 * `regenerated`, `approved`) and its result (the thread and message it made).
 * No agent tool read those back for a decided run: `list_review_queue` is the
 * open queue, `list_recent_runs` lists ids and statuses. A voice analyst asked
 * "what did you draft and what did Chris send" had nothing to diff.
 *
 * Granted-only (`harness.grantTools: [list_outbound_history]`): the copy of
 * every outside send is more than most agents need in their context.
 *
 * Read-only. Every external action is in scope (`Action.external`), so no
 * action is named here; the copy is the run's own string fields, read the same
 * way for any of them. The sent version is one more read: `get_gmail_thread`
 * on the thread the result names, or a search on the recipient.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { listActions } from '@/libs/actions/registry';
import { nounCode } from '@/libs/codes';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/** Longest single copy field kept whole; a longer one is cut with its length said. */
const FIELD_MAX = 6000;
const LIMIT_MAX = 50;

type RunRow = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  invokedBy: string | null;
  proposal: { agentSlug?: string } | null;
  revisions: Array<{ kind?: string; version: number; body: string; contentId?: string; step?: number; at: string }> | null;
  createdAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
};

const clip = (s: string) => (s.length > FIELD_MAX ? `${s.slice(0, FIELD_MAX)}… [${s.length} chars]` : s);
const isLink = (s: string) => /^https?:\/\//.test(s);

/**
 * The words of a payload: every string field that is not a link, and the
 * string fields of each object in an array (a sequence's sends). Pure.
 * @param value - An action input or result.
 */
export function copyOf(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value ?? {})) {
    if (typeof v === 'string' && v.trim() !== '' && !isLink(v)) {
      out[key] = clip(v);
    } else if (Array.isArray(v) && v.some(item => item && typeof item === 'object')) {
      out[key] = v.filter(item => item && typeof item === 'object').map(item => copyOf(item as Record<string, unknown>));
    }
  }
  return out;
}

/**
 * Where a run landed: the string ids and links its result carries. Pure.
 * @param result - The run's result.
 */
export function landedOf(result: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(result ?? {})) {
    if (typeof v === 'string' && v.trim() !== '') {
      out[key] = v;
    }
  }
  return out;
}

/**
 * One run as the agent reads it. Pure.
 * @param row - The run.
 */
export function outboundEntry(row: RunRow) {
  return {
    code: nounCode('action', row.id),
    action: row.actionId,
    status: row.status,
    agent: row.proposal?.agentSlug ?? row.invokedBy ?? null,
    proposedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    copy: copyOf(row.input),
    revisions: (row.revisions ?? []).map(r => ({ kind: r.kind ?? 'regenerated', version: r.version, ...(r.contentId ? { contentId: r.contentId } : {}), at: r.at, body: clip(r.body) })),
    landed: landedOf(row.result),
    ...(row.error ? { error: clip(row.error) } : {}),
  };
}

export const OUTBOUND_HISTORY_TOOL = 'list_outbound_history';

export function outboundHistoryTools(ctx: RuntimeContext) {
  if (!(ctx.harnessConfig.grantTools ?? []).includes(OUTBOUND_HISTORY_TOOL)) {
    return [];
  }
  return [tool(
    async (args) => {
      const external = listActions().filter(a => a.external).map(a => a.id);
      const wanted = args.actions?.length ? external.filter(id => args.actions!.includes(id)) : external;
      if (wanted.length === 0) {
        return JSON.stringify({ total: 0, runs: [], note: `No external action matches; external actions are ${external.join(', ')}` });
      }
      const since = new Date(Date.now() - (args.days ?? 7) * 86_400_000);
      const rows = await db
        .select({
          id: actionRunSchema.id,
          actionId: actionRunSchema.actionId,
          status: actionRunSchema.status,
          input: actionRunSchema.input,
          result: actionRunSchema.result,
          error: actionRunSchema.error,
          invokedBy: actionRunSchema.invokedBy,
          proposal: actionRunSchema.proposal,
          revisions: actionRunSchema.revisions,
          createdAt: actionRunSchema.createdAt,
          decidedAt: actionRunSchema.decidedAt,
          executedAt: actionRunSchema.executedAt,
        })
        .from(actionRunSchema)
        .where(and(
          eq(actionRunSchema.orgId, ctx.orgId),
          inArray(actionRunSchema.actionId, wanted),
          gte(actionRunSchema.createdAt, since),
          ...(args.statuses?.length ? [inArray(actionRunSchema.status, args.statuses)] : []),
        ))
        .orderBy(desc(actionRunSchema.createdAt))
        .limit(args.limit ?? 25);
      return JSON.stringify({
        since: since.toISOString(),
        total: rows.length,
        runs: rows.map(r => outboundEntry(r as RunRow)),
        next: 'To compare a draft with what was sent, read the thread its `landed.threadId` names with get_gmail_thread; for a run that never landed, search the recipient\'s thread instead.',
      }, null, 2);
    },
    {
      name: OUTBOUND_HISTORY_TOOL,
      description: 'What agents proposed to send outside this workspace (emails, sequences, posts: every external action) over the last N days, decided or not: each run\'s status, the agent, the copy as it ran (`copy`), its revisions (`proposed` = the agent\'s first copy, `regenerated`, `approved` = what the reviewer vouched for) and where it landed (`landed`: thread, message and draft ids, the link). Use it to compare what an agent wrote with what the person actually sent: read the sent thread with get_gmail_thread. Read-only.',
      schema: z.object({
        days: z.number().int().min(1).max(90).optional().describe('How far back, in days (default 7).'),
        actions: z.array(z.string()).max(20).optional().describe('Only these external action ids; omit for all of them.'),
        statuses: z.array(z.string()).max(10).optional().describe('Only runs in these statuses (done, rejected, pending, failed, undone, closed); omit for all.'),
        limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe('Newest first; default 25.'),
      }),
    },
  )];
}
