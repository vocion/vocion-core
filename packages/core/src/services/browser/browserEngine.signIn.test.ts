/**
 * THE SEAM A RUN STARTS SIGNED IN THROUGH (`openWithSignIn`): a real browser,
 * the practice blog editor (fictional, served inside the browser), and a kept
 * sign-in laid over it before the first step. The practice editor signs a
 * person in with site storage, as Squarespace does with its cookies, so a kept
 * sign-in that loads is an editor that opens without its login form.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { closeBrowserSession, openBrowserSession, openWithSignIn } from './browserEngine';
import { PRACTICE_BLOG_ORIGIN } from './practiceBlog';

const KEY = 'kept-sign-in-seam-test';

const KEPT = {
  cookies: [{ name: 'member', value: 'fixture-session-value', domain: 'site.northwind-outfitters.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const }],
  origins: [{ origin: PRACTICE_BLOG_ORIGIN, localStorage: [{ name: 'nw.user', value: 'true' }, { name: 'nw.seenNew', value: 'true' }] }],
};

afterEach(async () => {
  await closeBrowserSession(KEY);
});

describe('a run that starts from a kept sign-in', () => {
  it('opens the editor signed in: the cookies and site storage are in the browser before the first step', async () => {
    const s = await openWithSignIn(KEY, KEPT);
    await s.page.goto(`${PRACTICE_BLOG_ORIGIN}/config/pages`);

    expect(await s.context.cookies(PRACTICE_BLOG_ORIGIN)).toEqual([expect.objectContaining({ name: 'member', value: 'fixture-session-value' })]);
    expect(await s.page.evaluate(() => localStorage.getItem('nw.user'))).toBe('true');
    expect(await s.page.locator('input[type="password"]').count()).toBe(0);
  }, 60_000);

  it('without one, the same editor asks to log in', async () => {
    const s = await openBrowserSession(KEY);
    await s.page.goto(`${PRACTICE_BLOG_ORIGIN}/config/pages`);

    expect(await s.page.locator('input[type="password"]').count()).toBe(1);
  }, 60_000);

  it('laid over the person\'s open browser, keeps what it held and the page it was on', async () => {
    const before = await openBrowserSession(KEY);
    await before.context.addCookies([{ name: 'elsewhere', value: 'kept-too', domain: 'site.northwind-outfitters.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }]);
    await before.page.goto(`${PRACTICE_BLOG_ORIGIN}/`);

    const s = await openWithSignIn(KEY, KEPT);

    expect(s).not.toBe(before);
    expect((await s.context.cookies(PRACTICE_BLOG_ORIGIN)).map(c => c.name).sort()).toEqual(['elsewhere', 'member']);
    expect(s.page.url()).toBe(`${PRACTICE_BLOG_ORIGIN}/`);
  }, 60_000);
});
