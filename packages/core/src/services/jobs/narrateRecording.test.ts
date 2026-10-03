import type { Narrator } from './narrateRecording';
import type { VoiceProvider } from '@/libs/voice/provider';
import { describe, expect, it, vi } from 'vitest';
import { narrateRecordingActivity, runNarrateRecordingJob } from './narrateRecording';

/**
 * The software factory's option: a recording filed on a feature is narrated
 * only when a voice is connected (the setting itself is the automation being
 * applied at all — `plugins.test.ts`), never a narration, once per recording;
 * the work writes a walkthrough as the narrating seat and says on the request
 * when it could not.
 */

const filed = { artifactId: 501, artifactIds: '501,502', role: 'qa-live-video', url: '/api/media/77/live-check-desktop-1-0123456789abcdef.webm', recordIds: '12,77', narrated: false, narrator: 'change-reviewer' };

describe('narrate-recording — the gate', () => {
  it('does nothing when no voice is connected', async () => {
    const start = vi.fn();

    await expect(runNarrateRecordingJob('org_n', filed, { hasVoice: async () => false, start })).resolves.toEqual({ queued: false, skipped: 'no voice is connected' });
    expect(start).not.toHaveBeenCalled();
  });

  it('never narrates a narration', async () => {
    const start = vi.fn();

    await expect(runNarrateRecordingJob('org_n', { ...filed, narrated: true }, { hasVoice: async () => true, start })).resolves.toMatchObject({ queued: false, skipped: 'already a narration' });
    await expect(runNarrateRecordingJob('org_n', { ...filed, role: 'qa-video-narrated' }, { hasVoice: async () => true, start })).resolves.toMatchObject({ queued: false });
    expect(start).not.toHaveBeenCalled();
  });

  it('hands a recording to the background once, keyed by the recording, with the narrating seat', async () => {
    const start = vi.fn(async () => {});

    await expect(runNarrateRecordingJob('org_n', filed, { hasVoice: async () => true, start })).resolves.toEqual({ queued: true });
    expect(start).toHaveBeenCalledWith('narrate-recording-org_n-501', { orgId: 'org_n', artifactId: 501, narrator: 'change-reviewer' });
  });

  it('ignores an event that names no recording', async () => {
    await expect(runNarrateRecordingJob('org_n', { role: 'qa-video' }, { hasVoice: async () => true, start: vi.fn() })).resolves.toMatchObject({ queued: false });
  });
});

describe('recording.narrate — the work', () => {
  const qa: Narrator = { slug: 'change-reviewer', name: 'QA', description: 'Reviews a finished task against its contract.', voiceId: null, avatar: { imageUrl: null, initials: 'QA', color: 'emerald' } };
  const voice: VoiceProvider = { connector: 'voice-fixture', label: 'Fixture Voice', listVoices: async () => ({ ok: true, voices: [{ id: 'voice_aria_01', name: 'Aria' }, { id: 'voice_kestrel_02', name: 'Kestrel' }] }), speak: vi.fn() };
  const recording = { url: filed.url, caption: 'Live check of REL-9, 2026-09-20', timeline: [{ atMs: 1_200, what: 'open https://northwind.example/rooms (desktop)', ok: true }] };
  const records = [{ id: 12, title: 'Export a room as a PDF', isRequest: true }, { id: 77, title: 'REL-9', isRequest: false }];

  it('narrates as the seat, in the provider\'s first voice, timed by a walkthrough written for the recording\'s length', async () => {
    const write = vi.fn(async () => ({ ok: true as const, lines: [{ atMs: 1_200, text: 'I open the rooms page.' }] }));
    const narrate = vi.fn(async (input: { script: unknown }) => {
      const lines = await (input.script as (p: { width: number; height: number; durationMs: number }) => Promise<unknown>)({ width: 1440, height: 900, durationMs: 9_000 });

      expect(lines).toEqual([{ atMs: 1_200, text: 'I open the rooms page.' }]);

      return { ok: true as const, url: '/api/media/77/narrated.mp4', artifactIds: [601, 602], spoken: [], dropped: 0, characters: 22 };
    });
    const res = await narrateRecordingActivity({ orgId: 'org_n', artifactId: 501, narrator: 'change-reviewer' }, {
      loadRecording: async () => recording,
      recordsOf: async () => records,
      loadNarrator: async () => qa,
      voice,
      writeWalkthrough: write as never,
      narrate: narrate as never,
      note: vi.fn(),
    });

    expect(res).toEqual({ ok: true, url: '/api/media/77/narrated.mp4' });
    expect(narrate).toHaveBeenCalledWith(expect.objectContaining({ recordingArtifactId: 501, voiceId: 'voice_aria_01', avatar: qa.avatar, speaker: { name: 'QA', slug: 'change-reviewer' }, author: { kind: 'agent', id: 'change-reviewer' } }), { voice });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ speaker: expect.objectContaining({ name: 'QA' }), recording: expect.objectContaining({ durationMs: 9_000, timeline: recording.timeline, context: '- Export a room as a PDF\n- REL-9' }) }));
  });

  it('speaks in the seat\'s own voice when its harness names one', async () => {
    const narrate = vi.fn(async () => ({ ok: true as const, url: 'u', artifactIds: [1], spoken: [], dropped: 0, characters: 1 }));
    await narrateRecordingActivity({ orgId: 'org_n', artifactId: 501, narrator: 'change-reviewer' }, { loadRecording: async () => recording, recordsOf: async () => records, loadNarrator: async () => ({ ...qa, voiceId: 'voice_kestrel_02' }), voice, writeWalkthrough: vi.fn() as never, narrate: narrate as never, note: vi.fn() });

    expect(narrate).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'voice_kestrel_02' }), expect.anything());
  });

  it('writes a failure on the feature request only, in one line, and never throws', async () => {
    const note = vi.fn(async () => {});
    const res = await narrateRecordingActivity({ orgId: 'org_n', artifactId: 501, narrator: 'change-reviewer' }, {
      loadRecording: async () => recording,
      recordsOf: async () => records,
      loadNarrator: async () => qa,
      voice,
      writeWalkthrough: vi.fn() as never,
      narrate: (async () => ({ ok: false, reason: 'Fixture Voice did not speak line 2: The account has no characters left this period.' })) as never,
      note,
    });

    expect(res).toMatchObject({ ok: false });
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith('org_n', 12, 'The recording "Live check of REL-9, 2026-09-20" was not narrated: Fixture Voice did not speak line 2: The account has no characters left this period.');
  });

  it('says so when the narrating seat is not in the workspace', async () => {
    const note = vi.fn(async () => {});
    const res = await narrateRecordingActivity({ orgId: 'org_n', artifactId: 501, narrator: 'qa-seat' }, { loadRecording: async () => recording, recordsOf: async () => records, loadNarrator: async () => null, voice, note });

    expect(res.reason).toMatch(/"qa-seat" is not in this workspace/);
    expect(note).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the voice was disconnected after the recording was filed', async () => {
    const note = vi.fn();
    const res = await narrateRecordingActivity({ orgId: 'org_n', artifactId: 501, narrator: 'change-reviewer' }, { loadRecording: async () => recording, recordsOf: async () => records, loadNarrator: async () => qa, voice: null, note });

    expect(res).toEqual({ ok: false, reason: 'no voice is connected' });
    expect(note).not.toHaveBeenCalled();
  });
});
