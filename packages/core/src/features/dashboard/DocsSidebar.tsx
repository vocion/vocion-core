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
 * their own top-level nav block. Supports arbitrary nesting depth.
 */
const PARENT_OF: Record<string, string> = {};

/**
 * Left-rail nav for the docs viewer. Top-level groups get a section
 * header; child groups render indented under their parent's block.
 * Recurses so grandchildren (e.g. per-agent case-study folders) nest
 * properly under their case-studies parent.
 * @param root0
 * @param root0.entries
 * @param root0.currentSlug
 * @param root0.publicBasePath
 */
export function DocsSidebar({ entries, currentSlug, publicBasePath = '/dashboard/docs' }: Props) {
  const filtered = entries.filter(e => keepInSidebar(e));
  const groups = groupBy(filtered);
  const groupMap = new Map(groups);
  const topLevelGroups = groups
    .map(([g]) => g)
    .filter(g => !(g in PARENT_OF) || !groupMap.has(PARENT_OF[g]!));

  return (
    <nav className="space-y-6 text-sm">
      {topLevelGroups.map(group => (
        <GroupBlock
          key={group}
          group={group}
          groupMap={groupMap}
          currentSlug={currentSlug}
          publicBasePath={publicBasePath}
          depth={0}
        />
      ))}
    </nav>
  );
}

function GroupBlock({
  group,
  groupMap,
  currentSlug,
  publicBasePath,
  depth,
}: {
  group: string;
  groupMap: Map<string, DocEntry[]>;
  currentSlug: string;
  publicBasePath: string;
  depth: number;
}) {
  const items = groupMap.get(group) ?? [];
  const children = Object.entries(PARENT_OF)
    .filter(([, parent]) => parent === group)
    .map(([child]) => child)
    .filter(child => groupMap.has(child));

  const headingClass = depth === 0
    ? 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'
    : 'mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70';

  const wrapperClass = depth === 0 ? '' : 'mt-3 border-l border-border/60 pl-3';

  return (
    <div className={wrapperClass}>
      <div className={headingClass}>{labelFor(group)}</div>
      {items.length > 0 && (
        <ul className="space-y-0.5">
          {items.map(entry => (
            <li key={entry.path}>
              <DocLink entry={entry} currentSlug={currentSlug} publicBasePath={publicBasePath} />
            </li>
          ))}
        </ul>
      )}
      {children.map(child => (
        <GroupBlock
          key={child}
          group={child}
          groupMap={groupMap}
          currentSlug={currentSlug}
          publicBasePath={publicBasePath}
          depth={depth + 1}
        />
      ))}
    </div>
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
    case 'roadmap': return 'Roadmap';
    case 'docs/internal': return 'Internal';
    case 'docs/internal/use-cases': return 'Use cases';
    default: return group;
  }
}

/**
 * Per-folder README.md files are hidden — the group header already labels
 * the section. The root README is the project README, so keep it.
 * @param entry
 */
function keepInSidebar(entry: DocEntry): boolean {
  if (entry.path === 'README.md') {
    return true;
  }
  return !entry.path.endsWith('/README.md');
}
