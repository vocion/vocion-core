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
});
