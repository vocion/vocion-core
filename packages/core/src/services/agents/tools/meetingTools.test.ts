/**
 * The meetings family's reads: present only for an agent with a meeting
 * source, the listing spans every recorder the agent reaches (one failing
 * recorder does not hide the others), and a read answers from the synced copy
 * when the index holds the transcript and live otherwise. Providers and the
 * index are mocked; the meetings are invented.
 */
import type { RuntimeContext } from '../types';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gong = vi.hoisted(() => ({
  kind: 'gong',
  sourceSlug: 'gong',
  findMeetings: vi.fn(async () => [{ id: '7001', title: 'Kestrel discovery', started: '2026-10-07T15:00:00Z', durationMinutes: 30, participants: ['ari@kestrel.example'], url: null, hasTranscript: true }]),
  readTranscript: vi.fn(async (id: string) => ({ id, title: 'Kestrel discovery', started: '2026-10-07T15:00:00Z', durationMinutes: 30, participants: ['Ari Moss'], url: 'https://app.gong.example/call?id=7001', hasTranscript: true, summary: 'Wants a pilot.', transcript: 'Ari Moss: We want a pilot.' })),
  externalId: (id: string) => `gong:${id}`,
}));
const fireflies = vi.hoisted(() => ({
  kind: 'fireflies',
  sourceSlug: 'fireflies',
  findMeetings: vi.fn(async () => {
    throw new Error('Fireflies is rate limiting this workspace\'s credential. Try again in a minute.');
  }),
  readTranscript: vi.fn(async () => null),
  externalId: (id: string) => `fireflies:${id}`,
}));
const index = vi.hoisted(() => ({ doc: null as null | { id: number; title: string; metadata: Record<string, unknown> } }));

vi.mock('@/services/meetings/provider', async importOriginal => ({
  ...(await importOriginal<object>()),
  meetingProvidersFor: async (_org: string, slugs?: readonly string[]) => [gong, fireflies].filter(p => !slugs || slugs.includes(p.sourceSlug)),
  meetingProviderFor: async (_org: string, opts: { sourceSlug?: string | null }) => (opts.sourceSlug === 'fireflies' ? fireflies : gong),
}));
vi.mock('@/libs/connectors/families', async importOriginal => ({
  ...(await importOriginal<object>()),
  familySourcesForOrg: async () => [{ id: 3, slug: 'gong', kind: 'gong', config: {}, apiTokenId: null }],
}));
vi.mock('@/libs/DB', () => {
  const chain = { select: () => chain, from: () => chain, where: () => chain, limit: async () => (index.doc ? [index.doc] : []) };
  return { db: chain };
});
vi.mock('./zoomTranscript', () => ({ reassembleDocument: async () => 'Meeting: Kestrel discovery\n\nTranscript:\nAri Moss: We want a pilot.' }));

const { meetingTools } = await import('./meetingTools');

type Invokable = { name: string; schema: unknown; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'account-manager', connectorSources: sources, sourceKinds: kinds, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, timeZone: 'UTC', emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

function byName(ctx: RuntimeContext): Map<string, Invokable> {
  return new Map((meetingTools(ctx) as unknown as Invokable[]).map(t => [t.name, t]));
}

beforeEach(() => {
  index.doc = null;
});

describe('the meetings family reads', () => {
  it('exist only for an agent whose sources include a meeting recorder, by kind', () => {
    expect(meetingTools(ctxFor(['zoom', 'salesforce']))).toHaveLength(0);
    expect([...byName(ctxFor(['gong'])).keys()]).toEqual(['meeting_find_recordings', 'meeting_read_transcript']);
    expect(meetingTools(ctxFor(['calls'], { calls: 'google-meet' }))).toHaveLength(2);

    for (const t of byName(ctxFor(['gong'])).values()) {
      expect(() => toJsonSchema(t.schema as never), t.name).not.toThrow();
    }
  });

  it('lists across every recorder the agent reaches, and says which one failed', async () => {
    const out = JSON.parse(await byName(ctxFor(['gong', 'fireflies'])).get('meeting_find_recordings')!.invoke({ day: '2026-10-07', days_around: 1 }));

    expect(out.ok).toBe(true);
    expect(out.window).toEqual({ from: '2026-10-06T00:00:00.000Z', to: '2026-10-09T00:00:00.000Z', timeZone: 'UTC' });
    expect(out.meetings).toMatchObject([{ id: '7001', source: 'gong', recorder: 'gong' }]);
    expect(out.errors).toEqual(['fireflies: Fireflies is rate limiting this workspace\'s credential. Try again in a minute.']);
  });

  it('narrows to a participant', async () => {
    const out = JSON.parse(await byName(ctxFor(['gong'])).get('meeting_find_recordings')!.invoke({ day: '2026-10-07', participant: 'nobody@contoso.example' }));

    expect(out.count).toBe(0);
    expect(out.note).toMatch(/widen days_around/);
  });

  it('reads a transcript from the index when the synced copy has it, spending no vendor request', async () => {
    index.doc = { id: 41, title: 'Kestrel discovery', metadata: { hasTranscript: true } };
    const out = JSON.parse(await byName(ctxFor(['gong'])).get('meeting_read_transcript')!.invoke({ id: '7001' }));

    expect(out).toMatchObject({ ok: true, from: 'index', recorder: 'gong', title: 'Kestrel discovery' });
    expect(out.text).toContain('We want a pilot.');
    expect(gong.readTranscript).not.toHaveBeenCalled();
  });

  it('reads live when the index has no transcript, rendered the way the sync stores it', async () => {
    const out = JSON.parse(await byName(ctxFor(['gong'])).get('meeting_read_transcript')!.invoke({ id: '7001' }));

    expect(out).toMatchObject({ ok: true, from: 'live', hasTranscript: true });
    expect(out.text).toBe('Meeting: Kestrel discovery\nWhen: 2026-10-07T15:00:00Z (30 min)\nParticipants: Ari Moss\ngong: https://app.gong.example/call?id=7001\n\nSummary:\nWants a pilot.\n\nTranscript:\nAri Moss: We want a pilot.');
  });

  it('says when the recorder has no such meeting', async () => {
    const out = JSON.parse(await byName(ctxFor(['gong', 'fireflies'])).get('meeting_read_transcript')!.invoke({ id: 'ff-1', source: 'fireflies' }));

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/has no meeting ff-1/);
  });
});
