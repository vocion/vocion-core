import type { VideoHost } from './host';
import { Buffer } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fileRecording } from '@/services/artifacts/recordings';
import { NARRATION_GRACE_MS, queueRecordingPublish, VIDEO_HOST_PUBLISH_JOB } from './queue';

const ORG = 'org_northwind';
const HOST: VideoHost = { id: 'slate', label: 'Slate', publish: async () => ({ ok: false, reason: 'unused', retryable: false }), setAudience: async () => ({ ok: false, reason: 'unused', retryable: false }), specFields: () => ({}) };

vi.mock('@/services/ArtifactService', () => {
  let id = 100;
  return { createArtifact: vi.fn(async () => ({ artifact: { id: ++id } })) };
});

describe('the trigger: a filed recording is queued for the video host', () => {
  it('queues nothing when no host is connected', async () => {
    const start = vi.fn();

    await expect(queueRecordingPublish({ orgId: ORG, artifactIds: [11, 12], role: 'qa-live-video' }, { host: null, start })).resolves.toEqual({ queued: false, reason: 'no video host is connected' });
    expect(start).not.toHaveBeenCalled();
  });

  it('starts one publish per filing, named by its first artifact; a raw recording waits for its narrated version', async () => {
    const start = vi.fn(async () => ({}));

    await queueRecordingPublish({ orgId: ORG, artifactIds: [11, 12], role: 'qa-live-video' }, { host: HOST, start });
    await queueRecordingPublish({ orgId: ORG, artifactIds: [13], role: 'qa-live-video-narrated' }, { host: HOST, start });

    expect(start.mock.calls).toEqual([
      [`${VIDEO_HOST_PUBLISH_JOB}-${ORG}-11`, { job: VIDEO_HOST_PUBLISH_JOB, input: { orgId: ORG, artifactId: 11 }, afterMs: NARRATION_GRACE_MS }],
      [`${VIDEO_HOST_PUBLISH_JOB}-${ORG}-13`, { job: VIDEO_HOST_PUBLISH_JOB, input: { orgId: ORG, artifactId: 13 } }],
    ]);
  });

  it('never throws: a queue that fails comes back as its reason', async () => {
    const start = vi.fn(async () => {
      throw new Error('executor not running');
    });

    await expect(queueRecordingPublish({ orgId: ORG, artifactIds: [11], role: 'qa-video' }, { host: HOST, start })).resolves.toEqual({ queued: false, reason: 'executor not running' });
  });

  it('is called from where recordings are filed, with what was filed, and never fails the filing', async () => {
    const publish = vi.fn(async () => {
      throw new Error('boom');
    });
    const announce = vi.fn(async () => {});
    const filed = await fileRecording({
      orgId: ORG,
      keptUnder: 41,
      name: 'live-check-desktop-1',
      data: Buffer.from('fictional webm bytes'),
      contentType: 'video/webm',
      records: [{ id: 41, role: 'qa-live-video' }, { id: 9, role: 'qa-live-video' }],
      title: 'Live check of REL-9',
      caption: 'Live check of REL-9',
      author: { kind: 'system', id: 'live-check' },
    }, { bucket: null, dir: path.join(os.tmpdir(), 'vocion-media-queue-test'), publish, announce });

    expect(filed).toMatchObject({ ok: true, artifactIds: [101, 102] });
    expect(publish).toHaveBeenCalledWith({ orgId: ORG, artifactIds: [101, 102], role: 'qa-live-video' });
    // The same filing is raised once as recording.filed, for a plugin to narrate it.
    expect(announce).toHaveBeenCalledWith(ORG, expect.objectContaining({ artifactId: 101, artifactIds: '101,102', role: 'qa-live-video', recordIds: '41,9', narrated: false }));
  });
});
