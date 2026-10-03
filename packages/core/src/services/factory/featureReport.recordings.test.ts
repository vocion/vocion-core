import type { ReportArtifact } from './featureReport';
import { describe, expect, it } from 'vitest';
import { recordingsOf } from './featureReport';

const T = (iso: string) => new Date(iso);

function video(id: number, role: string, url: string | null, at: string, extra: Partial<ReportArtifact> = {}): ReportArtifact {
  return { id, kind: 'file', title: `Recording ${id}`, recordType: 'object', recordId: '41', recordRole: role, spec: { url, contentType: 'video/webm', caption: `caption ${id}` }, url, createdAt: T(at), ...extra };
}

describe('the recordings a feature page plays (2026-10-03)', () => {
  it('is nothing of each kind when none was kept', () => {
    expect(recordingsOf([])).toEqual({ live: null, qa: null });
    expect(recordingsOf([video(1, 'qa-screenshot', '/api/artifacts/x/x.png', '2026-10-01T09:00:00Z')])).toEqual({ live: null, qa: null });
  });

  it('picks the newest live check and the newest pre-merge recording, with caption and date', () => {
    const r = recordingsOf([
      video(1, 'qa-live-video', '/api/media/9/live-check-desktop-1-aaaaaaaaaaaaaaaa.webm', '2026-10-01T09:00:00Z'),
      video(2, 'qa-live-video', '/api/media/9/live-check-desktop-1-bbbbbbbbbbbbbbbb.webm', '2026-10-02T09:00:00Z'),
      video(3, 'qa-video', '/api/media/41/rename-cccccccccccccccc.webm', '2026-09-30T09:00:00Z'),
    ]);

    expect(r.live).toMatchObject({ artifactId: 2, caption: 'caption 2', at: T('2026-10-02T09:00:00Z'), contentType: 'video/webm', slateShareId: null });
    expect(r.qa).toMatchObject({ artifactId: 3, url: '/api/media/41/rename-cccccccccccccccc.webm' });
  });

  it('prefers a recording Vocion keeps to a newer link out, which may have expired', () => {
    const r = recordingsOf([
      video(4, 'qa-video', '/api/media/41/kept-dddddddddddddddd.webm', '2026-09-30T09:00:00Z'),
      video(5, 'qa-video', 'https://evidence.example/qa/77/x.webm?X-Amz-Expires=604800', '2026-10-01T09:00:00Z'),
    ]);

    expect(r.qa?.artifactId).toBe(4);
  });

  it('carries a Slate share when one is set, for the later phase that embeds it', () => {
    const r = recordingsOf([video(6, 'qa-live-video', '/api/media/9/x-eeeeeeeeeeeeeeee.webm', '2026-10-02T09:00:00Z', { spec: { url: '/api/media/9/x-eeeeeeeeeeeeeeee.webm', contentType: 'video/webm', caption: 'c', slateShareId: 'share-fictional-1' } })]);

    expect(r.live?.slateShareId).toBe('share-fictional-1');
  });

  it('offers the video host\'s player only once published there, and says why when it failed', () => {
    const url = '/api/media/9/x-ffffffffffffffff.webm';
    const published = recordingsOf([video(7, 'qa-live-video', url, '2026-10-02T09:00:00Z', { spec: { url, contentType: 'video/webm', caption: 'c', slateShareId: 'share-fictional-2', hostedVideo: { state: 'published', host: 'slate', label: 'Slate', shareId: 'share-fictional-2', watchUrl: 'https://video-host.example/v/share-fictional-2', embedUrl: 'https://video-host.example/embed/share-fictional-2', at: '2026-10-02T09:05:00Z' } } })]);

    expect(published.live).toMatchObject({ hosted: { label: 'Slate', watchUrl: 'https://video-host.example/v/share-fictional-2', embedUrl: 'https://video-host.example/embed/share-fictional-2' }, hostNote: null });

    const failed = recordingsOf([video(8, 'qa-live-video', url, '2026-10-02T09:00:00Z', { spec: { url, contentType: 'video/webm', caption: 'c', hostedVideo: { state: 'failed', host: 'slate', label: 'Slate', reason: 'Slate answered 503 while trying to start an upload.', at: '2026-10-02T09:05:00Z' } } })]);

    expect(failed.live).toMatchObject({ hosted: null, hostNote: 'Not on Slate: Slate answered 503 while trying to start an upload.' });

    // Mid-upload, or a player address that is not https: nothing to frame.
    const pending = recordingsOf([video(9, 'qa-live-video', url, '2026-10-02T09:00:00Z', { spec: { url, contentType: 'video/webm', caption: 'c', hostedVideo: { state: 'publishing', host: 'slate', at: '2026-10-02T09:05:00Z' } } })]);
    const unsafe = recordingsOf([video(10, 'qa-live-video', url, '2026-10-02T09:00:00Z', { spec: { url, contentType: 'video/webm', caption: 'c', hostedVideo: { state: 'published', host: 'slate', watchUrl: 'javascript:alert(1)', embedUrl: 'javascript:alert(1)', at: '2026-10-02T09:05:00Z' } } })]);

    expect([pending.live?.hosted, pending.live?.hostNote, unsafe.live?.hosted]).toEqual([null, null, null]);
  });

  it('pairs a recording with its narrated version, and only with its own', () => {
    const live = '/api/media/9/live-check-desktop-1-ffffffffffffffff.webm';
    const narrated = (id: number, from: number | null, at: string, fromUrl?: string) => video(id, 'qa-live-video-narrated', `/api/media/9/live-check-desktop-1-narrated-${String(id).padStart(16, '0')}.mp4`, at, {
      spec: { url: `/api/media/9/live-check-desktop-1-narrated-${String(id).padStart(16, '0')}.mp4`, contentType: 'video/mp4', caption: `narrated ${id}`, ...(from !== null ? { narratedFrom: from } : {}), ...(fromUrl ? { narratedFromUrl: fromUrl } : {}) },
    });
    const r = recordingsOf([
      video(7, 'qa-live-video', live, '2026-10-02T09:00:00Z'),
      // The same file filed on the release: a narration naming that filing is this recording's too.
      video(8, 'qa-live-video', live, '2026-10-02T09:00:00Z', { recordId: '77' }),
      narrated(9, 8, '2026-10-02T09:05:00Z'),
      // A narration of an older live check is not this one's.
      narrated(10, 3, '2026-10-02T09:06:00Z'),
    ]);

    expect(r.live?.narrated).toMatchObject({ artifactId: 9, contentType: 'video/mp4', caption: 'narrated 9' });
    // A narrated version is never picked as a recording of its own.
    expect([r.live?.artifactId, r.qa]).toEqual([8, null]);
    expect(recordingsOf([video(7, 'qa-live-video', live, '2026-10-02T09:00:00Z'), narrated(11, null, '2026-10-02T09:05:00Z', live)]).live?.narrated?.artifactId).toBe(11);
    expect(recordingsOf([video(7, 'qa-live-video', live, '2026-10-02T09:00:00Z')]).live?.narrated).toBeNull();
  });
});
