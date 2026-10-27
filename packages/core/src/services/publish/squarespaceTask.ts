/**
 * THE SQUARESPACE PUBLISH, AS BROWSER RUNS (`services/browser/BrowserRunService.ts`).
 * Squarespace has no API for posts (`libs/sources/squarespace.ts`), so a post
 * is written the way a person writes one: in the site's editor. Two cards, two
 * kinds of run:
 *
 * 1. **The draft** (`site.publish_page`). Approving the card starts it and is
 *    the approval for its writes, enforced by the engine (`ApprovedAhead`):
 *    starting a post, and Save only while the editor shows the post as a draft
 *    (`Post · Draft`), read off the page at the click. Any click or choice
 *    naming Publish or Schedule waits for the person whatever its role. It
 *    signs in with the stored login (secret inputs: the model types
 *    `{{password}}` and never reads it), finds this page's own post by its URL
 *    slug or adds one, writes the title, the body (pasted as HTML, so headings
 *    stay headings), the excerpt, the SEO title and description and the URL
 *    slug, and saves it as a draft.
 * 2. **Going live** (`site.publish_live`). One card lists the drafted posts;
 *    approving it is the approval for each run's one Publish click, on its own
 *    post, run one after another.
 *
 * The body travels as a secret input too, rendered as HTML: the engine pastes
 * `{{body_html}}` into the editor the way a person pastes formatted text, so
 * headings and lists stay what they are, and the model reads the editor, not a
 * 2,000-word article on every step. Pure: the task text, inputs and outputs,
 * for the action and for a test to read.
 */

import type { ApprovedAhead } from '@/services/browser/browserLoop';

const exact = (buttons: string[]) => buttons.map(button => ({ button, match: 'exact' as const }));

/** Starting a post: Squarespace 7.1 names its button "Add blog post", which reads as consequential ("post"). */
export const DRAFT_START_WRITES: ApprovedAhead['writes'] = exact(['Add blog post', 'Add post', 'New post', 'Create post']);

/** Saving: approved ahead only while the editor shows the post as a draft. */
export const DRAFT_SAVE_WRITES: ApprovedAhead['writes'] = exact(['Save', 'Save draft', 'Save as draft', 'Save and exit', 'Save & exit']);

/** What the editor shows for a post that is a draft, in its top bar. */
export const DRAFT_STATE_TEXT = 'Post · Draft';

/** Words that hold a click or a choice in the draft run whatever its role: the ways a post goes live. */
export const DRAFT_ALWAYS_HOLD = ['publish', 'schedule'];

/** The draft run's approval, as the engine enforces it. */
export const DRAFT_APPROVED_AHEAD: ApprovedAhead = {
  reason: 'the publish approved on Review',
  writes: DRAFT_START_WRITES,
  whilePageShows: { text: DRAFT_STATE_TEXT, writes: DRAFT_SAVE_WRITES },
  alwaysHold: DRAFT_ALWAYS_HOLD,
};

/** The first line of every publish run's task, so a queue of them can be told from the person's other runs. */
const DRAFT_OPENER = 'Save a blog post as a DRAFT on the Squarespace site';
const LIVE_OPENER = 'Publish the drafted blog post';

/**
 * Whether a browser run's task is one of the publish runs written here.
 * @param task - The run's task.
 */
export function isPublishTask(task: string): boolean {
  return task.startsWith(DRAFT_OPENER) || task.startsWith(LIVE_OPENER);
}

/** What a Squarespace post is made of, as the editor asks for it. */
export type SquarespacePost = {
  siteUrl: string;
  blogPath: string;
  title: string;
  slug: string;
  /** The body rendered as HTML: pasted into the editor, so headings stay headings. */
  bodyHtml: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
};

/** A browser run, ready for `createBrowserRun`. */
export type PublishRunSpec = {
  task: string;
  startUrl: string;
  inputs: Record<string, string>;
  secretNames: string[];
  outputs: Array<{ name: string; description: string }>;
  approvedAhead: ApprovedAhead | null;
};

function site(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * The address a post will have once it is live: the blog and the slug.
 * @param post - The post.
 */
export function postUrlOf(post: Pick<SquarespacePost, 'siteUrl' | 'blogPath' | 'slug'>): string {
  return `${site(post.siteUrl)}${post.blogPath}/${post.slug}`;
}

/**
 * The draft run: sign in, write the post, save it as a draft.
 * @param post - The post.
 * @param login - The editor login, from the vault.
 * @param login.email - The account's email.
 * @param login.password - Its password: a secret input.
 */
export function draftRun(post: SquarespacePost, login: { email: string; password: string }): PublishRunSpec {
  const editorUrl = `${site(post.siteUrl)}/config/pages`;
  const task = [
    `${DRAFT_OPENER} ${site(post.siteUrl)}, in its editor. Never publish it in this task.`,
    `1. Open ${editorUrl}. If asked to log in, type the email input and {{password}}, and log in. If Squarespace asks for a verification code, ask the person for it. Close any cookie banner, "What's new" or tips dialog in the way.`,
    `2. This page's post is the one at ${postUrlOf(post)}, by its URL slug, whatever its title. Open that address: signed in, a draft shows too. If it shows a post, it is this page's own: press Edit on it and update it in place. If it is published or scheduled, stop and give_up saying it is already live. If it says the page is not found, go to the Pages panel, open the blog whose address is ${post.blogPath} (marked Blog), and press Add blog post: Squarespace creates the draft at once. Never open or change any other post, a "No Title" draft included.`,
    '3. The post shows in the page preview. If the preview has an Edit button, press it: the top bar then shows PUBLISH, Save and Exit. Click the title ("Enter a post title…") and type the post_title input once; it goes in whole.',
    '4. Click the body ("Write here…") and type {{body_html}} exactly as written, with the braces: the browser pastes the article in, headings and lists kept. Do not retype it or type it anywhere else.',
    '5. Open Blog Post Settings: click the post\'s name and status in the middle of the top bar (press Escape first if the page preview has the focus). Content: set Excerpt to the excerpt input, and further down set Post URL to the blog path and the url_slug input, e.g. /blog/the-slug. SEO: set SEO title to seo_title and SEO description to seo_description. Then press SAVE (or CLOSE) at the top left of that panel.',
    '6. The post must stay a Draft: never press PUBLISH, never choose Published or Scheduled. Press Escape, then Save in the top bar. The top bar should then show the title and "Post · Draft".',
    'If a click fails twice, look at the page again instead of repeating it: the element has moved or a panel is open.',
    '7. Finish with the outputs: post_url is the address it will have when live, editor_url is the address the editor shows the post at, post_slug is the URL slug the post settings show, status is the status the editor shows after saving (draft).',
  ].join('\n');
  return {
    task,
    startUrl: editorUrl,
    inputs: {
      site_url: site(post.siteUrl),
      blog_path: post.blogPath,
      email: login.email,
      password: login.password,
      post_title: post.title,
      url_slug: post.slug,
      excerpt: post.excerpt,
      seo_title: post.seoTitle,
      seo_description: post.seoDescription,
      body_html: post.bodyHtml,
      post_url: postUrlOf(post),
    },
    secretNames: ['password', 'body_html'],
    outputs: [
      { name: 'post_url', description: 'The address the post will have once live' },
      { name: 'editor_url', description: 'The editor address the draft is open at' },
      { name: 'post_slug', description: 'The URL slug the post\'s settings show' },
      { name: 'status', description: 'The post\'s status as the editor shows it after saving: draft, published or other' },
    ],
    approvedAhead: DRAFT_APPROVED_AHEAD,
  };
}

/** The buttons a going-live run presses, approved by the go-live card. */
export const LIVE_WRITES: ApprovedAhead['writes'] = exact(['Publish', 'Publish now', 'Publish post', 'Confirm']);

/**
 * The going-live run: open this page's own draft, by its slug, and publish it.
 * The go-live card's approval covers its Publish click, and only while this
 * post's title is on the page.
 * @param post - The post.
 */
export function liveRun(post: Pick<SquarespacePost, 'siteUrl' | 'blogPath' | 'title' | 'slug'>): PublishRunSpec {
  const start = postUrlOf(post);
  const task = [
    `${LIVE_OPENER} "${post.title}" on the Squarespace site ${site(post.siteUrl)}.`,
    `1. Open ${start}: signed in, the draft shows there. If asked to log in, stop and give_up saying the sign-in expired. If it is not found, or it is already published, give_up and say so.`,
    '2. Press Edit if the preview has it, then press PUBLISH in the top bar (and Publish or Confirm if it asks). Publish only this post.',
    '3. Finish with the outputs: status is published when the top bar shows it published, else draft; post_url is its public address.',
  ].join('\n');
  return {
    task,
    startUrl: start,
    inputs: { site_url: site(post.siteUrl), blog_path: post.blogPath, post_title: post.title, post_url: postUrlOf(post) },
    secretNames: [],
    outputs: [
      { name: 'status', description: 'published, or draft when it was not published' },
      { name: 'post_url', description: 'The post\'s public address' },
    ],
    approvedAhead: { reason: 'going live approved on Review', writes: [], whilePageShows: { text: post.title, writes: LIVE_WRITES } },
  };
}

/**
 * The status a run reported, in one word: published, draft, or unknown.
 * @param result - The run's outputs.
 */
export function reportedStatus(result: Record<string, unknown> | null): 'published' | 'draft' | 'unknown' {
  const raw = typeof result?.status === 'string' ? result.status.trim().toLowerCase() : '';
  return raw.startsWith('publish') ? 'published' : raw.startsWith('draft') ? 'draft' : 'unknown';
}
