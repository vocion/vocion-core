/**
 * A brief read aloud, against PGlite with the voice mocked: made once on
 * first ask and kept, linked to the brief with its duration and cost, charged
 * to the brief budget, spoken again when the brief is refreshed, healed when
 * the chosen voice is not on the account — and silent, with no error, when no
 * voice is connected or the person turned listening off. Then the ways out
 * that need no sign-in: the private podcast feed and a text's MP3.
 */
import type { VoiceProvider } from '@/libs/voice/provider';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'audio-test-secret';
  return { session: { userId: null as string | null, orgId: null as string | null } };
});

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: async () => ({ ...env.session, accountId: null, projectId: env.session.orgId, role: 'member', workspaceRole: null, has: () => false }) }));

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, briefingSchema, personalRhythmSchema, podcastFeedSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { audioPlan, ensureBriefAudio, readBriefAudio } = await import('./audio');
const { createPodcastFeed, podcastXml, readPodcastFeed, revokePodcastFeed } = await import('./podcast');
const { clipPath, readClipToken } = await import('@/libs/briefings/listenLink');
const { voiceProviderForAccount } = await import('@/services/voice/provider');
const listenRoute = await import('@/app/api/listen/[...path]/route');
const audioRoute = await import('@/app/api/briefings/[id]/audio/route');

const ACCOUNT = 'acct-audio-northwind';
const ALEX = 'usr-audio-alex';
const REVENUE = 'proj-audio-revenue';
const NOW = new Date('2026-10-09T14:31:00Z');
const MP3 = Buffer.alloc(64_000, 0xFF); // 8 seconds at 64 kbps
const SCRIPT = 'Good morning, Alex. Two things need you first: the Contoso Supply quote, and the Bellwater Hall date. That is your day.';

let dir: string;
let home: { id: string };
let briefId: number;
let teamBriefId: number;

function fakeVoice(over: Partial<VoiceProvider> = {}): VoiceProvider & { speak: ReturnType<typeof vi.fn> } {
  return {
    connector: 'elevenlabs',
    label: 'ElevenLabs',
    defaultVoice: { id: 'voice_default_01', name: 'Brian' },
    scriptModel: 'eleven_multilingual_v2',
    listVoices: async () => ({ ok: true, voices: [{ id: 'voice_aria_01', name: 'Aria' }] }),
    speak: vi.fn(async (input: { text: string }) => ({ ok: true as const, audio: MP3, contentType: 'audio/mpeg' as const, characters: input.text.length, durationMs: 8_000 })),
    ...over,
  } as VoiceProvider & { speak: ReturnType<typeof vi.fn> };
}

const deps = (voice: VoiceProvider | null) => ({ voice, script: async () => SCRIPT, dir: path.join(dir, 'media'), bucket: null, now: NOW });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'brief-audio-'));
  process.env.VOCION_ARTIFACTS_DIR = dir;
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-audio' });
  await db.insert(userSchema).values({ id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' });
  await db.insert(projectSchema).values({ id: REVENUE, accountId: ACCOUNT, slug: 'revenue-audio', name: 'Revenue Team' });
  home = await ensurePersonalProject(ALEX, ACCOUNT);
});

beforeEach(async () => {
  await db.delete(agentBudgetSchema);
  await db.delete(personalRhythmSchema);
  await db.delete(podcastFeedSchema);
  await db.delete(briefingSchema);
  await db.update(tenantAccountSchema).set({ briefAudio: true, briefVoiceId: null }).where(eq(tenantAccountSchema.id, ACCOUNT));
  [{ id: briefId }] = await db.insert(briefingSchema).values({ orgId: home.id, title: 'Your day — Fri, Oct 9', content: '**Good morning.** [Send the Contoso Supply quote?](/w/revenue/dashboard/inbox)', publishedBy: 'job:personal-brief', edition: 'brief:2026-10-09' }).returning({ id: briefingSchema.id }) as [{ id: number }];
  [{ id: teamBriefId }] = await db.insert(briefingSchema).values({ orgId: REVENUE, title: 'Revenue Team — Fri, Oct 9', content: 'Pipeline moved.' }).returning({ id: briefingSchema.id }) as [{ id: number }];
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('no voice, no audio, no error', () => {
  it('a brief in an Org with no voice connected and no server key is quietly off', async () => {
    const state = await ensureBriefAudio({ orgId: home.id, briefingId: briefId }, { ...deps(null) });

    expect(state).toEqual({ status: 'off', reason: 'No voice is connected for this Org.' });

    const [row] = await db.select({ audio: briefingSchema.audio }).from(briefingSchema).where(eq(briefingSchema.id, briefId));

    expect(row!.audio).toBeNull();
  });

  it('the Org lookup finds none without a credential or ELEVENLABS_API_KEY', async () => {
    await expect(voiceProviderForAccount(home.id, ACCOUNT, { credentialFor: async () => null, env: {} })).resolves.toBeNull();
  });

  it('a team workspace\'s voice speaks for a person\'s brief; the server key is last', async () => {
    const found = await voiceProviderForAccount(home.id, ACCOUNT, {
      workspacesOf: async () => [home.id, REVENUE],
      credentialFor: async orgId => (orgId === REVENUE ? { apiKey: 'sk_fixture_team_key_0001' } : null),
      env: {},
    });

    expect(found?.connector).toBe('elevenlabs');

    const fromEnv = await voiceProviderForAccount(home.id, ACCOUNT, { workspacesOf: async () => [], credentialFor: async () => null, env: { ELEVENLABS_API_KEY: 'sk_fixture_server_key_01' } });

    expect(fromEnv?.defaultVoice.name).toBe('Brian');
  });

  it('a person who turned listening off gets none', async () => {
    await db.insert(personalRhythmSchema).values({ userId: ALEX, accountId: ACCOUNT, listenOn: false });

    await expect(ensureBriefAudio({ orgId: home.id, briefingId: briefId }, deps(fakeVoice()))).resolves.toMatchObject({ status: 'off', reason: expect.stringMatching(/off/) });
  });

  it('a workspace brief is off when the Org turned workspace audio off', async () => {
    await db.update(tenantAccountSchema).set({ briefAudio: false }).where(eq(tenantAccountSchema.id, ACCOUNT));

    await expect(ensureBriefAudio({ orgId: REVENUE, briefingId: teamBriefId }, deps(fakeVoice()))).resolves.toMatchObject({ status: 'off' });
  });
});

describe('made once, kept, linked to the brief', () => {
  it('speaks the script in the default voice, keeps the MP3 and records duration and cost', async () => {
    const voice = fakeVoice();
    const state = await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(voice));

    expect(state).toMatchObject({ status: 'ready', durationMs: 8_000, speed: 1, title: 'Your day — Fri, Oct 9' });
    expect(voice.speak).toHaveBeenCalledWith({ voiceId: 'voice_default_01', text: SCRIPT, form: 'script', modelId: 'eleven_multilingual_v2' });

    const [row] = await db.select({ audio: briefingSchema.audio }).from(briefingSchema).where(eq(briefingSchema.id, briefId));

    expect(row!.audio).toMatchObject({ status: 'ready', script: SCRIPT, bytes: MP3.byteLength, durationMs: 8_000, characters: SCRIPT.length, voice: { id: 'voice_default_01', name: 'Brian' } });
    // $0.20 per 1,000 characters.
    expect(row!.audio!.status === 'ready' && row!.audio!.costMicroCents).toBe(SCRIPT.length * 20_000);

    const [charged] = await db.select().from(agentBudgetSchema).where(and(eq(agentBudgetSchema.orgId, home.id), eq(agentBudgetSchema.agentSlug, 'platform:brief.audio')));

    expect(Number(charged!.currentMicroCents)).toBe(SCRIPT.length * 20_000);
  });

  it('a second view plays the kept file: the voice is not asked again', async () => {
    const voice = fakeVoice();
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(voice));
    const again = await ensureBriefAudio({ orgId: home.id, briefingId: briefId }, deps(voice));

    expect(again.status).toBe('ready');
    expect(voice.speak).toHaveBeenCalledTimes(1);
  });

  it('a first view without waiting says it is on its way, then it is ready', async () => {
    const voice = fakeVoice();
    const first = await ensureBriefAudio({ orgId: home.id, briefingId: briefId }, deps(voice));

    expect(first).toEqual({ status: 'pending' });

    await vi.waitFor(async () => {
      expect((await ensureBriefAudio({ orgId: home.id, briefingId: briefId }, deps(voice))).status).toBe('ready');
    });

    expect(voice.speak).toHaveBeenCalledTimes(1);
  });

  it('a brief refreshed in place is spoken again', async () => {
    const voice = fakeVoice();
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(voice));
    await db.update(briefingSchema).set({ content: 'Everything moved.' }).where(eq(briefingSchema.id, briefId));
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(voice));

    expect(voice.speak).toHaveBeenCalledTimes(2);
  });

  it('the person\'s own voice and speed win; a voice the account lacks heals to its first', async () => {
    await db.insert(personalRhythmSchema).values({ userId: ALEX, accountId: ACCOUNT, voiceId: 'voice_gone_99', listenSpeed: 1.5 });
    const voice = fakeVoice({
      speak: vi.fn(async (input: { voiceId: string; text: string }) => (input.voiceId === 'voice_gone_99'
        ? { ok: false as const, reason: 'voice not found', badVoice: true }
        : { ok: true as const, audio: MP3, contentType: 'audio/mpeg' as const, characters: input.text.length, durationMs: 8_000 })),
    });
    const state = await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(voice));

    expect(state).toMatchObject({ status: 'ready', speed: 1.5 });

    const [row] = await db.select({ audio: briefingSchema.audio }).from(briefingSchema).where(eq(briefingSchema.id, briefId));

    expect(row!.audio).toMatchObject({ voice: { id: 'voice_aria_01', name: 'Aria' } });
  });

  it('a voice that refuses is said, kept as failed, and not retried on every view', async () => {
    const voice = fakeVoice({ speak: vi.fn(async () => ({ ok: false as const, reason: 'The ElevenLabs account has no characters left this period.' })) });
    const state = await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(voice));

    expect(state).toEqual({ status: 'failed', reason: 'The ElevenLabs account has no characters left this period.' });

    await ensureBriefAudio({ orgId: home.id, briefingId: briefId }, deps(voice));

    expect(voice.speak).toHaveBeenCalledTimes(1);
  });

  it('the brief budget can pause it', async () => {
    const state = await ensureBriefAudio({ orgId: home.id, briefingId: briefId }, { ...deps(fakeVoice()), budget: async () => ({ ok: false as const, why: 'the Org\'s daily brief budget (1.00 USD) is spent' }) });

    expect(state).toEqual({ status: 'off', reason: 'Audio is paused: the Org\'s daily brief budget (1.00 USD) is spent.' });
  });

  it('a workspace brief speaks in the Org\'s voice to no one in particular', async () => {
    await db.update(tenantAccountSchema).set({ briefVoiceId: 'voice_org_07' }).where(eq(tenantAccountSchema.id, ACCOUNT));
    const plan = await audioPlan(REVENUE, teamBriefId, { voice: fakeVoice() });

    expect(plan).toMatchObject({ on: true, voiceId: 'voice_org_07', listener: null, briefing: { kind: 'workspace' } });
  });
});

describe('heard outside the app', () => {
  it('the brief\'s own route plays it to a reader of its workspace, and to no one else', async () => {
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(fakeVoice()));
    const ctx = { params: Promise.resolve({ id: String(briefId) }) };

    env.session = { userId: ALEX, orgId: home.id };
    const ok = await audioRoute.GET(new NextRequest('http://app.example/api/briefings/1/audio', { headers: { range: 'bytes=0-99' } }), ctx);

    expect(ok.status).toBe(206);
    expect(ok.headers.get('content-type')).toBe('audio/mpeg');

    env.session = { userId: 'usr-audio-other', orgId: REVENUE };

    expect((await audioRoute.GET(new NextRequest('http://app.example/api/briefings/1/audio'), ctx)).status).toBe(404);

    env.session = { userId: null, orgId: null };

    expect((await audioRoute.GET(new NextRequest('http://app.example/api/briefings/1/audio'), ctx)).status).toBe(401);
  });

  it('a text\'s attachment is a signed, expiring link to that one MP3', async () => {
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(fakeVoice()));
    const p = clipPath({ orgId: home.id, briefingId: briefId, exp: Date.now() + 60_000 });
    const segments = p.replace('/api/listen/', '').split('/');

    const res = await listenRoute.GET(new NextRequest(`http://app.example${p}`), { params: Promise.resolve({ path: segments }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(readClipToken(segments[1]!, Date.now() + 120_000)).toBeNull();

    const forged = `${segments[1]!.split('.')[0]}.AAAA.mp3`;

    expect((await listenRoute.GET(new NextRequest('http://app.example/x'), { params: Promise.resolve({ path: ['clip', forged] }) })).status).toBe(404);
  });

  it('readBriefAudio hands a channel the bytes and a file name', async () => {
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(fakeVoice()));

    await expect(readBriefAudio(home.id, briefId)).resolves.toMatchObject({ filename: 'Your-day-Fri-Oct-9.mp3', durationMs: 8_000, title: 'Your day — Fri, Oct 9' });
    await expect(readBriefAudio(REVENUE, briefId)).resolves.toBeNull();
  });

  it('the private podcast feed lists spoken briefs, serves them, and stops when revoked', async () => {
    await ensureBriefAudio({ orgId: home.id, briefingId: briefId, wait: true }, deps(fakeVoice()));
    const { token } = await createPodcastFeed(ALEX, ACCOUNT);

    const feed = await readPodcastFeed(token);

    expect(feed?.episodes.map(e => e.id)).toEqual([briefId]);

    const xml = podcastXml(feed!, 'https://app.vocion.example', token);

    expect(xml).toContain('<itunes:block>Yes</itunes:block>');
    expect(xml).toContain(`<enclosure url="https://app.vocion.example/api/listen/feed/${token}/${briefId}.mp3" length="${MP3.byteLength}" type="audio/mpeg"/>`);
    expect(xml).toContain('<itunes:duration>8</itunes:duration>');
    expect(xml).toContain(SCRIPT);

    const rss = await listenRoute.GET(new NextRequest(`http://app.example/api/listen/feed/${token}`), { params: Promise.resolve({ path: ['feed', token] }) });

    expect(rss.headers.get('content-type')).toMatch(/rss/);

    const ep = await listenRoute.GET(new NextRequest(`http://app.example/api/listen/feed/${token}/${briefId}.mp3`), { params: Promise.resolve({ path: ['feed', token, `${briefId}.mp3`] }) });

    expect(ep.status).toBe(200);
    // Another workspace's brief is not an episode of this feed.
    expect((await listenRoute.GET(new NextRequest('http://app.example/x'), { params: Promise.resolve({ path: ['feed', token, `${teamBriefId}.mp3`] }) })).status).toBe(404);

    await revokePodcastFeed(ALEX, ACCOUNT);

    expect((await listenRoute.GET(new NextRequest('http://app.example/x'), { params: Promise.resolve({ path: ['feed', token] }) })).status).toBe(404);
  });

  it('a new feed link replaces the old one', async () => {
    const first = await createPodcastFeed(ALEX, ACCOUNT);
    const second = await createPodcastFeed(ALEX, ACCOUNT);

    await expect(readPodcastFeed(first.token)).resolves.toBeNull();
    await expect(readPodcastFeed(second.token)).resolves.not.toBeNull();
  });
});
