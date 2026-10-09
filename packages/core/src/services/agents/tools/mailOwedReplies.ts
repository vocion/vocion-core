/**
 * mail_owed_replies — the email threads waiting on the person, read from the
 * state filed at sync (`services/mail/owedReplies.ts`). One call answers "what
 * emails do I need to answer"; on 2026-10-09 the same question took 35 steps
 * of phrase searches (`libs/retrieval/facets.ts`).
 *
 * Each row is citable like a search hit and lands in the sources sidebar, and
 * the output says how fresh the index is and which rows were read live.
 */
import type { RuntimeContext } from '../types';
import type { OwedRepliesRead, OwedReply } from '@/services/mail/owedReplies';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { REPLY_STATES, THREAD_CATEGORIES } from '@/libs/retrieval/facets';
import { DEFAULT_TIME_ZONE, formatDate } from '@/libs/time/zone';
import { readOwedReplies, withLiveGap } from '@/services/mail/owedReplies';
import { dateStamp, toSearchDocument } from '../search';

const STATE_WORDS: Record<OwedReply['state'], string> = {
  needs_my_reply: 'owed a reply',
  waiting_on_them: 'waiting on them',
  fyi: 'for information',
  outbound_spam: 'cold pitch',
};

/**
 * What the model reads. Pure.
 * @param read - The read.
 * @param base - The citation number before the first row.
 * @param now - The clock.
 * @param tz - The person's zone.
 */
export function renderOwedReplies(read: OwedRepliesRead, base: number, now: Date, tz: string = DEFAULT_TIME_ZONE): string {
  const fresh = read.watermarks.length === 0
    ? 'No mail source is connected.'
    : `From the synced index (${read.watermarks.map(w => `${w.sourceSlug} synced ${w.syncedAt ? formatDate(w.syncedAt, tz) : 'never'}`).join('; ')}).`;
  const live = read.live
    ? read.live.error
      ? ` A live check for newer mail failed (${read.live.error}); say the list may miss the last few hours.`
      : ` Live check past the sync: ${read.live.checked} newer thread${read.live.checked === 1 ? '' : 's'} read (rows marked LIVE; labelled by who wrote last, not read for meaning).`
    : '';
  const out = [`${fresh}${live} This is the complete list for the filter: do not search for more with other phrases.`];
  if (read.items.length === 0) {
    out.push('', 'Nothing matches.');
    return out.join('\n');
  }
  out.push('', `${read.items.length}${read.total > read.items.length ? ` of ${read.total}` : ''} thread${read.items.length === 1 ? '' : 's'}, longest-waiting first:`);
  read.items.forEach((r, i) => {
    const parts = [
      `[${base + i + 1}] **${r.subject}** — ${r.counterpart || 'unknown sender'}`,
      `   ${STATE_WORDS[r.state]}${r.category !== 'unknown' ? ` · ${r.category}` : ''}${r.from === 'live' ? ' · LIVE' : ''}`
      + `${r.lastInboundAt ? ` · they wrote ${dateStamp(r.lastInboundAt.toISOString(), now, tz)}` : ''}`
      + `${r.lastOutboundAt ? ` · you last wrote ${formatDate(r.lastOutboundAt, tz)}` : ' · you have not replied in the thread'}`,
      r.ask ? `   Ask: ${r.ask}` : '',
    ];
    out.push(parts.filter(Boolean).join('\n'));
  });
  return out.join('\n');
}

/**
 * The tool, present with a mail source.
 * @param ctx - The turn.
 */
export function mailOwedRepliesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const query = {
        orgId: ctx.orgId,
        allowedSourceSlugs: ctx.allowedSourceSlugs,
        states: args.state?.length ? args.state : undefined,
        category: args.category?.length ? args.category : undefined,
        person: args.person || undefined,
        since: args.since && !Number.isNaN(Date.parse(args.since)) ? new Date(args.since) : undefined,
      };
      let read = await readOwedReplies(query);
      if (args.live) {
        read = await withLiveGap(read, query);
      }
      const now = new Date();
      const base = ctx.citationSeq.current;
      ctx.citationSeq.current += read.items.length;
      ctx.emit({
        type: 'documents',
        documents: read.items.map((r, i) => toSearchDocument({
          document_id: r.documentId ? String(r.documentId) : `live:${r.threadId}`,
          semantic_identifier: `${r.subject} — ${r.counterpart}`,
          link: r.uri ?? '',
          source_type: r.sourceSlug,
          blurb: r.ask || STATE_WORDS[r.state],
          updated_at: r.lastInboundAt?.toISOString(),
        }, base + i + 1)),
      });
      return renderOwedReplies(read, base, now, ctx.timeZone ?? DEFAULT_TIME_ZONE);
    },
    {
      name: 'mail_owed_replies',
      description: [
        'The email threads waiting on the mailbox owner for a reply — who, what they asked, since when — read from thread state worked out at sync (who wrote last, and what the last message asks). ONE call answers "what emails do I need to answer", "who am I behind on", "any replies owed to <person>"; do not search for phrases instead.',
        'Filter by category (e.g. ["sales"] for "sales emails"), person (a name, address or domain), and since (ISO date; default the last 30 days). state defaults to needs_my_reply; waiting_on_them lists threads where the owner wrote last.',
        'Set live: true only when the person asks about right now, today or the latest mail: it also reads Gmail for mail newer than the last sync. Otherwise the synced index answers, and the output says when it was synced.',
      ].join(' '),
      schema: z.object({
        category: z.array(z.enum(THREAD_CATEGORIES)).optional().describe('Only these kinds of thread, e.g. ["sales"] or ["sales", "customer"].'),
        person: z.string().optional().describe('Only threads with this person, address or domain.'),
        since: z.string().optional().describe('Only threads the other side wrote in at or after this ISO date. Default: 30 days ago.'),
        state: z.array(z.enum(REPLY_STATES)).optional().describe('Default ["needs_my_reply"].'),
        live: z.boolean().optional().describe('Also read mail newer than the last sync, live. Only for "right now" / "today" / "latest".'),
      }),
    },
  );
}
