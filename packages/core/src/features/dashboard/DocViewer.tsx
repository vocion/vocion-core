import { dirname, join, normalize } from 'node:path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import { remarkCallouts } from '@/libs/docs/remark-callouts';

// NOTE: `rehype-pretty-code` (Shiki) is async-only; `react-markdown@10`
// runs `unified.runSync()` which can't process async plugins. Syntax
// highlighting is deferred until we migrate this surface off
// `react-markdown` onto an async unified pipeline (next refactor).

/**
 * In-product markdown viewer. Server component — renders MD content with:
 *   - GitHub-flavored markdown (tables, task lists, strikethrough)
 *   - Link rewriting: relative `.md` links become `/dashboard/docs/<slug>`
 *   - Heading anchors (future)
 *   - Code blocks styled via Tailwind prose
 */

type Props = {
  /** Repo-relative path of the current doc, e.g. `docs/mcp.md` or `README.md` */
  currentPath: string;
  content: string;
  /** Base URL for rewritten cross-doc links. `/dashboard/docs` (in-app) or `/docs` (public). */
  linkBase?: string;
};

export function DocViewer({ currentPath, content, linkBase = '/dashboard/docs' }: Props) {
  const currentDir = currentPath === 'README.md' ? '' : dirname(currentPath);

  return (
    <article className="prose max-w-none prose-neutral dark:prose-invert" data-pagefind-body>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkCallouts]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a: ({ href, children, ...rest }) => {
            const rewritten = rewriteLink(href ?? '', currentDir, linkBase);
            if (rewritten.startsWith(linkBase)) {
              return <Link href={rewritten}>{children}</Link>;
            }
            return (
              <a href={rewritten} target={rewritten.startsWith('http') ? '_blank' : undefined} rel={rewritten.startsWith('http') ? 'noreferrer' : undefined} {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

/**
 * Turn a relative `.md` link into a `/dashboard/docs/<slug>` URL.
 * External (http/https/mailto) and absolute-to-root links pass through.
 * @param href
 * @param currentDir
 * @param linkBase
 */
function rewriteLink(href: string, currentDir: string, linkBase: string): string {
  if (!href) {
    return href;
  }
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) {
    return href;
  }
  if (href.startsWith(linkBase)) {
    return href;
  }

  const [pathPart, anchor] = href.split('#', 2);
  if (!pathPart) {
    return href;
  }

  if (!pathPart.endsWith('.md') && !pathPart.endsWith('/')) {
    return href;
  }

  const resolved = normalize(join(currentDir, pathPart));
  const slug = resolved.replace(/\/$/, '').replace(/\.md$/, '');
  const url = slug === 'README' ? linkBase : `${linkBase}/${slug}`;
  return anchor ? `${url}#${anchor}` : url;
}
