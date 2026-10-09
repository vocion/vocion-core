/**
 * Listen to your brief (docs/guides/listen-to-your-brief.md).
 *
 * Every brief — a person's morning brief and evening wrap, and a workspace's
 * briefs where the Org has them on — can be heard: a spoken script
 * (`script.ts`) read by the Org's voice (`services/voice/provider.ts`), kept
 * as an MP3 in the media store and linked to the brief on its own row
 * (`briefing.audio`), with its duration, the script that was said and what it
 * cost.
 *
 * Made lazily: the first time the brief is viewed (the player asks) or pushed
 * (Slack, a text, an email, the podcast feed). Kept: the row is keyed by a
 * hash of what was spoken from (the brief's words, the voice, the model), so
 * a second view plays the same file and a personal brief refreshed in place
 * is spoken again.
 *
 * One budget: the script's model call and the voice's characters charge
 * `platform:brief.audio` through the ordinary spend path, and the Org's daily
 * brief cap holds them with the briefs themselves (`budgetGate.ts`).
 *
 * Quiet when it cannot: no voice connected anywhere in the Org and no server
 * key means no audio and no error — the brief is exactly what it was. A voice
 * that refuses is said on the player, and the next view tries again.
 */

import type { ScriptModel } from './script';
import type { BriefAudio, BriefAudioState, ListenSpeed } from './types';
import type { MediaDeps } from '@/libs/tools/artifacts/media';
import type { VoiceProvider } from '@/libs/voice/provider';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { briefingSchema, personalRhythmSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { writeSpokenScript } from './script';
import { asListenSpeed } from './types';

/** A brief being made longer than this was abandoned (a restart): the next ask makes it again. */
export const PENDING_STALE_MS = 3 * 60 * 1000;
/** A brief whose audio failed is tried again on a view after this long. */
export const FAILED_RETRY_MS = 10 * 60 * 1000;
/** Bump to speak every brief again (a change to how scripts are written). */
const SCRIPT_VERSION = 'v1';

/** Who a brief speaks to, and with which voice — or why it does not. */
export type AudioPlan
  = | { on: false; reason: string }
    | {
      on: true;
      briefing: { id: number; orgId: string; title: string; content: string; audio: BriefAudio | null; kind: 'brief' | 'wrap' | 'workspace' };
      accountId: string;
      listener: string | null;
      voice: VoiceProvider;
      voiceId: string;
      speed: ListenSpeed;
      sourceHash: string;
    };

export type AudioDeps = MediaDeps & {
  /** The Org's voice; null = none. Undefined: looked up. */
  voice?: VoiceProvider | null;
  /** The script model; null = the brief's own words. */
  script?: ScriptModel | null;
  /** The budget gate (a seam for tests). */
  budget?: (input: { accountId: string; orgId: string; now: Date }) => Promise<{ ok: true } | { ok: false; why: string }>;
  now?: Date;
};

/**
 * Who a brief speaks to and how, or why it stays silent. Reads only.
 * @param orgId - The brief's workspace.
 * @param briefingId - The brief.
 * @param deps - Seams.
 */
export async function audioPlan(orgId: string, briefingId: number, deps: Pick<AudioDeps, 'voice'> = {}): Promise<AudioPlan> {
  const [row] = await db
    .select({
      id: briefingSchema.id,
      orgId: briefingSchema.orgId,
      title: briefingSchema.title,
      content: briefingSchema.content,
      audio: briefingSchema.audio,
      edition: briefingSchema.edition,
      projectKind: projectSchema.kind,
      accountId: projectSchema.accountId,
      ownerUserId: projectSchema.ownerUserId,
      briefAudio: tenantAccountSchema.briefAudio,
      orgVoiceId: tenantAccountSchema.briefVoiceId,
    })
    .from(briefingSchema)
    .innerJoin(projectSchema, eq(projectSchema.id, briefingSchema.orgId))
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
    .where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, briefingId)))
    .limit(1);
  if (!row) {
    return { on: false, reason: 'There is no such brief.' };
  }
  const personal = row.projectKind === 'personal' && row.ownerUserId;
  let listener: string | null = null;
  let personVoice: string | null = null;
  let speed: ListenSpeed = 1;
  if (personal) {
    const [r] = await db
      .select({ listenOn: personalRhythmSchema.listenOn, voiceId: personalRhythmSchema.voiceId, speed: personalRhythmSchema.listenSpeed, name: userSchema.name })
      .from(userSchema)
      .leftJoin(personalRhythmSchema, and(eq(personalRhythmSchema.userId, userSchema.id), eq(personalRhythmSchema.accountId, row.accountId)))
      .where(eq(userSchema.id, row.ownerUserId!))
      .limit(1);
    if (r?.listenOn === false) {
      return { on: false, reason: 'Listen to my briefs is off.' };
    }
    listener = r?.name?.split(' ')[0] ?? null;
    personVoice = r?.voiceId ?? null;
    speed = asListenSpeed(r?.speed);
  } else if (!row.briefAudio) {
    return { on: false, reason: 'The Org has workspace briefs read aloud turned off.' };
  }
  const voice = deps.voice !== undefined
    ? deps.voice
    : await (await import('@/services/voice/provider')).voiceProviderForAccount(orgId, row.accountId).catch(() => null);
  if (!voice) {
    return { on: false, reason: 'No voice is connected for this Org.' };
  }
  const voiceId = personVoice ?? row.orgVoiceId ?? voice.defaultVoice.id;
  const kind = row.edition?.startsWith('wrap:') ? 'wrap' : personal ? 'brief' : 'workspace';
  const sourceHash = createHash('sha256').update([SCRIPT_VERSION, voice.connector, voice.scriptModel, voiceId, row.title, row.content].join('\u0000')).digest('hex').slice(0, 24);
  return {
    on: true,
    briefing: { id: row.id, orgId: row.orgId, title: row.title, content: row.content, audio: row.audio ?? null, kind },
    accountId: row.accountId,
    listener,
    voice,
    voiceId,
    speed,
    sourceHash,
  };
}

/**
 * Where a ready brief's audio is played from in the app: the brief's own
 * route, which checks the reader may open the brief. The hash makes a
 * refreshed brief a new URL, so no cache plays yesterday's.
 * @param briefingId - The brief.
 * @param audio - Its ready audio.
 * @param audio.sourceHash - What it was spoken from.
 */
export function briefAudioSrc(briefingId: number, audio: { sourceHash: string }): string {
  return `/api/briefings/${briefingId}/audio?v=${audio.sourceHash.slice(0, 12)}`;
}

/**
 * A stored audio state, as the player is told it.
 * @param plan - The plan (on).
 * @param audio - The stored audio.
 * @param speed - The viewer's starting speed.
 */
function stateOf(plan: Extract<AudioPlan, { on: true }>, audio: BriefAudio, speed: ListenSpeed): BriefAudioState {
  if (audio.status === 'ready') {
    return { status: 'ready', src: briefAudioSrc(plan.briefing.id, audio), durationMs: audio.durationMs, speed, title: plan.briefing.title };
  }
  return audio.status === 'pending' ? { status: 'pending' } : { status: 'failed', reason: audio.reason };
}

/**
 * The default budget gate: the workspace's own caps, then the Org's daily brief cap.
 * @param input - Whose.
 * @param input.accountId - The Org.
 * @param input.orgId - The workspace that pays.
 * @param input.now - The clock.
 */
async function defaultBudget(input: { accountId: string; orgId: string; now: Date }) {
  const { briefBudget } = await import('../budgetGate');
  return briefBudget({ accountId: input.accountId, personalOrgId: input.orgId, now: input.now, feature: 'brief.audio' });
}

/**
 * Write the audio row, unless a newer source has taken it over meanwhile.
 * @param briefingId - The brief.
 * @param sourceHash - The source this audio is for.
 * @param audio - What to store.
 */
async function store(briefingId: number, sourceHash: string, audio: BriefAudio): Promise<void> {
  await db.update(briefingSchema)
    .set({ audio })
    .where(and(eq(briefingSchema.id, briefingId), sql`(${briefingSchema.audio} is null or ${briefingSchema.audio}->>'sourceHash' = ${sourceHash})`));
}

/**
 * Make the audio for a plan: script, voice, media store, charge, row. Never
 * throws; a failure is stored as a sentence and tried again later.
 * @param plan - The plan.
 * @param deps - Seams.
 */
async function make(plan: Extract<AudioPlan, { on: true }>, deps: AudioDeps): Promise<BriefAudio> {
  const { briefing, voice } = plan;
  const at = () => (deps.now ?? new Date()).toISOString();
  const fail = async (reason: string): Promise<BriefAudio> => {
    const failed: BriefAudio = { status: 'failed', sourceHash: plan.sourceHash, at: at(), reason };
    await store(briefing.id, plan.sourceHash, failed).catch(() => {});
    return failed;
  };
  try {
    const script = await writeSpokenScript(briefing.orgId, { title: briefing.title, markdown: briefing.content, listener: plan.listener, kind: briefing.kind }, { feature: 'brief.audio', ...(deps.script !== undefined ? { model: deps.script } : {}) });
    let voiceId = plan.voiceId;
    let voiceName: string | null = voiceId === voice.defaultVoice.id ? voice.defaultVoice.name : null;
    let said = await voice.speak({ voiceId, text: script.text, form: 'script', modelId: voice.scriptModel });
    if (!said.ok && said.badVoice) {
      // The chosen voice is not on this account: heal with the account's own first voice.
      const list = await voice.listVoices();
      const first = list.ok ? list.voices.find(v => v.id !== voiceId) : undefined;
      if (first) {
        voiceId = first.id;
        voiceName = first.name;
        said = await voice.speak({ voiceId, text: script.text, form: 'script', modelId: voice.scriptModel });
      }
    }
    if (!said.ok) {
      return fail(said.reason);
    }
    const { keepMedia } = await import('@/libs/tools/artifacts/media');
    const kept = await keepMedia({ orgId: briefing.orgId, recordId: `briefing-${briefing.id}`, name: 'brief-audio', data: said.audio, contentType: 'audio/mpeg' }, deps);
    if (!kept.ok) {
      return fail(`The audio could not be kept: ${kept.reason}`);
    }
    const characters = said.characters ?? script.text.length;
    const model = `${voice.connector}/${voice.scriptModel}`;
    const { tokenCostMicroCents } = await import('@/libs/pricing');
    const usage = { inputTokens: characters, outputTokens: 0 };
    const costMicroCents = tokenCostMicroCents(model, usage);
    try {
      const { chargeUsage } = await import('@/services/BudgetService');
      await chargeUsage({ orgId: briefing.orgId, feature: 'brief.audio', model, usage });
    } catch (error) {
      console.warn('brief audio: the voice could not be charged', { orgId: briefing.orgId, message: error instanceof Error ? error.message : 'unknown' });
    }
    const ready: BriefAudio = {
      status: 'ready',
      sourceHash: plan.sourceHash,
      at: at(),
      url: kept.url,
      filename: kept.filename,
      bytes: kept.bytes,
      durationMs: said.durationMs ?? 0,
      script: script.text,
      voice: { connector: voice.connector, id: voiceId, name: voiceName },
      model: voice.scriptModel,
      characters,
      costMicroCents,
    };
    await store(briefing.id, plan.sourceHash, ready);
    return ready;
  } catch (error) {
    return fail(`The audio could not be made (${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}).`);
  }
}

/**
 * The brief's audio: kept, being made, or made now. With `wait`, the caller
 * (a push) waits for it; without, the player is told it is on its way and
 * asks again. Never throws.
 * @param input - Which brief, and whether to wait.
 * @param input.orgId - The brief's workspace.
 * @param input.briefingId - The brief.
 * @param input.wait - Wait for the audio rather than return `pending`.
 * @param input.speed - The viewer's starting speed, when not the brief's owner.
 * @param deps - Seams for tests.
 */
export async function ensureBriefAudio(input: { orgId: string; briefingId: number; wait?: boolean; speed?: ListenSpeed }, deps: AudioDeps = {}): Promise<BriefAudioState> {
  try {
    const plan = await audioPlan(input.orgId, input.briefingId, deps);
    if (!plan.on) {
      return { status: 'off', reason: plan.reason };
    }
    const speed = input.speed ?? plan.speed;
    const now = deps.now ?? new Date();
    const current = plan.briefing.audio?.sourceHash === plan.sourceHash ? plan.briefing.audio : null;
    const age = current ? now.getTime() - new Date(current.at).getTime() : Number.POSITIVE_INFINITY;
    if (current?.status === 'ready') {
      return stateOf(plan, current, speed);
    }
    if (current?.status === 'pending' && age < PENDING_STALE_MS && !input.wait) {
      return { status: 'pending' };
    }
    if (current?.status === 'failed' && age < FAILED_RETRY_MS) {
      return stateOf(plan, current, speed);
    }
    const budget = await (deps.budget ?? defaultBudget)({ accountId: plan.accountId, orgId: input.orgId, now });
    if (!budget.ok) {
      return { status: 'off', reason: `Audio is paused: ${budget.why}.` };
    }
    // Claim it, so two views at once make it once.
    const pending: BriefAudio = { status: 'pending', sourceHash: plan.sourceHash, at: now.toISOString() };
    const staleBefore = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
    const claimed = await db.update(briefingSchema)
      .set({ audio: pending })
      .where(and(
        eq(briefingSchema.id, plan.briefing.id),
        sql`(${briefingSchema.audio} is null or ${briefingSchema.audio}->>'sourceHash' <> ${plan.sourceHash} or ${briefingSchema.audio}->>'status' <> 'pending' or ${briefingSchema.audio}->>'at' < ${staleBefore})`,
      ))
      .returning({ id: briefingSchema.id });
    if (claimed.length === 0) {
      if (!input.wait) {
        return { status: 'pending' };
      }
      // Someone else is making it; a push waits for theirs.
      return waitForReady(input.orgId, input.briefingId, plan, speed);
    }
    const made = make(plan, deps);
    if (!input.wait) {
      void made;
      return { status: 'pending' };
    }
    return stateOf(plan, await made, speed);
  } catch (error) {
    console.warn('brief audio: could not be read', { orgId: input.orgId, briefingId: input.briefingId, message: error instanceof Error ? error.message : 'unknown' });
    return { status: 'off', reason: 'Audio could not be read just now.' };
  }
}

/**
 * Wait for another caller's audio to land, a few seconds at a time.
 * @param orgId - The workspace.
 * @param briefingId - The brief.
 * @param plan - The plan.
 * @param speed - The speed.
 */
async function waitForReady(orgId: string, briefingId: number, plan: Extract<AudioPlan, { on: true }>, speed: ListenSpeed): Promise<BriefAudioState> {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2_000));
    const [row] = await db.select({ audio: briefingSchema.audio }).from(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, briefingId))).limit(1);
    const a = row?.audio;
    if (a && a.sourceHash === plan.sourceHash && a.status !== 'pending') {
      return stateOf(plan, a, speed);
    }
  }
  return { status: 'pending' };
}

/** A ready brief's MP3, for a channel that carries the file itself. */
export type BriefAudioFile = { bytes: Uint8Array; filename: string; durationMs: number; title: string };

/**
 * A ready brief's MP3 bytes, or null when it has none. Never throws.
 * @param orgId - The brief's workspace.
 * @param briefingId - The brief.
 */
export async function readBriefAudio(orgId: string, briefingId: number): Promise<BriefAudioFile | null> {
  try {
    const [row] = await db.select({ title: briefingSchema.title, audio: briefingSchema.audio }).from(briefingSchema).where(and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.id, briefingId))).limit(1);
    const a = row?.audio;
    if (!a || a.status !== 'ready') {
      return null;
    }
    const { readMediaBytes } = await import('@/libs/tools/artifacts/media');
    const got = await readMediaBytes(orgId, a.url);
    return got ? { bytes: got.bytes, filename: `${row!.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'brief'}.mp3`, durationMs: a.durationMs, title: row!.title } : null;
  } catch {
    return null;
  }
}
