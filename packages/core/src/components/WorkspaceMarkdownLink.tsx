'use client';

import { Link } from '@/libs/I18nNavigation';

/**
 * Internal document links retain the same workspace and app as their reader.
 * @param root0
 * @param root0.href
 * @param root0.children
 */
export function WorkspaceMarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return href?.startsWith('/') && !href.startsWith('//')
    ? <Link href={href}>{children}</Link>
    : <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}
