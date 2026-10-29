/**
 * The page file a GitHub target writes, with its frontmatter as YAML. Apart
 * from `targets.ts` so the target's schema (read by the Publishing editor in
 * the browser) never pulls the YAML writer into a client bundle.
 */

import type { GithubTarget, PageFields, PageFormat } from './targets';
import { stringify } from 'yaml';
import { bodyWithoutTitle, escapeForMdx, fillTemplate, formatOf, renderFrontmatter, stripBylineBlock } from './targets';

/**
 * The file a page becomes on a GitHub target: where it goes, and its whole
 * text — the target's frontmatter template filled in, then the body in the
 * target's format. An `html` target is handed the body already rendered
 * (`html`), since rendering markdown is the server's job.
 * @param target - The GitHub target.
 * @param page - The page.
 * @param body - The draft.
 * @param body.markdown - The draft's markdown.
 * @param body.html - The draft rendered as HTML, for an html target.
 */
export function renderPageFile(target: GithubTarget, page: PageFields, body: { markdown: string; html?: string }): { path: string; format: PageFormat; content: string } {
  const format = formatOf(target);
  const path = fillTemplate(target.config.path, page);
  const template = target.config.frontmatter ?? {};
  const frontmatter = renderFrontmatter(template, page);
  // Strings quoted: "July 8, 2026" or "2026-07-08" stays the string the site's schema reads, never a YAML date.
  const head = Object.keys(frontmatter).length > 0 ? `---\n${stringify(frontmatter, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' }).trimEnd()}\n---\n\n` : '';
  const markdown = bodyWithoutTitle(stripBylineBlock(body.markdown), template);
  if (format === 'html') {
    if (body.html === undefined) {
      throw new Error('an html target needs the body rendered as HTML');
    }
    return { path, format, content: `${head}${body.html.trim()}\n` };
  }
  return { path, format, content: `${head}${format === 'mdx' ? escapeForMdx(markdown) : markdown}\n` };
}
