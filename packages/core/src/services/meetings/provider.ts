/**
 * THE MEETINGS FAMILY — a meeting recorder as an agent sees it.
 *
 * Gong, Fireflies and Google Meet each keep the same thing: a call that was
 * recorded, who was on it, and what was said — a transcript, and often a
 * summary the recorder wrote. So the agent's tools are named for that
 * (`meeting_find_recordings`, `meeting_read_transcript`) and this interface is
 * what each provider fills in. The source a workspace connected decides
 * which recorder answers; an agent never names a vendor.
 *
 * Each provider renders a meeting with the same function its sync uses, so a
 * transcript read live and one read from the index say the same thing, and
 * the read tool can answer from the synced copy (`externalId`) without
 * spending the vendor's quota.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { familySourcesForOrg } from '@/libs/connectors/families';

/** One recorded meeting, as a list shows it. */
export type MeetingSummary = {
  /** The vendor's id for the meeting. */
  id: string;
  title: string;
  /** When it started, ISO. */
  started: string | null;
  durationMinutes: number | null;
  /** Who was on it, by name or email. */
  participants: string[];
  /** The meeting on the vendor's own site. */
  url: string | null;
  /** Whether a transcript is ready to read. */
  hasTranscript: boolean;
};

/** One meeting read whole. */
export type MeetingTranscript = MeetingSummary & {
  /** The recorder's own summary, when it wrote one. */
  summary: string | null;
  /** What was said, one turn per line: `Name: words`. Empty when there is none. */
  transcript: string;
};

export type MeetingProvider = {
  /** The connector kind behind this provider (`gong`). */
  kind: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** Meetings that started inside the window, newest first. */
  findMeetings: (input: { from: Date; to: Date; limit: number }) => Promise<MeetingSummary[]>;
  /** One meeting whole, or null when the recorder has no meeting by that id. */
  readTranscript: (id: string) => Promise<MeetingTranscript | null>;
  /** The id this meeting's synced document carries (`gong:<id>`), so a read can come from the index. */
  externalId: (id: string) => string;
};

/**
 * The provider for one meeting source, or the workspace's only one.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source slug, when the caller knows the source.
 */
export async function meetingProviderFor(orgId: string, opts: { sourceSlug?: string | null } = {}): Promise<MeetingProvider> {
  const sources = await familySourcesForOrg(orgId, 'meetings');
  if (sources.length === 0) {
    throw new Error('This workspace has no meeting recorder connected. Connect one (Gong, Fireflies or Google Meet) at /dashboard/connectors and give this agent the source.');
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No meeting source named ${opts.sourceSlug}. Connected: ${describe(sources)}.`);
    }
  } else {
    if (sources.length > 1) {
      throw new Error(`This workspace has ${sources.length} meeting sources; name one (source). Connected: ${describe(sources)}.`);
    }
    chosen = sources[0]!;
  }
  return providerFor(orgId, chosen);
}

/**
 * Every meeting provider the workspace has, for a listing across all of them.
 * @param orgId - The workspace.
 * @param slugs - Only these sources, when the caller is scoped to an agent's.
 */
export async function meetingProvidersFor(orgId: string, slugs?: readonly string[]): Promise<MeetingProvider[]> {
  const sources = await familySourcesForOrg(orgId, 'meetings', slugs);
  return Promise.all(sources.map(s => providerFor(orgId, s)));
}

async function providerFor(orgId: string, source: FamilySource): Promise<MeetingProvider> {
  switch (source.kind) {
    case 'gong':
      return (await import('./providers/gong')).gongMeetingProvider(orgId, source);
    case 'fireflies':
      return (await import('./providers/fireflies')).firefliesMeetingProvider(orgId, source);
    case 'google-meet':
      return (await import('./providers/googleMeet')).googleMeetMeetingProvider(orgId, source);
    default:
      throw new Error(`${source.slug} is a ${source.kind} source, which no meeting provider serves yet.`);
  }
}

function describe(sources: FamilySource[]): string {
  return sources.map(s => `${s.slug} (${s.kind})`).join('; ');
}

/** Transcripts land after a call ends, so an incremental run looks this far behind its watermark. */
export const MEETING_LOOKBACK_MS = 3 * 86_400_000;

/**
 * The window a sync reads: the full window, or the watermark less the lookback.
 * @param ctx - The run.
 * @param ctx.since - Its incremental watermark, when it has one.
 * @param pastDays - The full-sync window.
 * @param now - Injected for tests.
 */
export function meetingSyncWindow(ctx: { since?: Date | null }, pastDays: number, now: number = Date.now()): { from: Date; to: Date } {
  const from = ctx.since ? new Date(ctx.since.getTime() - MEETING_LOOKBACK_MS) : new Date(now - pastDays * 86_400_000);
  return { from, to: new Date(now) };
}

/** The longest transcript a tool hands a model in one answer. */
export const TRANSCRIPT_MAX_CHARS = 100_000;

/**
 * A meeting as one document's text — what the sync stores and the read tool
 * returns, so both say the same thing. Every meeting provider renders through
 * this one shape.
 * @param m - The meeting.
 * @param m.vendor - The recorder's name, for the link line.
 */
export function renderMeeting(m: MeetingTranscript & { vendor: string }): string {
  return [
    `Meeting: ${m.title}`,
    `When: ${m.started ?? 'unknown'}${m.durationMinutes ? ` (${Math.round(m.durationMinutes)} min)` : ''}`,
    m.participants.length > 0 ? `Participants: ${m.participants.join(', ')}` : '',
    m.url ? `${m.vendor}: ${m.url}` : '',
    m.summary ? `\nSummary:\n${m.summary}` : '',
    m.transcript ? `\nTranscript:\n${m.transcript}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Consecutive lines by one speaker folded into one turn, `Name: words`.
 * @param segments - Each spoken segment, in order.
 */
export function foldTurns(segments: Array<{ speaker: string; text: string }>): string {
  const lines: string[] = [];
  let speaker = '';
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      lines.push(`${speaker}: ${buffer.join(' ')}`);
      buffer = [];
    }
  };
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) {
      continue;
    }
    if (seg.speaker !== speaker) {
      flush();
      speaker = seg.speaker;
    }
    buffer.push(text);
  }
  flush();
  return lines.join('\n');
}
