/**
 * NARRATE A NEW RECORDING IN ITS SEAT'S VOICE (Chris, 2026-10-03: "an option
 * in Software Factory that adds a second video on top of the QA video: a
 * second pass with an avatar bubble and voiceover from the SF instance agent
 * avatar").
 *
 * Two halves:
 *
 *   - `narrate-recording` — the automation job a plugin subscribes to
 *     `recording.filed` (the software factory's `narrate-recording`, applied
 *     only when its `narrateRecordings` setting is on). Plain code in
 *     milliseconds: a narration, a recording with no voice connected, or one
 *     already queued is let go without a word; anything else is handed to the
 *     background job below, so the event's pass never waits on it.
 *   - `recording.narrate` (`services/background/catalog.ts`) — the work. The
 *     narrator seat (`input.narrator`, an agent slug the automation names)
 *     writes a 5–10 line walkthrough timed to what the recording logged
 *     (`services/artifacts/walkthrough.ts`), and `narrateRecording` speaks it
 *     in the seat's voice (`harness.voiceId`, else the provider's first) under
 *     the seat's avatar (its image, else its initials on its accent). A
 *     failure is one line on each feature request the recording is on; the
 *     check and the review it came from are never touched.
 */

import type { NarrationAvatar } from '@/services/artifacts/narrate';
import type { TimelineMoment } from '@/services/artifacts/recordings';

export const NARRATE_RECORDING_JOB = 'narrate-recording';

/** Agent who narrates when the automation names none. */
const NO_NARRATOR = '';

type GateDeps = {
  hasVoice?: (orgId: string) => Promise<boolean>;
  start?: (id: string, input: { orgId: string; artifactId: number; narrator: string }) => Promise<void>;
};

/**
 * The automation job: let go of what is not to be narrated, hand the rest to
 * the background. Never throws.
 * @param orgId - The workspace.
 * @param input - The `recording.filed` payload, with the automation's `narrator`.
 * @param deps - Seams for tests.
 */
export async function runNarrateRecordingJob(orgId: string, input: Record<string, unknown>, deps: GateDeps = {}): Promise<{ queued: boolean; skipped?: string }> {
  const artifactId = Number(input.artifactId);
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    return { queued: false, skipped: 'the event names no recording' };
  }
  const { NARRATED_SUFFIX } = await import('@/services/artifacts/recordings');
  if (input.narrated === true || String(input.role ?? '').endsWith(NARRATED_SUFFIX)) {
    return { queued: false, skipped: 'already a narration' };
  }
  const hasVoice = deps.hasVoice ?? (async (o: string) => (await (await import('@/services/voice/provider')).voiceProvider(o)) !== null);
  if (!await hasVoice(orgId)) {
    return { queued: false, skipped: 'no voice is connected' };
  }
  const narrator = typeof input.narrator === 'string' ? input.narrator.trim() : NO_NARRATOR;
  const start = deps.start ?? (async (id, jobInput) => {
    const { startJob } = await import('@/libs/durable/jobs');
    const { JOB } = await import('@/services/background/catalog');
    await startJob(id, { job: JOB.recordingNarrate, input: jobInput });
  });
  // One narration per recording: the id is the idempotency key.
  await start(`narrate-recording-${orgId}-${artifactId}`, { orgId, artifactId, narrator });
  return { queued: true };
}

/** The seat that narrates, as narration reads it. */
export type Narrator = { slug: string; name: string; description: string | null; voiceId: string | null; /** The seat's speaking pace (`harness.voiceSpeed`), 1 = the voice's own. */ voiceSpeed: number | null; avatar: NarrationAvatar };

/**
 * An agent row as the narrator: its name (or persona display name), its
 * avatar (persona image, else initials on its accent) and its voice.
 * @param orgId - The workspace.
 * @param slug - The agent.
 */
async function loadNarrator(orgId: string, slug: string): Promise<Narrator | null> {
  if (!slug) {
    return null;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const { initialsOf } = await import('@/libs/media/narration');
  const [row] = await db
    .select({ slug: agentSchema.slug, name: agentSchema.name, description: agentSchema.description, persona: agentSchema.persona, accent: agentSchema.accent, harness: agentSchema.harnessConfig })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)))
    .limit(1);
  if (!row) {
    return null;
  }
  const name = row.persona?.displayName?.trim() || row.name;
  const voiceId = typeof (row.harness as { voiceId?: unknown } | null)?.voiceId === 'string' ? (row.harness as { voiceId: string }).voiceId : null;
  const speedRaw = Number((row.harness as { voiceSpeed?: unknown } | null)?.voiceSpeed);
  const voiceSpeed = Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : null;
  return {
    slug: row.slug,
    name,
    description: row.description,
    voiceId,
    voiceSpeed,
    avatar: { imageUrl: row.persona?.iconUrl ?? null, initials: initialsOf(name), color: row.accent ?? 'amber' },
  };
}

/**
 * The records a recording is on, with their titles and whether each is the
 * factory's request type (where a failure is written).
 * @param orgId - The workspace.
 * @param url - The recording's served URL, shared by its filings.
 */
async function recordsOf(orgId: string, url: string): Promise<Array<{ id: number; title: string; isRequest: boolean }>> {
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const filings = await db.select({ recordId: artifactSchema.recordId }).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.url, url), eq(artifactSchema.recordType, 'object')));
  const ids = [...new Set(filings.map(f => Number(f.recordId)).filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, ids)));
  const { factoryTypes } = await import('@/libs/factory/types');
  const requestType = await factoryTypes(orgId).then(t => t.request).catch(() => null);
  return rows.map(r => ({ id: r.id, title: r.title, isRequest: r.type === requestType }));
}

export type NarrateActivityDeps = {
  loadNarrator?: typeof loadNarrator;
  recordsOf?: typeof recordsOf;
  note?: (orgId: string, requestId: number, line: string) => Promise<void>;
  voice?: import('@/libs/voice/provider').VoiceProvider | null;
  writeWalkthrough?: typeof import('@/services/artifacts/walkthrough').writeWalkthrough;
  narrate?: typeof import('@/services/artifacts/narrate').narrateRecording;
  loadRecording?: (orgId: string, artifactId: number) => Promise<LoadedRecording | null>;
};

/** The source recording as the narration reads it: where it is served, what it shows, and — for a demo — the words said while it ran. */
export type LoadedRecording = {
  url: string;
  caption: string;
  timeline: TimelineMoment[];
  /** Lines said at their moments while the recording ran (a feature demo); spoken as written. Empty when nothing was said. */
  script: Array<{ atMs: number; text: string }>;
};

/**
 * The source recording's served URL, caption and logged moments.
 * @param orgId - The workspace.
 * @param artifactId - The recording.
 */
async function loadRecording(orgId: string, artifactId: number): Promise<LoadedRecording | null> {
  const { getArtifact } = await import('@/services/ArtifactService');
  const row = await getArtifact({ orgId, id: artifactId });
  if (!row) {
    return null;
  }
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const url = typeof spec.url === 'string' ? spec.url : row.url ?? '';
  const script = Array.isArray(spec.script)
    ? (spec.script as Array<Record<string, unknown>>).filter(l => typeof l.text === 'string' && l.text.trim() && Number.isFinite(Number(l.atMs))).map(l => ({ atMs: Number(l.atMs), text: String(l.text) }))
    : [];
  return { url, caption: typeof spec.caption === 'string' ? spec.caption : row.title, timeline: Array.isArray(spec.timeline) ? spec.timeline as TimelineMoment[] : [], script };
}

/**
 * The background work: write the walkthrough, narrate, and say so on the
 * requests when it could not be done. Never throws.
 * @param input - Which recording, and which seat narrates it.
 * @param input.orgId - The workspace.
 * @param input.artifactId - The recording.
 * @param input.narrator - The narrating agent's slug.
 * @param deps - Seams for tests.
 */
export async function narrateRecordingActivity(input: { orgId: string; artifactId: number; narrator: string }, deps: NarrateActivityDeps = {}): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const { orgId, artifactId } = input;
  const recording = await (deps.loadRecording ?? loadRecording)(orgId, artifactId).catch(() => null);
  if (!recording) {
    return { ok: false, reason: `recording #${artifactId} is gone.` };
  }
  const records = await (deps.recordsOf ?? recordsOf)(orgId, recording.url).catch(() => []);
  const fail = async (reason: string) => {
    const note = deps.note ?? (async (o: string, id: number, line: string) => (await import('@/services/factory/carry')).noteOnRequest(o, id, line));
    for (const r of records.filter(x => x.isRequest)) {
      await note(orgId, r.id, `The recording "${recording.caption}" was not narrated: ${reason}`.slice(0, 500)).catch(() => undefined);
    }
    const { logger } = await import('@/libs/Logger');
    logger.warn('recording not narrated', { orgId, artifactId, reason });
    return { ok: false, reason };
  };

  const narrator = await (deps.loadNarrator ?? loadNarrator)(orgId, input.narrator).catch(() => null);
  if (!narrator) {
    return fail(input.narrator ? `the narrating agent "${input.narrator}" is not in this workspace.` : 'the automation names no agent to narrate it.');
  }
  const voice = deps.voice !== undefined ? deps.voice : await (await import('@/services/voice/provider')).voiceProvider(orgId);
  if (!voice) {
    // Disconnected since the recording was filed: nothing to say on the request.
    return { ok: false, reason: 'no voice is connected' };
  }
  let voiceId = narrator.voiceId;
  if (!voiceId) {
    const voices = await voice.listVoices();
    if (!voices.ok) {
      return fail(`${voice.label} did not list its voices: ${voices.reason}`);
    }
    voiceId = voices.voices[0]?.id ?? null;
    if (!voiceId) {
      return fail(`the ${voice.label} account has no voice to speak with.`);
    }
  }
  const context = records.length > 0 ? records.map(r => `- ${r.title}`).join('\n') : null;
  const write = deps.writeWalkthrough ?? (await import('@/services/artifacts/walkthrough')).writeWalkthrough;
  const narrate = deps.narrate ?? (await import('@/services/artifacts/narrate')).narrateRecording;
  const res = await narrate({
    orgId,
    recordingArtifactId: artifactId,
    voiceId,
    ...(narrator.voiceSpeed ? { voiceSpeed: narrator.voiceSpeed } : {}),
    // A recording with said lines is a demo: cut to its moments, with the address bar.
    demo: recording.script.length > 0,
    avatar: narrator.avatar,
    speaker: { name: narrator.name, slug: narrator.slug },
    author: { kind: 'agent', id: narrator.slug },
    // A demo's words were said at their moments as it was recorded: spoken as written. Anything
    // else gets a walkthrough written from what the recording logged.
    script: recording.script.length > 0
      ? recording.script
      : async (probed) => {
        const w = await write({ orgId, speaker: { name: narrator.name, slug: narrator.slug, description: narrator.description }, recording: { caption: recording.caption, durationMs: probed.durationMs, timeline: recording.timeline, context } });
        return w.ok ? w.lines : { error: w.reason };
      },
  }, { voice });
  if (!res.ok) {
    return fail(res.reason);
  }
  return { ok: true, url: res.url };
}
