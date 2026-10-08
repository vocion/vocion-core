/**
 * The meetings family's reads — the connected meeting recorders (Gong,
 * Fireflies, Google Meet today; `services/meetings/provider.ts`).
 *
 * `search_knowledge` finds what was said across every synced call, as
 * snippets. These two answer the questions it cannot: which calls happened
 * around a day, and one call's whole transcript. The read answers from the
 * synced copy when the index already holds the transcript (no vendor quota
 * spent — Fireflies' free plan allows fifty requests a day) and reads live
 * otherwise.
 *
 * Present for any agent whose `connectorSources` include a meeting source
 * (`familyInScope`). Read-only: the family has no actions, because no
 * recorder offers a write that is both useful and reversible.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { MeetingProvider, MeetingSummary } from '@/services/meetings/provider';
import { tool } from '@langchain/core/tools';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { familyInScope, familySourcesForOrg, familySourceSlugs } from '@/libs/connectors/families';
import { db } from '@/libs/DB';
import { dayKey, DEFAULT_TIME_ZONE } from '@/libs/time/zone';
import { knowledgeDocumentSchema } from '@/models/Schema';
import { renderMeeting, TRANSCRIPT_MAX_CHARS } from '@/services/meetings/provider';
import { reassembleDocument } from './zoomTranscript';

export const MEETING_FIND_TOOL = 'meeting_find_recordings';
export const MEETING_READ_TOOL = 'meeting_read_transcript';

export function meetingTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'meetings')) {
    return [];
  }
  return [findTool(ctx), readTool(ctx)];
}

function failed(err: unknown): string {
  return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
}

/**
 * `YYYY-MM-DD` shifted by whole days.
 * @param key - The day.
 * @param n - Days to add.
 */
function shiftDay(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(v => Number.parseInt(v, 10)) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function findTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const slugs = familySourceSlugs(ctx, 'meetings');
        const chosen = args.source ? slugs.filter(s => s === args.source) : slugs;
        if (args.source && chosen.length === 0) {
          return failed(new Error(`${args.source} is not one of this agent's meeting sources (${slugs.join(', ')}).`));
        }
        const tz = ctx.timeZone ?? DEFAULT_TIME_ZONE;
        const centre = args.day ?? dayKey(new Date(), tz);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(centre)) {
          return failed(new Error(`${centre} is not a day (YYYY-MM-DD).`));
        }
        const span = Math.min(Math.max(args.days_around ?? 1, 0), 30);
        const from = new Date(`${shiftDay(centre, -span)}T00:00:00Z`);
        const to = new Date(`${shiftDay(centre, span + 1)}T00:00:00Z`);
        const { meetingProvidersFor } = await import('@/services/meetings/provider');
        const providers = await meetingProvidersFor(ctx.orgId, chosen);
        const found: Array<MeetingSummary & { source: string; recorder: string }> = [];
        const errors: string[] = [];
        for (const provider of providers) {
          try {
            const meetings = await provider.findMeetings({ from, to, limit: 50 });
            found.push(...meetings.map(m => ({ ...m, source: provider.sourceSlug, recorder: provider.kind })));
          } catch (err) {
            errors.push(`${provider.sourceSlug}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        const who = (args.participant ?? '').trim().toLowerCase();
        const matched = who ? found.filter(m => m.participants.some(p => p.toLowerCase().includes(who))) : found;
        matched.sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''));
        return JSON.stringify({
          ok: errors.length === 0 || matched.length > 0,
          window: { from: from.toISOString(), to: to.toISOString(), timeZone: tz },
          count: matched.length,
          meetings: matched.slice(0, 50),
          ...(errors.length > 0 ? { errors } : {}),
          note: matched.length === 0
            ? 'No recorded meeting in that window on the connected recorders. That is their answer for the window: widen days_around or check the day before saying a call was not recorded.'
            : 'Read one whole with meeting_read_transcript (its id and source).',
        });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: MEETING_FIND_TOOL,
      description: 'List the recorded meetings and calls around a day on the connected meeting recorders (Gong, Fireflies, Google Meet): title, start, duration, participants, link, whether a transcript is ready, and the id and source meeting_read_transcript takes. Use it BEFORE saying a call was not recorded; a calendar title rarely matches the recorder\'s exactly, so read the titles and participants and pick.',
      schema: z.object({
        day: z.string().max(10).optional().describe('The day, YYYY-MM-DD, in the person\'s zone. Omit for today.'),
        days_around: z.number().int().min(0).max(30).optional().describe('Also look this many days either side (default 1).'),
        participant: z.string().max(200).optional().describe('Only meetings with this person: part of a name or an email.'),
        source: z.string().max(80).optional().describe('Only this meeting source, when the workspace has several.'),
      }),
    },
  );
}

/**
 * The synced copy of a meeting, when the index already holds its transcript.
 * @param ctx - The turn.
 * @param provider - The provider whose externalId the copy carries.
 * @param id - The meeting id.
 */
async function fromIndex(ctx: RuntimeContext, provider: MeetingProvider, id: string): Promise<{ title: string | null; text: string } | null> {
  const sources = await familySourcesForOrg(ctx.orgId, 'meetings', [provider.sourceSlug]);
  if (sources.length === 0) {
    return null;
  }
  const [doc] = await db
    .select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, ctx.orgId),
      inArray(knowledgeDocumentSchema.sourceId, sources.map(s => s.id)),
      eq(knowledgeDocumentSchema.externalId, provider.externalId(id)),
    ))
    .limit(1);
  if (!doc || (doc.metadata as Record<string, unknown> | null)?.hasTranscript !== true) {
    return null;
  }
  return { title: doc.title ?? null, text: await reassembleDocument(ctx.orgId, doc.id) };
}

function cut(text: string): string {
  return text.length > TRANSCRIPT_MAX_CHARS ? `${text.slice(0, TRANSCRIPT_MAX_CHARS)}\n\n[Cut at ${TRANSCRIPT_MAX_CHARS} of ${text.length} characters.]` : text;
}

function readTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const slugs = familySourceSlugs(ctx, 'meetings');
        if (args.source && !slugs.includes(args.source)) {
          return failed(new Error(`${args.source} is not one of this agent's meeting sources (${slugs.join(', ')}).`));
        }
        const { meetingProviderFor } = await import('@/services/meetings/provider');
        const provider = await meetingProviderFor(ctx.orgId, { sourceSlug: args.source ?? (slugs.length === 1 ? slugs[0] : null) });
        if (!args.force_refresh) {
          const cached = await fromIndex(ctx, provider, args.id);
          if (cached) {
            return JSON.stringify({ ok: true, from: 'index', recorder: provider.kind, source: provider.sourceSlug, id: args.id, title: cached.title, text: cut(cached.text) });
          }
        }
        const meeting = await provider.readTranscript(args.id);
        if (!meeting) {
          return failed(new Error(`The ${provider.kind} source ${provider.sourceSlug} has no meeting ${args.id}. Find it with meeting_find_recordings.`));
        }
        return JSON.stringify({
          ok: true,
          from: 'live',
          recorder: provider.kind,
          source: provider.sourceSlug,
          id: meeting.id,
          title: meeting.title,
          url: meeting.url,
          hasTranscript: meeting.hasTranscript,
          text: cut(renderMeeting({ ...meeting, vendor: provider.kind })),
          ...(meeting.hasTranscript ? {} : { note: 'The recorder has no transcript for this meeting yet (it may still be processing). Say so; do not reconstruct what was said.' }),
        });
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: MEETING_READ_TOOL,
      description: 'One recorded meeting whole: who was on it, the recorder\'s summary, and the verbatim transcript, turn by turn. Answers from the synced copy when the index holds it (from: "index"), otherwise reads the recorder live (from: "live"). Use it when the work needs what was actually said on a specific call, not search snippets.',
      schema: z.object({
        id: z.string().min(1).max(200).describe('The meeting id, from meeting_find_recordings.'),
        source: z.string().max(80).optional().describe('The meeting source it came from, when the workspace has several.'),
        force_refresh: z.boolean().optional().describe('Read the recorder live even when the index holds a copy.'),
      }),
    },
  );
}
