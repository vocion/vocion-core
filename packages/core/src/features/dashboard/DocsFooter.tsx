import type { DocEntry } from '@/libs/docs';
import { ArrowLeft, ArrowRight, Pencil } from 'lucide-react';
import Link from 'next/link';
import { AppConfig } from '@/utils/AppConfig';

type Props = {
  currentEntry: DocEntry;
  entries: DocEntry[];
  /** `/docs` (public) or `/dashboard/docs` (auth). */
  linkBase: string;
};

/**
 * Per-page footer: Edit-on-GitHub + Prev/Next within the same group.
 * Sidebar order (nav_order then path) drives the sequence so it matches
 * what a reader sees in the sidebar.
 * @param root0
 * @param root0.currentEntry
 * @param root0.entries
 * @param root0.linkBase
 */
export function DocsFooter({ currentEntry, entries, linkBase }: Props) {
  const sameGroup = entries.filter(e => e.group === currentEntry.group);
  const idx = sameGroup.findIndex(e => e.path === currentEntry.path);
  const prev = idx > 0 ? sameGroup[idx - 1] : null;
  const next = idx >= 0 && idx < sameGroup.length - 1 ? sameGroup[idx + 1] : null;

  const editHref = `${AppConfig.githubRepoUrl}/edit/${AppConfig.githubMainBranch}/${currentEntry.path}`;

  return (
    <footer className="mt-12 space-y-6 border-t border-border pt-6 text-sm">
      <a
        href={editHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit this page on GitHub
      </a>

      {(prev || next) && (
        <nav className="grid gap-3 sm:grid-cols-2" aria-label="Page navigation">
          {prev
            ? (
                <Link
                  href={prev.slug === '' ? linkBase : `${linkBase}/${prev.slug}`}
                  className="group flex flex-col gap-1 rounded-md border border-border p-4 transition hover:border-primary"
                >
                  <span className="inline-flex items-center gap-1 text-xs tracking-wide text-muted-foreground uppercase">
                    <ArrowLeft className="h-3 w-3" />
                    Previous
                  </span>
                  <span className="font-display group-hover:text-primary">{prev.title}</span>
                </Link>
              )
            : <div />}
          {next
            ? (
                <Link
                  href={next.slug === '' ? linkBase : `${linkBase}/${next.slug}`}
                  className="group flex flex-col items-end gap-1 rounded-md border border-border p-4 text-right transition hover:border-primary"
                >
                  <span className="inline-flex items-center gap-1 text-xs tracking-wide text-muted-foreground uppercase">
                    Next
                    <ArrowRight className="h-3 w-3" />
                  </span>
                  <span className="font-display group-hover:text-primary">{next.title}</span>
                </Link>
              )
            : <div />}
        </nav>
      )}
    </footer>
  );
}
