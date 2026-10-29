/**
 * The Squarespace publish runs, read without a browser: what each run is told,
 * what it may press without stopping, and the practice editor it can be run
 * against end to end. Every site, name and login is fictional.
 */
import { describe, expect, it } from 'vitest';
import { needsApproval } from '@/libs/browser/run';
import { allowedWrite } from '@/services/browser/browserLoop';
import { PRACTICE_BLOG_ORIGIN, PRACTICE_BLOG_PATH, PRACTICE_BLOG_SIGN_IN } from '@/services/browser/practiceBlog';
import { practiceResponse } from '@/services/browser/practiceSite';
import { DRAFT_SAVE_WRITES, DRAFT_START_WRITES, draftRun, isPublishTask, liveRun, postUrlOf, reportedStatus } from './squarespaceTask';

const post = {
  siteUrl: `${PRACTICE_BLOG_ORIGIN}/`,
  blogPath: PRACTICE_BLOG_PATH,
  title: 'How to Choose a Three-Season Tent',
  slug: 'choose-a-three-season-tent',
  bodyHtml: '<h2>Weight</h2><p>Under 2 kg for two people.</p><h2>Weather</h2><p>A full-coverage fly.</p>',
  excerpt: 'What matters, what does not, and what to spend.',
  seoTitle: 'How to Choose a Three-Season Tent',
  seoDescription: 'What matters, what does not, and what to spend.',
};

describe('the draft run', () => {
  const spec = draftRun(post, { kept: false, login: PRACTICE_BLOG_SIGN_IN });

  it('signs in to the editor with the password and the article as secrets, so the model reads neither', () => {
    expect(spec.startUrl).toBe('https://site.northwind-outfitters.test/config/pages');
    expect(spec.secretNames).toEqual(['password', 'body_html']);
    expect(spec.inputs).toMatchObject({ email: 'editor@northwind-outfitters.example', post_title: post.title, url_slug: post.slug, blog_path: '/journal', post_url: 'https://site.northwind-outfitters.test/journal/choose-a-three-season-tent' });
    expect(spec.task).toContain('{{password}}');
    expect(spec.task).toContain('{{body_html}}');
    expect(spec.task).not.toContain('Under 2 kg');
    expect(spec.outputs.map(o => o.name)).toEqual(['post_url', 'editor_url', 'post_slug', 'status', 'sign_in']);
  });

  it('finds this page\'s own post by its slug, names every field as 7.1 names them, and never publishes', () => {
    for (const words of ['by its URL slug, whatever its title', 'Never open or change any other post', 'Add blog post', 'Enter a post title…', 'Write here…', 'headings and lists kept', 'Blog Post Settings', 'Post URL', 'Excerpt', 'SEO title', 'SEO description', 'never press PUBLISH', 'already live']) {
      expect(spec.task).toContain(words);
    }
  });

  it('may start a post, and Save only while the editor shows a draft; never anything that publishes', () => {
    const host = 'site.northwind-outfitters.test';

    expect(spec.approvedAhead?.writes).toBe(DRAFT_START_WRITES);
    expect(spec.approvedAhead?.whilePageShows).toEqual({ text: 'Post · Draft', writes: DRAFT_SAVE_WRITES });
    expect(spec.approvedAhead?.alwaysHold).toEqual(['publish', 'schedule']);
    expect(allowedWrite(DRAFT_START_WRITES, { name: 'Add blog post', host })).toBe(true);
    expect(allowedWrite(DRAFT_SAVE_WRITES, { name: 'Save', host })).toBe(true);
    expect(allowedWrite(DRAFT_SAVE_WRITES, { name: 'save draft', host })).toBe(true);

    for (const name of ['Publish', 'PUBLISH', 'Save & Publish', 'Publish now', 'Schedule', 'Delete']) {
      expect(allowedWrite([...DRAFT_START_WRITES, ...DRAFT_SAVE_WRITES], { name, host })).toBe(false);
    }

    expect(isPublishTask(spec.task)).toBe(true);
  });
});

describe('signing in', () => {
  it('starts from a kept sign-in and types the password only if the site asks, once', () => {
    const spec = draftRun(post, { kept: true, login: PRACTICE_BLOG_SIGN_IN });

    expect(spec.task).toContain('starts signed in with a kept Squarespace sign-in');
    expect(spec.task).toContain('log in, once');
    expect(spec.task).toContain('sign_in "refused"');
    expect(spec.secretNames).toEqual(['password', 'body_html']);
  });

  it('with a kept sign-in and no stored login, asks for no password and gives up on the login page', () => {
    const spec = draftRun(post, { kept: true, login: null });

    expect(spec.inputs).not.toHaveProperty('password');
    expect(spec.inputs).not.toHaveProperty('email');
    expect(spec.secretNames).toEqual(['body_html']);
    expect(spec.task).not.toContain('{{password}}');
    expect(spec.task).toContain('there is no password to type');
  });

  it('with no kept sign-in still tries the stored password once, as before', () => {
    const spec = draftRun(post, { kept: false, login: PRACTICE_BLOG_SIGN_IN });

    expect(spec.task).not.toContain('kept Squarespace sign-in');
    expect(spec.task).toContain('type the email input and {{password}}, and log in, once');
  });

  it('going live signs in the same way, and owes the same sign_in output', () => {
    const spec = liveRun(post, { kept: true, login: PRACTICE_BLOG_SIGN_IN });

    expect(spec.task).toContain('kept Squarespace sign-in');
    expect(spec.secretNames).toEqual(['password']);
    expect(spec.outputs.map(o => o.name)).toContain('sign_in');
  });
});

describe('the going-live run', () => {
  it('opens this page\'s own draft by its slug, and may press Publish only while that post is on the page', () => {
    const spec = liveRun(post);

    expect(spec.startUrl).toBe('https://site.northwind-outfitters.test/journal/choose-a-three-season-tent');
    expect(spec.approvedAhead?.writes).toEqual([]);
    expect(spec.approvedAhead?.whilePageShows?.text).toBe('How to Choose a Three-Season Tent');
    expect(allowedWrite(spec.approvedAhead!.whilePageShows!.writes, { name: 'Publish', host: 'x' })).toBe(true);
    expect(isPublishTask(spec.task)).toBe(true);
    expect(isPublishTask('Sign in to the portal.')).toBe(false);
    expect(needsApproval({ role: 'button', name: 'Publish' })).toBe(true);
  });

  it('reads a run\'s status in one word', () => {
    expect(reportedStatus({ status: 'Published' })).toBe('published');
    expect(reportedStatus({ status: 'draft' })).toBe('draft');
    expect(reportedStatus(null)).toBe('unknown');
    expect(postUrlOf({ siteUrl: 'https://example-site.squarespace.com/', blogPath: '/blog', slug: 'a-b' })).toBe('https://example-site.squarespace.com/blog/a-b');
  });
});

describe('the practice blog editor', () => {
  it('answers on its own origin with the editor the task describes, and nothing else', () => {
    const page = practiceResponse(`${PRACTICE_BLOG_ORIGIN}/config/pages/journal`);

    expect(page?.status).toBe(200);

    for (const words of ['Log In', 'Add blog post', 'Enter a post title…', 'Write here...', 'Blog Post Settings', 'Post URL', 'Excerpt', 'SEO title', 'SEO description', '>Save<', '>PUBLISH<', 'aria-label="Status"', 'Practice site · fictional data']) {
      expect(page?.body).toContain(words);
    }

    expect(page?.body).toContain(PRACTICE_BLOG_SIGN_IN.password);
    expect(practiceResponse('https://example-site.squarespace.com/config')).toBeNull();
  });
});
