'use client';

import { useLocale } from 'next-intl';
import { ListRow, ListRows } from '@/components/patterns';
import { routing } from '@/libs/I18nRouting';
import { useWorkspaceDirectory } from './useWorkspaceDirectory';
import { filterProjects, projectAccent, workspaceSwitchHref } from './workspaceSwitch';

/**
 * EVERY WORKSPACE THE PERSON CAN OPEN — the switcher's "All workspaces →".
 * Empty ones are listed like any other; archived ones are not (the same rule
 * as the switcher, `filterProjects`). A row opens that workspace's chat.
 */
export function WorkspacesList() {
  const locale = useLocale();
  const directory = useWorkspaceDirectory();
  if (!directory) {
    return <p className="px-1 py-6 text-[13px] text-muted-foreground">Loading…</p>;
  }
  const projects = filterProjects(directory.projects, {});
  if (projects.length === 0) {
    return <p className="px-1 py-6 text-[13px] text-muted-foreground">No workspaces yet.</p>;
  }
  return (
    <ListRows>
      {projects.map(p => (
        <ListRow
          key={p.id}
          title={p.name}
          href={workspaceSwitchHref({ slug: p.slug, pathname: '/dashboard/chat', locale, defaultLocale: routing.defaultLocale })}
          subline={(
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: projectAccent(p.slug) }} aria-hidden />
              {p.agentCount ? `${p.agentCount} ${p.agentCount === 1 ? 'agent' : 'agents'}` : 'No agents yet'}
            </span>
          )}
        />
      ))}
    </ListRows>
  );
}
