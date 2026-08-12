/**
 * Granola connector — ingest meeting notes (AI summary + transcript) from
 * the Granola personal API as retrievable documents.
 *
 * Auth: API key (`grn_…`) minted in the Granola desktop app under
 * Settings → Connectors → API keys; Bearer scheme. Business+ plans.
 *
 * The list endpoint is newest-first with cursor pagination; only notes
 * with a generated summary + transcript appear. Incremental: stop paging
 * once created_at falls behind the window, and skip notes not updated
 * since the watermark. Rate limit is 5 req/s sustained — detail fetches
 * are paced.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

const granolaConfigSchema = z.object({
  /** How far back to index notes. */
  pastDays: z.number().int().positive().default(60),
  baseUrl: z.string().url().default('https://public-api.granola.ai/v1'),
});

type GranolaListNote = {
  id: string;
  title?: string;
  owner?: { name?: string; email?: string };
  created_at?: string;
  updated_at?: string;
};

type GranolaList = { notes?: GranolaListNote[]; hasMore?: boolean; cursor?: string };

type GranolaNote = GranolaListNote & {
  web_url?: string;
  summary_markdown?: string;
  summary_text?: string;
  attendees?: Array<{ name?: string; email?: string }>;
  calendar_event?: {
    event_title?: string;
    organiser?: string;
    scheduled_start_time?: string;
    scheduled_end_time?: string;
  };
  transcript?: Array<{ text?: string; speaker?: { source?: string } }>;
};

/**
 * Flatten transcript segments into "Me:/Them:" turns. Granola tags each
 * segment's speaker as `microphone` (the note owner) or `speaker`
 * (everyone else) — names aren't attached per segment.
 * @param segments
 */
function flattenTranscript(segments: NonNullable<GranolaNote['transcript']>): string {
  const lines: string[] = [];
  let currentSpeaker = '';
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      lines.push(`${currentSpeaker}: ${buffer.join(' ')}`);
      buffer = [];
    }
  };
  for (const seg of segments) {
    const who = seg.speaker?.source === 'microphone' ? 'Me' : 'Them';
    if (who !== currentSpeaker) {
      flush();
      currentSpeaker = who;
    }
    if (seg.text) {
      buffer.push(seg.text.trim());
    }
  }
  flush();
  return lines.join('\n');
}

export const granolaConnector: SourceConnector<typeof granolaConfigSchema> = {
  slug: 'granola',
  name: 'Granola',
  description: 'Ingest Granola meeting notes — AI summary + transcript per meeting (personal API).',
  icon: 'NotebookPen',
  authKind: 'apikey',
  configSchema: granolaConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = granolaConfigSchema.parse(ctx.config);
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('Granola credentials missing — store the grn_… API key as { token } (Granola app → Settings → Connectors → API keys).');
    }
    const headers = { authorization: `Bearer ${token}` };
    const windowStart = Date.now() - cfg.pastDays * 86_400_000;

    let cursor: string | undefined;
    let pastWindow = false;
    do {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) {
        params.set('cursor', cursor);
      }
      const res = await fetch(`${cfg.baseUrl}/notes?${params.toString()}`, { headers });
      if (!res.ok) {
        throw new Error(`Granola list failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const list = (await res.json()) as GranolaList;

      for (const item of list.notes ?? []) {
        const createdAt = item.created_at ? Date.parse(item.created_at) : Number.NaN;
        const updatedAt = item.updated_at ? Date.parse(item.updated_at) : createdAt;
        // Newest-first list: once we're past the window, every later page is too.
        if (!Number.isNaN(createdAt) && createdAt < windowStart) {
          pastWindow = true;
          break;
        }
        // Incremental: skip notes untouched since the watermark.
        if (ctx.since && !Number.isNaN(updatedAt) && updatedAt < ctx.since.getTime()) {
          ctx.onProgress?.({ kind: 'skipped', uri: item.id });
          continue;
        }

        await sleep(250); // 5 req/s sustained limit — stay well under it.
        const dRes = await fetch(`${cfg.baseUrl}/notes/${encodeURIComponent(item.id)}?include=transcript`, { headers });
        if (!dRes.ok) {
          ctx.onProgress?.({ kind: 'error', uri: item.id, message: `note ${item.id}: ${dRes.status}` });
          continue;
        }
        const note = (await dRes.json()) as GranolaNote;
        const attendees = (note.attendees ?? []).map(a => a.name ?? a.email ?? 'unknown').join(', ');
        const when = note.calendar_event?.scheduled_start_time ?? note.created_at ?? '';
        const transcript = note.transcript?.length ? flattenTranscript(note.transcript) : '';
        ctx.onProgress?.({ kind: 'fetched', uri: note.id });
        yield {
          externalId: `granola:${note.id}`,
          title: `${note.title ?? '(untitled meeting)'}${when ? ` — ${when}` : ''}`,
          content: [
            `Meeting: ${note.title ?? '(untitled)'}`,
            `When: ${when || 'unknown'}`,
            attendees ? `Attendees: ${attendees}` : '',
            note.owner?.email ? `Note owner: ${note.owner.email}` : '',
            note.web_url ? `Granola: ${note.web_url}` : '',
            note.summary_markdown ? `\nSummary:\n${note.summary_markdown}` : (note.summary_text ? `\nSummary:\n${note.summary_text}` : ''),
            transcript ? `\nTranscript:\n${transcript}` : '',
          ].filter(Boolean).join('\n'),
          lastModifiedAt: note.updated_at ? new Date(note.updated_at) : null,
          metadata: {
            kind: 'granola-note',
            owner: note.owner?.email ?? null,
            when: when || null,
            attendees: (note.attendees ?? []).map(a => a.email).filter(Boolean),
            webUrl: note.web_url ?? null,
            hasTranscript: !!transcript,
          },
        };
      }

      cursor = !pastWindow && list.hasMore ? list.cursor : undefined;
    } while (cursor);
  },
};
