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
import { DRAFT_SAVE_WRITES, draftRun, liveRun, postUrlOf, reportedStatus } from './squarespaceTask';

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
  const spec = draftRun(post, PRACTICE_BLOG_SIGN_IN);

  it('signs in to the editor with the password and the article as secrets, so the model reads neither', () => {
    expect(spec.startUrl).toBe('https://site.northwind-outfitters.test/config/pages');
    expect(spec.secretNames).toEqual(['password', 'body_html']);
    expect(spec.inputs).toMatchObject({ email: 'editor@northwind-outfitters.example', post_title: post.title, url_slug: post.slug, blog_path: '/journal', post_url: 'https://site.northwind-outfitters.test/journal/choose-a-three-season-tent' });
    expect(spec.task).toContain('{{password}}');
    expect(spec.task).toContain('{{body_html}}');
    expect(spec.task).not.toContain('Under 2 kg');
    expect(spec.outputs.map(o => o.name)).toEqual(['post_url', 'editor_url', 'status']);
  });

  it('names every field the editor asks for, as 7.1 names them, pastes the body so headings stay, and never publishes', () => {
    for (const words of ['Add blog post', 'Enter a post title…', 'Write here…', 'headings and lists kept', 'Blog Post Settings', 'Post URL', 'Excerpt', 'SEO title', 'SEO description', 'never press PUBLISH', 'already on the site', 'No Title']) {
      expect(spec.task).toContain(words);
    }
  });

  it('may press Save on the draft without stopping, and nothing that publishes', () => {
    const host = 'site.northwind-outfitters.test';

    expect(spec.approvedAhead?.writes).toBe(DRAFT_SAVE_WRITES);
    expect(allowedWrite(DRAFT_SAVE_WRITES, { name: 'Save', host })).toBe(true);
    expect(allowedWrite(DRAFT_SAVE_WRITES, { name: 'save draft', host })).toBe(true);

    for (const name of ['Publish', 'Save & Publish', 'Publish now', 'Schedule', 'Delete']) {
      expect(allowedWrite(DRAFT_SAVE_WRITES, { name, host })).toBe(false);
    }
  });
});

describe('the going-live run', () => {
  it('reopens the draft in the same browser and holds its one click for the person', () => {
    const spec = liveRun(post, 'https://site.northwind-outfitters.test/config/pages/journal/p9');

    expect(spec.startUrl).toBe('https://site.northwind-outfitters.test/config/pages/journal/p9');
    expect(spec.approvedAhead).toBeNull();
    expect(spec.secretNames).toEqual([]);
    expect(spec.task).toContain('waits for the person\'s approval');
    expect(needsApproval({ role: 'button', name: 'Publish' })).toBe(true);
    expect(needsApproval({ role: 'button', name: 'Save' })).toBe(true);
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

    for (const words of ['Log In', 'Add blog post', 'Enter a post title…', 'Write here...', 'Blog Post Settings', 'Post URL', 'Excerpt', 'SEO title', 'SEO description', '>Save<', '>PUBLISH<', 'Practice site · fictional data']) {
      expect(page?.body).toContain(words);
    }

    expect(page?.body).toContain(PRACTICE_BLOG_SIGN_IN.password);
    expect(practiceResponse('https://example-site.squarespace.com/config')).toBeNull();
  });
});
