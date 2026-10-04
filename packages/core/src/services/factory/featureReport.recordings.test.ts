import type { ReportArtifact } from './featureReport';
import { describe, expect, it } from 'vitest';
import { recordingsOf } from './featureReport';

const T = (iso: string) => new Date(iso);

function video(id: number, role: string, url: string | null, at: string, extra: Partial<ReportArtifact> = {}): ReportArtifact {
  return { id, kind: 'file', title: `Recording ${id}`, recordType: 'object', recordId: '41', recordRole: role, spec: { url, contentType: 'video/webm', caption: `caption ${id}` }, url, createdAt: T(at), ...extra };
}

describe('the recordings a feature page plays (2026-10-03)', () => {
  it('is nothing of each kind when none was kept', () => {
    expect(recordingsOf([])).toEqual({ demo: null, live: null, qa: null });
    expect(recordingsOf([video(1, 'qa-screenshot', '/api/artifacts/x/x.png', '2026-10-01T09:00:00Z')])).toEqual({ demo: null, live: null, qa: null });
  });

  it('picks the newest live check and the newest pre-merge recording, with caption and date', () => {
    const r = recordingsOf([
      video(1, 'qa-live-video', '/api/media/9/live-check-desktop-1-aaaaaaaaaaaaaaaa.webm', '2026-10-01T09:00:00Z'),
      video(2, 'qa-live-video', '/api/media/9/live-check-desktop-1-bbbbbbbbbbbbbbbb.webm', '2026-10-02T09:00:00Z'),
      video(3, 'qa-video', '/api/media/41/rename-cccccccccccccccc.webm', '2026-09-30T09:00:00Z'),
    ]);

    expect(r.live).toMatchObject({ artifactId: 2, caption: 'caption 2', at: T('2026-10-02T09:00:00Z'), contentType: 'video/webm' });
    expect(r.qa).toMatchObject({ artifactId: 3, url: '/api/media/41/rename-cccccccccccccccc.webm' });
  });

  it('picks the feature demo apart from the check, with its narration (2026-10-04)', () => {
    const demo = '/api/media/41/feature-demo-desktop-1-eeeeeeeeeeeeeeee.webm';
    const r = recordingsOf([
      video(6, 'feature-demo', demo, '2026-10-04T13:00:00Z'),
      video(7, 'feature-demo-narrated', '/api/media/41/feature-demo-desktop-1-narrated-0000000000000007.mp4', '2026-10-04T13:05:00Z', { spec: { url: '/api/media/41/feature-demo-desktop-1-narrated-0000000000000007.mp4', contentType: 'video/mp4', caption: 'narrated 7', narratedFrom: 6 } }),
      video(8, 'qa-live-video', '/api/media/9/live-check-desktop-1-aaaaaaaaaaaaaaaa.webm', '2026-10-04T12:50:00Z'),
    ]);

    expect(r.demo).toMatchObject({ artifactId: 6, url: demo, narrated: expect.objectContaining({ artifactId: 7, contentType: 'video/mp4' }) });
    expect(r.live?.artifactId).toBe(8);
  });

  it('prefers a recording Vocion keeps to a newer link out, which may have expired', () => {
    const r = recordingsOf([
      video(4, 'qa-video', '/api/media/41/kept-dddddddddddddddd.webm', '2026-09-30T09:00:00Z'),
      video(5, 'qa-video', 'https://evidence.example/qa/77/x.webm?X-Amz-Expires=604800', '2026-10-01T09:00:00Z'),
    ]);

    expect(r.qa?.artifactId).toBe(4);
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
