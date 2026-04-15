import type { DocEntry } from '@/libs/docs';
import Link from 'next/link';

type Props = {
  entries: DocEntry[];
  currentSlug: string;
  /** Base route for generated links — `/dashboard/docs` (in-app) or `/docs` (public). */
  publicBasePath?: string;
};

/**
 * Parent-child relationships between groups — used to render child
 * groups indented under their parent's section header instead of as
 * their own top-level nav block.
 */
const PARENT_OF: Record<string, string> = {
  'docs/internal/case-studies': 'docs/internal',
};

/**
 * Left-rail nav for the docs viewer. Top-level groups get a section
 * header; child groups (e.g. `case-studies` under `docs/internal`) get
 * an indented subheader under their parent instead of a separate block.
 * @param root0
 * @param root0.entries
 * @param root0.currentSlug
 * @param root0.publicBasePath
 */
export function DocsSidebar({ entries, currentSlug, publicBasePath = '/dashboard/docs' }: Props) {
  const groups = groupBy(entries);
  const groupMap = new Map(groups);
  const renderedAsChild = new Set(Object.keys(PARENT_OF));

  return (
    <nav className="space-y-6 text-sm">
      {groups
        .filter(([group]) => !renderedAsChild.has(group) || !groupMap.has(PARENT_OF[group]!))
        .map(([group, items]) => {
          const childGroups = Object.entries(PARENT_OF)
            .filter(([, parent]) => parent === group)
            .map(([child]) => child)
            .filter(child => groupMap.has(child));

          return (
            <div key={group}>
              <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {labelFor(group)}
              </div>
              <ul className="space-y-0.5">
                {items.map(entry => (
                  <li key={entry.path}>
                    <DocLink entry={entry} currentSlug={currentSlug} publicBasePath={publicBasePath} />
                  </li>
                ))}
              </ul>
              {childGroups.map(child => (
                <div key={child} className="mt-3 border-l border-border/60 pl-3">
                  <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                    {labelFor(child)}
                  </div>
                  <ul className="space-y-0.5">
                    {(groupMap.get(child) ?? []).map(entry => (
                      <li key={entry.path}>
                        <DocLink entry={entry} currentSlug={currentSlug} publicBasePath={publicBasePath} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          );
        })}
    </nav>
  );
}

function DocLink({ entry, currentSlug, publicBasePath }: { entry: DocEntry; currentSlug: string; publicBasePath: string }) {
  return (
    <Link
      href={entry.slug === '' ? publicBasePath : `${publicBasePath}/${entry.slug}`}
      className={
        entry.slug === currentSlug
          ? 'block rounded bg-accent px-2 py-1 font-medium text-accent-foreground'
          : 'block rounded px-2 py-1 text-foreground/80 hover:bg-muted hover:text-foreground'
      }
    >
      {entry.title}
    </Link>
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
    case 'get-started': return 'Get started';
    case 'docs/concepts': return 'Concepts';
    case 'docs/guides': return 'Guides';
    case 'docs/api': return 'API';
    case 'docs/reference': return 'Reference';
    case 'root': return 'Start here';
    case 'docs': return 'Overview';
    case 'requirements': return 'Platform spec';
    case 'docs/internal': return 'Roadmap & ops';
    case 'docs/internal/case-studies': return 'Case studies';
    default: return group;
  }
}
