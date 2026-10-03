import type { VideoHost } from './host';
import type { HostedVideo, PublishStore, RecordingArtifact } from './publish';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { videoHost } from './host';
import { publishRecording, STALE_CLAIM_MS } from './publish';

const ORG = 'org_northwind';
const NOW = new Date('2026-10-03T12:00:00Z');
const URL_A = '/api/media/41/live-check-desktop-1-aaaaaaaaaaaaaaaa.webm';

function recording(id: number, over: Partial<RecordingArtifact> = {}): RecordingArtifact {
  return {
    id,
    kind: 'file',
    title: 'Live check of REL-9, 2026-10-03',
    url: URL_A,
    spec: { url: URL_A, contentType: 'video/webm', caption: 'Live check of REL-9, 2026-10-03' },
    recordId: '41',
    recordRole: 'qa-live-video',
    createdAt: new Date('2026-10-03T11:00:00Z'),
    ...over,
  };
}

/**
 * An in-memory store over a handful of artifacts, holding the claim the way the database's conditional write does.
 * @param rows
 * @param over
 */
function memoryStore(rows: RecordingArtifact[], over: Partial<PublishStore> = {}) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const shares: Array<{ id: number; fields: Record<string, unknown> }> = [];
  const notes: Array<{ ids: number[]; hostedVideo: HostedVideo }> = [];
  const store: PublishStore = {
    get: async (_o, id) => byId.get(id) ?? null,
    siblings: async (_o, url) => [...byId.values()].filter(r => r.url === url).sort((a, b) => a.id - b.id),
    claim: async (_o, id, claim, staleBefore) => {
      const r = byId.get(id)!;
      const h = r.spec.hostedVideo as HostedVideo | undefined;
      if (h && h.state !== 'failed' && !(h.state === 'publishing' && h.at < staleBefore.toISOString())) {
        return false;
      }
      r.spec = { ...r.spec, hostedVideo: claim };
      return true;
    },
    note: async (_o, ids, hostedVideo) => {
      notes.push({ ids, hostedVideo });
      for (const id of ids) {
        byId.get(id)!.spec = { ...byId.get(id)!.spec, hostedVideo };
      }
    },
    share: async (_o, a, fields) => {
      shares.push({ id: a.id, fields });
      byId.get(a.id)!.spec = { ...byId.get(a.id)!.spec, ...fields };
    },
    readBytes: async () => Buffer.from('fictional webm bytes'),
    codeFor: async (_o, id) => (id === 41 ? 'FE-41' : null),
    narratedTwin: async () => null,
    audienceFor: async () => 'workspace',
    ...over,
  };
  return { store, byId, shares, notes };
}

function host(result: Awaited<ReturnType<VideoHost['publish']>> = { ok: true, shareId: 'share-fictional-1', hostRef: 'vid-1', watchUrl: 'https://video-host.example/v/share-fictional-1', embedUrl: 'https://video-host.example/embed/share-fictional-1', visibility: 'team' }) {
  const publish = vi.fn<VideoHost['publish']>(async () => result);
  const setAudience = vi.fn<VideoHost['setAudience']>(async (_ref, audience) => ({ ok: true, visibility: audience === 'public' ? 'public' : 'team' }));
  const h: VideoHost = { id: 'slate', label: 'Slate', publish, setAudience, specFields: shareId => ({ slateShareId: shareId }) };
  return { h, publish, setAudience };
}

describe('publishing a filed recording to the video host', () => {
  it('does nothing at all when no host is connected', async () => {
    const { store, shares, notes } = memoryStore([recording(1)]);
    const get = vi.spyOn(store, 'get');

    await expect(publishRecording({ orgId: ORG, artifactId: 1 }, { host: null, store })).resolves.toEqual({ status: 'no-host' });
    expect([get.mock.calls.length, shares.length, notes.length]).toEqual([0, 0, 0]);
  });

  it('uploads the file once, titled with the feature code, and keeps the share on every artifact carrying it', async () => {
    // The same recording, filed on the request (1) and on the release (2).
    const { store, byId, shares } = memoryStore([recording(1), recording(2, { recordId: '9' })]);
    const { h, publish } = host();
    const r = await publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store, now: () => NOW });

    expect(r).toEqual({ status: 'published', shareId: 'share-fictional-1', watchUrl: 'https://video-host.example/v/share-fictional-1', artifactIds: [1, 2] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ data: Buffer.from('fictional webm bytes'), contentType: 'video/webm', title: 'FE-41 · Live check of REL-9, 2026-10-03', summary: 'Live check of REL-9, 2026-10-03', audience: 'workspace' });
    expect(shares.map(s => s.id)).toEqual([1, 2]);
    expect(byId.get(2)!.spec).toMatchObject({ slateShareId: 'share-fictional-1', hostedVideo: { state: 'published', host: 'slate', shareId: 'share-fictional-1', embedUrl: 'https://video-host.example/embed/share-fictional-1', visibility: 'team', attempts: 1 } });
  });

  it('never uploads the same file twice: a second publish copies the share to a sibling filed later', async () => {
    const { store, byId } = memoryStore([recording(1), recording(2, { recordId: '9' })]);
    const { h, publish } = host();
    await publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store, now: () => NOW });
    // Filed again under a third record with the same bytes (same served URL).
    byId.set(3, recording(3, { recordId: '77' }));

    const again = await publishRecording({ orgId: ORG, artifactId: 3 }, { host: h, store, now: () => NOW });

    expect(again).toEqual({ status: 'already', shareId: 'share-fictional-1', copiedTo: [3] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(byId.get(3)!.spec).toMatchObject({ slateShareId: 'share-fictional-1', hostedVideo: { state: 'published' } });
  });

  it('leaves a live claim alone, and takes over a stale one', async () => {
    const claimedAt = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const live = memoryStore([recording(1, { spec: { url: URL_A, contentType: 'video/webm', hostedVideo: { state: 'publishing', host: 'slate', at: claimedAt(60_000) } } })]);
    const { h, publish } = host();

    await expect(publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store: live.store, now: () => NOW })).resolves.toEqual({ status: 'in-progress' });
    expect(publish).not.toHaveBeenCalled();

    const stale = memoryStore([recording(1, { spec: { url: URL_A, contentType: 'video/webm', hostedVideo: { state: 'publishing', host: 'slate', at: claimedAt(STALE_CLAIM_MS + 1) } } })]);

    await expect(publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store: stale.store, now: () => NOW })).resolves.toMatchObject({ status: 'published' });
  });

  it('keeps a refusal on every artifact, with its reason and attempt, and says whether to try again', async () => {
    const { store, byId } = memoryStore([recording(1), recording(2, { recordId: '9' })]);
    const { h } = host({ ok: false, reason: 'Slate answered 503 while trying to start an upload.', retryable: true });
    const r = await publishRecording({ orgId: ORG, artifactId: 2 }, { host: h, store, now: () => NOW });

    expect(r).toEqual({ status: 'failed', reason: 'Slate answered 503 while trying to start an upload.', retryable: true });

    for (const id of [1, 2]) {
      expect(byId.get(id)!.spec.hostedVideo).toEqual({ state: 'failed', host: 'slate', label: 'Slate', reason: 'Slate answered 503 while trying to start an upload.', attempts: 1, at: NOW.toISOString() });
    }

    // The retry claims the failed one again and counts the attempt.
    const ok = host();
    await publishRecording({ orgId: ORG, artifactId: 2 }, { host: ok.h, store, now: () => NOW });

    expect(byId.get(1)!.spec.hostedVideo).toMatchObject({ state: 'published', attempts: 2 });
  });

  it('never throws: a store that breaks comes back as a retryable failure', async () => {
    const { store } = memoryStore([recording(1)], { siblings: async () => {
      throw new Error('connection reset');
    } });
    const { h } = host();

    await expect(publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store })).resolves.toEqual({ status: 'failed', reason: 'connection reset', retryable: true });
  });

  it('says a file gone from the media store, and does not ask to retry it', async () => {
    const { store } = memoryStore([recording(1)], { readBytes: async () => null });
    const { h, publish } = host();

    await expect(publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store, now: () => NOW })).resolves.toMatchObject({ status: 'failed', retryable: false });
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes the narrated twin in place of a raw recording filed before it', async () => {
    const NARRATED = '/api/media/41/live-check-desktop-1-narrated-bbbbbbbbbbbbbbbb.webm';
    const narrated = recording(5, { url: NARRATED, recordRole: 'qa-live-video-narrated', title: 'Live check of REL-9, narrated', spec: { url: NARRATED, contentType: 'video/mp4', caption: 'Live check of REL-9, narrated' }, createdAt: new Date('2026-10-03T11:03:00Z') });
    const narratedTwin = vi.fn(async (_o: string, recordId: string, role: string) => (recordId === '41' && role === 'qa-live-video-narrated' ? 5 : null));
    const { store, byId } = memoryStore([recording(1), narrated], { narratedTwin });
    const { h, publish } = host();
    const r = await publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store, now: () => NOW });

    expect(r).toMatchObject({ status: 'published', artifactIds: [5] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toMatchObject({ contentType: 'video/mp4', title: 'FE-41 · Live check of REL-9, narrated' });
    expect(byId.get(1)!.spec.hostedVideo).toBeUndefined();
  });

  it('skips what is not a kept recording', async () => {
    const { store } = memoryStore([recording(1, { kind: 'link' })]);
    const { h, publish } = host();

    await expect(publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store })).resolves.toMatchObject({ status: 'skipped' });
    await expect(publishRecording({ orgId: ORG, artifactId: 99 }, { host: h, store })).resolves.toMatchObject({ status: 'skipped' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('uploads public straight away when the feature it shows already has a live public link', async () => {
    const audienceFor = vi.fn<PublishStore['audienceFor']>(async () => 'public');
    const { store, byId } = memoryStore([recording(1), recording(2, { recordId: '9' })], { audienceFor });
    const { h, publish, setAudience } = host({ ok: true, shareId: 'share-fictional-1', hostRef: 'vid-1', watchUrl: 'https://video-host.example/v/share-fictional-1', embedUrl: 'https://video-host.example/embed/share-fictional-1', visibility: 'public' });
    await publishRecording({ orgId: ORG, artifactId: 1 }, { host: h, store, now: () => NOW });

    expect(audienceFor).toHaveBeenCalledWith(ORG, ['41', '9']);
    expect(publish.mock.calls[0]![0].audience).toBe('public');
    expect(setAudience).not.toHaveBeenCalled();
    expect(byId.get(1)!.spec.hostedVideo).toMatchObject({ state: 'published', visibility: 'public' });
  });

  it('sets who may watch to match a link turned on while the bytes went up, and keeps why when it cannot', async () => {
    const turnedOn = () => {
      let n = 0;
      return vi.fn<PublishStore['audienceFor']>(async () => (n++ === 0 ? 'workspace' : 'public'));
    };
    const a = memoryStore([recording(1)], { audienceFor: turnedOn() });
    const ok = host();
    await publishRecording({ orgId: ORG, artifactId: 1 }, { host: ok.h, store: a.store, now: () => NOW });

    expect(ok.setAudience).toHaveBeenCalledWith('vid-1', 'public');
    expect(a.byId.get(1)!.spec.hostedVideo).toMatchObject({ state: 'published', visibility: 'public' });

    const b = memoryStore([recording(1)], { audienceFor: turnedOn() });
    const down = host();
    down.setAudience.mockResolvedValueOnce({ ok: false, reason: 'The host could not be reached.', retryable: true });
    const r = await publishRecording({ orgId: ORG, artifactId: 1 }, { host: down.h, store: b.store, now: () => NOW });

    expect(r.status).toBe('published');
    expect(b.byId.get(1)!.spec.hostedVideo).toMatchObject({ state: 'published', visibility: 'team', visibilityError: 'The host could not be reached.' });
  });
});

describe('the video host capability', () => {
  it('is the first provider that resolves, null when none does, and a provider that throws counts as none', async () => {
    const h = host().h;
    const none = { id: 'none', label: 'None', resolve: async () => null };
    const broken = { id: 'broken', label: 'Broken', resolve: async () => {
      throw new Error('revoked');
    } };

    await expect(videoHost(ORG, [none, broken])).resolves.toBeNull();
    await expect(videoHost(ORG, [broken, { id: 'slate', label: 'Slate', resolve: async () => h }])).resolves.toBe(h);
  });
});
