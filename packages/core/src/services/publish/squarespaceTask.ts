/**
 * THE SQUARESPACE PUBLISH, AS BROWSER RUNS (`services/browser/BrowserRunService.ts`).
 * Squarespace has no API for posts (`libs/sources/squarespace.ts`), so a post
 * is written the way a person writes one: in the site's editor. Two runs, two
 * approvals:
 *
 * 1. **The draft.** Approving `site.publish_page` on Review starts it, and is
 *    the approval for its one write: Save on a post whose status is Draft
 *    (`DRAFT_SAVE_WRITES`, approved ahead, sealed with the run's secrets). It
 *    signs in with the stored login (secret inputs: the model types
 *    `{{password}}` and never reads it), opens the blog, adds the post or
 *    reopens the draft of the same title, writes the title, the body (as a
 *    Markdown block, so headings stay headings), the excerpt, the SEO title
 *    and description and the URL slug, and saves it as a draft.
 * 2. **Going live.** Started in the same browser once the draft is saved. It
 *    reopens the draft and presses Publish (or sets Published and saves);
 *    nothing is approved ahead, so the engine holds that click for the person,
 *    with the draft on screen. Declining leaves the draft.
 *
 * The body travels as a secret input too: the engine fills `{{body_markdown}}`
 * in as it types, so the model reads the editor, not a 2,000-word article on
 * every step. Pure: the task text, inputs and outputs, for the action and for
 * a test to read.
 */

import type { ApprovedAhead } from '@/services/browser/browserLoop';

/** The buttons the draft run may press without stopping: saving a post that stays a draft. */
export const DRAFT_SAVE_WRITES: ApprovedAhead['writes'] = ['Save', 'Save draft', 'Save as draft', 'Save and exit', 'Save & exit', 'Create post', 'Create'].map(button => ({ button, match: 'exact' as const }));

/** What a Squarespace post is made of, as the editor asks for it. */
export type SquarespacePost = {
  siteUrl: string;
  blogPath: string;
  title: string;
  slug: string;
  bodyMarkdown: string;
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
    `Save a blog post as a DRAFT on the Squarespace site ${site(post.siteUrl)}, in its editor. Never publish it in this task.`,
    `1. Open ${editorUrl}. If asked to log in, type the email input and {{password}}, and log in. If Squarespace asks for a verification code, ask the person for it. Close any cookie banner, "What's new" or tips dialog in the way.`,
    `2. In the Pages panel open the blog whose address is ${post.blogPath} (it is marked Blog; its name may differ). Its post list opens.`,
    `3. If the list already has a post titled exactly "${post.title}": if it is a draft, open it and replace its content; if it is published or scheduled, stop and give_up saying it is already on the site. Otherwise press the + / Add post / New post button to start a new post.`,
    `4. In the post editor, type the post_title input into the title field ("Enter a post title…").`,
    '5. Body: remove any empty placeholder text, open the insert point or + Add block, choose Markdown, and type {{body_markdown}} into its text area exactly as written, with the braces: the browser fills in the article. Apply or close the block. If the site offers no Markdown block, use a Text block and type {{body_markdown}} there.',
    '6. Open the post\'s settings (Settings, the gear, or … then Settings). Set Post URL to the url_slug input (only the last part, after the blog path). Set Excerpt to the excerpt input. In the SEO tab set SEO title to seo_title and SEO description to seo_description. Close the settings with Done, Apply or Save.',
    '7. Make sure the post\'s status is Draft. Never choose Published, Scheduled or Publish here. Press Save.',
    '8. Finish with the outputs: post_url is the address it will have when live, editor_url is the address of the editor page the post is open in, status is the status the editor shows after saving (draft).',
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
      body_markdown: post.bodyMarkdown,
      post_url: postUrlOf(post),
    },
    secretNames: ['password', 'body_markdown'],
    outputs: [
      { name: 'post_url', description: 'The address the post will have once live' },
      { name: 'editor_url', description: 'The editor address the draft is open at' },
      { name: 'status', description: 'The post\'s status as the editor shows it after saving: draft, published or other' },
    ],
    approvedAhead: { reason: 'the publish approved on Review', writes: DRAFT_SAVE_WRITES },
  };
}

/**
 * The going-live run: reopen the draft and publish it, a click the engine
 * holds for the person.
 * @param post - The post.
 * @param editorUrl - Where the draft run left it, when it said.
 */
export function liveRun(post: Pick<SquarespacePost, 'siteUrl' | 'blogPath' | 'title' | 'slug'>, editorUrl: string | null): PublishRunSpec {
  const start = editorUrl ?? `${site(post.siteUrl)}/config/pages`;
  const task = [
    `Publish the draft blog post "${post.title}" on the Squarespace site ${site(post.siteUrl)}.`,
    `1. Open ${start}. You are signed in from the run that saved the draft; if asked to log in, stop and give_up saying the sign-in expired.`,
    `2. If the post is not already open, open the blog at ${post.blogPath} in the Pages panel and open the post titled exactly "${post.title}". If there is none, or it is already published, give_up and say so.`,
    '3. Publish it: press Publish, or set its status to Published and press Save. That click waits for the person\'s approval. If they decline, leave it a draft.',
    '4. Finish with the outputs: status is published when the editor shows it published, else draft; post_url is its public address.',
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
    approvedAhead: null,
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
