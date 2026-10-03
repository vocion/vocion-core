import type { AudienceStore, VisibilityPatch } from './audience';
import type { VideoHost } from './host';
import type { HostedVideo } from './publish';
import { describe, expect, it, vi } from 'vitest';
import { isPubliclyHosted, setRecordingsAudience } from './audience';

const ORG = 'org_northwind';

function hosted(hostRef: string, over: Partial<HostedVideo> = {}): { spec: Record<string, unknown> } {
  return { spec: { contentType: 'video/webm', slateShareId: `share-${hostRef}`, hostedVideo: { state: 'published', host: 'slate', label: 'Slate', shareId: `share-${hostRef}`, hostRef, visibility: 'team', at: '2026-10-03T11:00:00Z', ...over } } };
}

function host(answer?: Awaited<ReturnType<VideoHost['setAudience']>>) {
  const setAudience = vi.fn<VideoHost['setAudience']>(async (_ref, audience) => answer ?? { ok: true, visibility: audience === 'public' ? 'public' : 'team' });
  const h: VideoHost = { id: 'slate', label: 'Slate', publish: vi.fn(), setAudience, specFields: shareId => ({ slateShareId: shareId }) };
  return { h, setAudience };
}

function store() {
  const notes: Array<{ hostId: string; hostRef: string; patch: VisibilityPatch }> = [];
  const s: AudienceStore = { noteVisibility: async (_o, hostId, hostRef, patch) => {
    notes.push({ hostId, hostRef, patch });
  } };
  return { s, notes };
}

describe('who may watch follows the feature\'s public link', () => {
  it('makes each hosted recording public once, however many artifacts carry it, and keeps the answer', async () => {
    const { h, setAudience } = host();
    const { s, notes } = store();
    // vid-1 filed on the request and on its task; vid-2 another recording; one never hosted.
    const r = await setRecordingsAudience({ orgId: ORG, audience: 'public', recordings: [hosted('vid-1'), hosted('vid-1'), hosted('vid-2'), { spec: { contentType: 'video/webm' } }] }, { host: h, store: s });

    expect(setAudience.mock.calls).toEqual([['vid-1', 'public'], ['vid-2', 'public']]);
    expect(notes).toEqual([
      { hostId: 'slate', hostRef: 'vid-1', patch: { visibility: 'public' } },
      { hostId: 'slate', hostRef: 'vid-2', patch: { visibility: 'public' } },
    ]);
    expect(r).toEqual({ changed: ['vid-1', 'vid-2'], failed: [] });
  });

  it('puts them back to the workspace\'s choice when the link is turned off', async () => {
    const { h, setAudience } = host();
    const { s, notes } = store();
    await setRecordingsAudience({ orgId: ORG, audience: 'workspace', recordings: [hosted('vid-1', { visibility: 'public' }), hosted('vid-2')] }, { host: h, store: s });

    // vid-2 was never made public: nothing to put back.
    expect(setAudience.mock.calls).toEqual([['vid-1', 'workspace']]);
    expect(notes).toEqual([{ hostId: 'slate', hostRef: 'vid-1', patch: { visibility: 'team' } }]);
  });

  it('touches nothing already where it should be, and asks for no host when there is nothing to do', async () => {
    const { s, notes } = store();

    await expect(setRecordingsAudience({ orgId: ORG, audience: 'public', recordings: [hosted('vid-1', { visibility: 'public' })] }, { store: s })).resolves.toEqual({ changed: [], failed: [] });
    expect(notes).toEqual([]);
  });

  it('never throws when the host is down: the reason is kept on the recording, and tried again next time', async () => {
    const { h, setAudience } = host({ ok: false, reason: 'Slate could not be reached to change who may watch the recording (ECONNREFUSED).', retryable: true });
    const { s, notes } = store();
    const r = await setRecordingsAudience({ orgId: ORG, audience: 'public', recordings: [hosted('vid-1')] }, { host: h, store: s });

    expect(r.failed).toEqual([{ hostRef: 'vid-1', reason: expect.stringMatching(/could not be reached/) }]);
    expect(notes).toEqual([{ hostId: 'slate', hostRef: 'vid-1', patch: { visibilityError: expect.stringMatching(/could not be reached/) } }]);

    // A recording public on the host but carrying a failed change is due again.
    setAudience.mockResolvedValueOnce({ ok: true, visibility: 'public' });
    await setRecordingsAudience({ orgId: ORG, audience: 'public', recordings: [hosted('vid-1', { visibility: 'public', visibilityError: 'earlier' })] }, { host: h, store: s });

    expect(notes.at(-1)).toEqual({ hostId: 'slate', hostRef: 'vid-1', patch: { visibility: 'public' } });
  });

  it('says so when the host the recording lives on is not connected any more', async () => {
    const { s, notes } = store();
    const r = await setRecordingsAudience({ orgId: ORG, audience: 'public', recordings: [hosted('vid-1')] }, { host: null, store: s });

    expect(r.failed).toHaveLength(1);
    expect(notes[0]!.patch).toEqual({ visibilityError: expect.stringMatching(/not connected/) });
  });

  it('calls a recording publicly hosted only while its host says public', () => {
    expect(isPubliclyHosted(hosted('vid-1', { visibility: 'public' }).spec)).toBe(true);
    expect(isPubliclyHosted(hosted('vid-1').spec)).toBe(false);
    expect(isPubliclyHosted(hosted('vid-1', { state: 'publishing', visibility: 'public' }).spec)).toBe(false);
    expect(isPubliclyHosted({ slateShareId: 'share-x' })).toBe(false);
  });
});
