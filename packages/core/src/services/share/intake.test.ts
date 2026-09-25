import { afterEach, describe, expect, it } from 'vitest';
import { acceptShare, DEFAULT_MAX_VIDEO_BYTES, maxVideoBytes, parseAttachParam, shareOpenPath } from './intake';

const MB = 1024 * 1024;

describe('acceptShare', () => {
  afterEach(() => {
    delete process.env.VOCION_SHARE_MAX_VIDEO_BYTES;
  });

  it('keeps a phone video as a video, by type or by extension', () => {
    expect(acceptShare({ name: 'IMG_0001.MOV', type: 'video/quicktime', size: 40 * MB })).toEqual({ ok: true, accepted: { contentType: 'video/quicktime', ext: 'mov', kind: 'video' } });
    expect(acceptShare({ name: 'clip.mp4', type: 'application/octet-stream', size: MB })).toEqual({ ok: true, accepted: { contentType: 'video/mp4', ext: 'mp4', kind: 'video' } });
  });

  it('refuses a video over the ceiling, and honours the override', () => {
    const big = { name: 'long.mp4', type: 'video/mp4', size: DEFAULT_MAX_VIDEO_BYTES + 1 };
    const refused = acceptShare(big);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toContain('100 MB');

    process.env.VOCION_SHARE_MAX_VIDEO_BYTES = String(200 * MB);

    expect(maxVideoBytes()).toBe(200 * MB);
    expect(acceptShare(big).ok).toBe(true);
  });

  it('ignores a nonsense override', () => {
    process.env.VOCION_SHARE_MAX_VIDEO_BYTES = 'lots';

    expect(maxVideoBytes()).toBe(DEFAULT_MAX_VIDEO_BYTES);
  });

  it('refuses an empty video', () => {
    expect(acceptShare({ name: 'x.mov', type: 'video/quicktime', size: 0 }).ok).toBe(false);
  });

  it('applies the chat rule to images, so a share can ride a turn', () => {
    expect(acceptShare({ name: 'photo.jpg', type: 'image/jpeg', size: MB })).toEqual({ ok: true, accepted: { contentType: 'image/jpeg', ext: 'jpg', kind: 'image' } });
    // An image the model cannot take inline is refused here too, not accepted and dropped later.
    expect(acceptShare({ name: 'huge.jpg', type: 'image/jpeg', size: 6 * MB }).ok).toBe(false);
  });

  it('names videos in the refusal for a type it cannot keep', () => {
    const r = acceptShare({ name: 'photo.heic', type: 'image/heic', size: MB });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('videos (MP4, MOV) can be shared');
  });
});

describe('shareOpenPath', () => {
  const image = { id: 12, title: 'a.jpg', kind: 'image' as const, contentType: 'image/jpeg', bytes: 1, url: '/api/artifacts/12' };
  const video = { id: 13, title: 'b.mov', kind: 'video' as const, contentType: 'video/quicktime', bytes: 1, url: '/api/artifacts/13' };

  it('opens a new chat in the workspace with the images attached', () => {
    const url = new URL(shareOpenPath({ slug: 'Northwind', items: [image] }), 'https://x');

    expect(url.pathname).toBe('/w/northwind/dashboard/chat');
    expect(url.searchParams.get('new')).toBe('1');
    expect(url.searchParams.get('attach')).toBe('12');
    expect(url.searchParams.has('prompt')).toBe(false);
  });

  it('seeds the note and names each video instead of attaching it', () => {
    const url = new URL(shareOpenPath({ slug: 'northwind', items: [image, video], note: '  what is this?  ' }), 'https://x');

    expect(url.searchParams.get('attach')).toBe('12');
    expect(url.searchParams.get('prompt')).toBe('what is this?\nShared video: b.mov (/api/artifacts/13)');
  });
});

describe('parseAttachParam', () => {
  it('reads digits only, once each, capped', () => {
    expect(parseAttachParam('3,abc,3, 4,-1,5x')).toEqual([3, 4]);
    expect(parseAttachParam(['1', '2,3'])).toEqual([1, 2, 3]);
    expect(parseAttachParam(undefined)).toEqual([]);
    expect(parseAttachParam(Array.from({ length: 20 }, (_, i) => String(i + 1)).join(','))).toHaveLength(10);
  });
});
