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
 *    starts signed in from the site's kept sign-in (`squarespaceSignIn.ts`);
 *    only when there is none, or it expired, does it type the stored login,
 *    once (secret inputs: the model types `{{password}}` and never reads it),
 *    and a refused login ends the run with `sign_in: refused`, so the page
 *    waits on a person signing in again. It finds this page's own post by its URL
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
import type { RunSignIn } from '@/services/browser/keptSignIn';
import { SIGN_IN_REFUSED } from './squarespaceSignIn';

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
  /** The site's kept sign-in, loaded before the first step and saved back after (`keptSignIn.ts`). */
  keptSignIn?: RunSignIn | null;
};

/** The editor login, from the vault, when one is stored. */
export type SquarespaceLogin = { email: string; password: string };

/** How a publish run signs in: from a kept sign-in, with the stored login, both, or neither. */
export type SignInPlan = { kept: boolean; login: SquarespaceLogin | null };

/** The output every publish run owes about its sign-in, which the settle job routes on. */
const SIGN_IN_OUTPUT = { name: 'sign_in', description: `"${SIGN_IN_REFUSED}" when Squarespace would not sign this browser in (its login page refused the login, or there was no login to type); otherwise "ok"` };

/**
 * The task's words for signing in: start signed in when a sign-in is kept,
 * else type the login once; a refusal ends the run with `sign_in: refused`.
 * @param plan - How it signs in.
 */
function signInStep(plan: SignInPlan): string {
  const start = plan.kept
    ? 'The browser starts signed in with a kept Squarespace sign-in, so the editor should open. If Squarespace shows its login page instead, that sign-in has expired: '
    : 'If Squarespace shows its login page: ';
  const login = plan.login
    ? 'type the email input and {{password}}, and log in, once. If Squarespace asks for a verification code, ask the person for it. If it refuses the login (it says the email or password is incorrect, or will not sign this browser in), do not try again: give_up saying so, with result sign_in "refused".'
    : 'there is no password to type, so give_up at once saying Squarespace needs a fresh sign-in, with result sign_in "refused".';
  return `${start}${login}`;
}

/**
 * The inputs and secrets a sign-in needs: the login only when there is one.
 * @param plan - How it signs in.
 */
function signInInputs(plan: SignInPlan): { inputs: Record<string, string>; secretNames: string[] } {
  return plan.login ? { inputs: { email: plan.login.email, password: plan.login.password }, secretNames: ['password'] } : { inputs: {}, secretNames: [] };
}

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
 * The draft run: start signed in (or sign in), write the post, save it as a draft.
 * @param post - The post.
 * @param signIn - How it signs in: the kept sign-in, the stored login (a secret input), or both.
 */
export function draftRun(post: SquarespacePost, signIn: SignInPlan): PublishRunSpec {
  const editorUrl = `${site(post.siteUrl)}/config/pages`;
  const login = signInInputs(signIn);
  const task = [
    `${DRAFT_OPENER} ${site(post.siteUrl)}, in its editor. Never publish it in this task.`,
    `1. Open ${editorUrl}. ${signInStep(signIn)} Close any cookie banner, "What's new" or tips dialog in the way.`,
    `2. This page's post is the one at ${postUrlOf(post)}, by its URL slug, whatever its title. Open that address: signed in, a draft shows too. If it shows a post, it is this page's own: press Edit on it and update it in place. If it is published or scheduled, stop and give_up saying it is already live. If it says the page is not found, go to the Pages panel, open the blog whose address is ${post.blogPath} (marked Blog), and press Add blog post: Squarespace creates the draft at once. Never open or change any other post, a "No Title" draft included.`,
    '3. The post shows in the page preview. If the preview has an Edit button, press it: the top bar then shows PUBLISH, Save and Exit. Click the title ("Enter a post title…") and type the post_title input once; it goes in whole.',
    '4. Click the body ("Write here…") and type {{body_html}} exactly as written, with the braces: the browser pastes the article in, headings and lists kept. Do not retype it or type it anywhere else.',
    '5. Open Blog Post Settings: click the post\'s name and status in the middle of the top bar (press Escape first if the page preview has the focus). Content: set Excerpt to the excerpt input, and further down set Post URL to the blog path and the url_slug input, e.g. /blog/the-slug. SEO: set SEO title to seo_title and SEO description to seo_description. Then press SAVE (or CLOSE) at the top left of that panel.',
    '6. The post must stay a Draft: never press PUBLISH, never choose Published or Scheduled. Press Escape, then Save in the top bar. The top bar should then show the title and "Post · Draft".',
    'If a click fails twice, look at the page again instead of repeating it: the element has moved or a panel is open.',
    '7. Finish with the outputs: post_url is the address it will have when live, editor_url is the address the editor shows the post at, post_slug is the URL slug the post settings show, status is the status the editor shows after saving (draft), sign_in is ok.',
  ].join('\n');
  return {
    task,
    startUrl: editorUrl,
    inputs: {
      site_url: site(post.siteUrl),
      blog_path: post.blogPath,
      ...login.inputs,
      post_title: post.title,
      url_slug: post.slug,
      excerpt: post.excerpt,
      seo_title: post.seoTitle,
      seo_description: post.seoDescription,
      body_html: post.bodyHtml,
      post_url: postUrlOf(post),
    },
    secretNames: [...login.secretNames, 'body_html'],
    outputs: [
      { name: 'post_url', description: 'The address the post will have once live' },
      { name: 'editor_url', description: 'The editor address the draft is open at' },
      { name: 'post_slug', description: 'The URL slug the post\'s settings show' },
      { name: 'status', description: 'The post\'s status as the editor shows it after saving: draft, published or other' },
      SIGN_IN_OUTPUT,
    ],
    approvedAhead: DRAFT_APPROVED_AHEAD,
  };
}

/** The buttons a going-live run presses, approved by the go-live card. */
export const LIVE_WRITES: ApprovedAhead['writes'] = exact(['Publish', 'Publish now', 'Publish post', 'Confirm']);

/**
 * The going-live run: open this page's own draft, by its slug, and publish it.
 * The go-live card's approval covers its Publish click, and only while this
 * post's title is on the page. Signs in as the draft run does.
 * @param post - The post.
 * @param signIn - How it signs in.
 */
export function liveRun(post: Pick<SquarespacePost, 'siteUrl' | 'blogPath' | 'title' | 'slug'>, signIn: SignInPlan = { kept: false, login: null }): PublishRunSpec {
  const start = postUrlOf(post);
  const login = signInInputs(signIn);
  const task = [
    `${LIVE_OPENER} "${post.title}" on the Squarespace site ${site(post.siteUrl)}.`,
    `1. Open ${start}: signed in, the draft shows there. ${signInStep(signIn)} Then open ${start} again. If it is not found, or it is already published, give_up and say so.`,
    '2. Press Edit if the preview has it, then press PUBLISH in the top bar (and Publish or Confirm if it asks). Publish only this post.',
    '3. Finish with the outputs: status is published when the top bar shows it published, else draft; post_url is its public address; sign_in is ok.',
  ].join('\n');
  return {
    task,
    startUrl: start,
    inputs: { site_url: site(post.siteUrl), blog_path: post.blogPath, post_title: post.title, post_url: postUrlOf(post), ...login.inputs },
    secretNames: login.secretNames,
    outputs: [
      { name: 'status', description: 'published, or draft when it was not published' },
      { name: 'post_url', description: 'The post\'s public address' },
      SIGN_IN_OUTPUT,
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
