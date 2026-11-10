/**
 * AN AUTOMATION'S RUN, RECORDED WHOLE: a browser opened to record hands its
 * video back when it closes, and a person's own browser records nothing.
 */
import { describe, expect, it } from 'vitest';
import { closeBrowserSession, openBrowserSession } from './browserEngine';
import { PRACTICE_BLOG_ORIGIN } from './practiceBlog';

describe('a recorded run', () => {
  it('hands back a WebM of the run when its browser closes', async () => {
    const s = await openBrowserSession('video-test-recorded', {}, null, { record: true });
    await s.page.goto(`${PRACTICE_BLOG_ORIGIN}/config/pages`);
    await s.page.waitForTimeout(800);
    const { video } = await closeBrowserSession('video-test-recorded');

    expect(video?.byteLength ?? 0).toBeGreaterThan(1_000);
    // WebM's EBML magic number.
    expect(video?.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  }, 60_000);

  it('records nothing when not asked to', async () => {
    const s = await openBrowserSession('video-test-plain');
    await s.page.goto(`${PRACTICE_BLOG_ORIGIN}/config/pages`);

    expect((await closeBrowserSession('video-test-plain')).video).toBeNull();
  }, 60_000);
});
