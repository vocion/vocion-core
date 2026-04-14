import type { DocEntry } from '@/libs/docs';
import Link from 'next/link';

type Props = {
  entries: DocEntry[];
  currentSlug: string;
};

/**
 * Left-rail nav for the docs viewer. Groups by directory (`root`, `docs`,
 * `requirements`, `requirements/metacto`, `context`) and highlights the
 * current page.
 * @param root0
 * @param root0.entries
 * @param root0.currentSlug
 */
export function DocsSidebar({ entries, currentSlug }: Props) {
  const groups = groupBy(entries);

  return (
    <nav className="space-y-6 text-sm">
      {groups.map(([group, items]) => (
        <div key={group}>
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {labelFor(group)}
          </div>
          <ul className="space-y-0.5">
            {items.map(entry => (
              <li key={entry.path}>
                <Link
                  href={entry.slug === '' ? '/dashboard/docs' : `/dashboard/docs/${entry.slug}`}
                  className={
                    entry.slug === currentSlug
                      ? 'block rounded bg-accent px-2 py-1 font-medium text-accent-foreground'
                      : 'block rounded px-2 py-1 text-foreground/80 hover:bg-muted hover:text-foreground'
                  }
                >
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function groupBy(entries: DocEntry[]): Array<[string, DocEntry[]]> {
  const map = new Map<string, DocEntry[]>();
  for (const e of entries) {
    if (!map.has(e.group)) {
      map.set(e.group, []);
    }
    map.get(e.group)!.push(e);
  }
  return [...map.entries()];
}

function labelFor(group: string): string {
  switch (group) {
    case 'root': return 'Start here';
    case 'docs': return 'Platform dev docs';
    case 'requirements': return 'Platform requirements';
    case 'requirements/metacto': return 'MetaCTO case studies';
    case 'context': return 'Context authoring';
    default: return group;
  }
}
