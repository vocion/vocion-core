import { dirname, join, normalize } from 'node:path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
};

export function DocViewer({ currentPath, content }: Props) {
  const currentDir = currentPath === 'README.md' ? '' : dirname(currentPath);

  return (
    <article className="prose max-w-none prose-neutral dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            const rewritten = rewriteLink(href ?? '', currentDir);
            if (rewritten.startsWith('/dashboard/docs')) {
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
 */
function rewriteLink(href: string, currentDir: string): string {
  if (!href) {
    return href;
  }
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) {
    return href;
  }
  // Already a /dashboard/docs link — leave it
  if (href.startsWith('/dashboard/docs')) {
    return href;
  }

  // Handle explicit anchors within md files: `./foo.md#section`
  const [pathPart, anchor] = href.split('#', 2);
  if (!pathPart) {
    return href;
  }

  if (!pathPart.endsWith('.md') && !pathPart.endsWith('/')) {
    // Not a markdown link — return as-is (image, PDF, etc.)
    return href;
  }

  const resolved = normalize(join(currentDir, pathPart));
  const slug = resolved.replace(/\/$/, '').replace(/\.md$/, '');
  const url = slug === 'README' ? '/dashboard/docs' : `/dashboard/docs/${slug}`;
  return anchor ? `${url}#${anchor}` : url;
}
