import { describe, expect, it } from 'vitest';
import { pickPreviewDemo, previewDemoContent } from './previewDemo';

const at = (iso: string) => new Date(iso);

describe('the preview demo a merge card plays (backlog 058)', () => {
  it('prefers the narrated version, and the newest of them', () => {
    const demo = pickPreviewDemo([
      { id: 1, recordRole: 'feature-demo-preview', spec: { url: '/api/media/12/demo-1.webm', contentType: 'video/webm', caption: 'Feature demo of FE-441, before merge', script: [{ atMs: 1_800, text: 'I open the library.' }] }, createdAt: at('2026-10-04T19:00:00Z') },
      { id: 2, recordRole: 'feature-demo-preview-narrated', spec: { url: '/api/media/12/demo-1-narrated.mp4', contentType: 'video/mp4', caption: 'Feature demo of FE-441, before merge · narrated', script: [{ atMs: 600, text: 'I open the library.' }] }, createdAt: at('2026-10-04T19:02:00Z') },
      { id: 3, recordRole: 'feature-demo-preview-narrated', spec: { url: '/api/media/12/demo-0-narrated.mp4', contentType: 'video/mp4', caption: 'older' }, createdAt: at('2026-10-04T18:00:00Z') },
    ]);

    expect(demo).toEqual({ artifactId: 2, url: '/api/media/12/demo-1-narrated.mp4', contentType: 'video/mp4', caption: 'Feature demo of FE-441, before merge · narrated', narrated: true, posterAt: 0.6 });
  });

  it('plays the plain recording while the narration is on its way, and says so', () => {
    const demo = pickPreviewDemo([
      { id: 1, recordRole: 'feature-demo-preview', spec: { url: '/api/media/12/demo-1.webm', caption: 'Feature demo of FE-441, before merge', script: [{ atMs: 1_800, text: 'I open the library.' }] }, createdAt: at('2026-10-04T19:00:00Z') },
    ]);

    expect(demo).toMatchObject({ artifactId: 1, narrated: false, contentType: 'video/webm', posterAt: 1.8 });
    expect(previewDemoContent(demo!)).toEqual({ kind: 'video', id: 'demo', label: 'Feature demo, built from the branch', tabLabel: 'Demo', url: '/api/media/12/demo-1.webm', contentType: 'video/webm', caption: 'Feature demo of FE-441, before merge · narration on its way', posterAt: 1.8 });
  });

  it('plays nothing it cannot serve: a link out, the live demo, QA\'s own test video', () => {
    expect(pickPreviewDemo([
      { id: 1, recordRole: 'feature-demo-preview', spec: { url: 'https://bucket.example/demo.webm' }, createdAt: at('2026-10-04T19:00:00Z') },
      { id: 2, recordRole: 'feature-demo', spec: { url: '/api/media/12/live.webm' }, createdAt: at('2026-10-04T19:00:00Z') },
      { id: 3, recordRole: 'qa-video', spec: { url: '/api/media/12/flow.webm' }, createdAt: at('2026-10-04T19:00:00Z') },
    ])).toBeNull();
  });
});
