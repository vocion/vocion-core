'use client';

/**
 * /dashboard/artifacts — every artifact in the workspace, newest edit first.
 *
 * A single live artifact beside a conversation is only half the model; the
 * other half is being able to find it again a week later. Dense rows, type
 * chips as filters, a folder filter, search, and the conversation it came
 * out of — the List archetype the rest of the dashboard uses.
 *
 * Pinned artifacts (the sidebar's own pin list, `user_nav_pref.pins`) sit at
 * the top: a person who pinned something has already said it is the one they
 * come back to.
 */

import type { ArtifactListItem } from '@/services/ArtifactService';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, ListRows } from '@/components/ui/list-row';
import { cn } from '@/utils/Helpers';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL, authorLabel, relativeTime } from './kinds';

export type ArtifactLogProps = {
  artifacts: ArtifactListItem[];
  folders: Array<{ folder: string; count: number }>;
  /** Nav pin urls, so pinned artifacts float to the top. */
  pins?: string[];
  selfId?: string | null;
};

const KINDS = ['table', 'markdown', 'chart', 'record', 'link', 'file'] as const;

/**
 * Where a row goes: back to its conversation with the artifact open, or the standalone page.
 * @param a
 */
export function artifactHrefFor(a: ArtifactListItem): string {
  return a.conversationId && a.conversationTitle !== null
    ? `/dashboard/chat/${a.conversationId}?artifact=${a.id}`
    : `/dashboard/artifacts/${a.id}`;
}

export function ArtifactLog({ artifacts, folders, pins = [], selfId }: ArtifactLogProps) {
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<Set<string>>(() => new Set());
  const [folder, setFolder] = useState<string | null>(null);

  const pinned = useMemo(() => new Set(pins.filter(p => p.includes('/dashboard/artifacts/')).map(p => Number(p.split('/dashboard/artifacts/')[1]?.split(/[?#]/)[0]))), [pins]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return artifacts
      .filter(a => (kinds.size === 0 || kinds.has(a.kind))
        && (folder === null || a.folder === folder || (a.folder ?? '').startsWith(`${folder}/`))
        && (q === '' || a.title.toLowerCase().includes(q) || (a.folder ?? '').includes(q)))
      .sort((x, y) => Number(pinned.has(y.id)) - Number(pinned.has(x.id)));
  }, [artifacts, query, kinds, folder, pinned]);

  const toggleKind = (k: string) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (!next.delete(k)) {
        next.add(k);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-48 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search artifacts"
            className="h-8 w-full rounded-lg border border-border bg-background pr-2 pl-7 text-sm focus:border-foreground/30 focus:outline-none"
            aria-label="Search artifacts"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by type">
          {KINDS.map((k) => {
            const on = kinds.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                aria-pressed={on}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[12px] transition',
                  on ? 'border-foreground/40 bg-muted text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {ARTIFACT_KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
      </div>

      {folders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by folder">
          <button
            type="button"
            onClick={() => setFolder(null)}
            aria-pressed={folder === null}
            className={cn('rounded-full border px-2.5 py-0.5 text-[12px]', folder === null ? 'border-foreground/40 bg-muted text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            All folders
          </button>
          {folders.map(f => (
            <button
              key={f.folder}
              type="button"
              onClick={() => setFolder(f.folder === folder ? null : f.folder)}
              aria-pressed={f.folder === folder}
              className={cn('rounded-full border px-2.5 py-0.5 text-[12px]', f.folder === folder ? 'border-foreground/40 bg-muted text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {f.folder}
              <span className="ml-1 text-muted-foreground">{f.count}</span>
            </button>
          ))}
        </div>
      )}

      {rows.length === 0
        ? (
            <div className="mt-6">
              <EmptyState
                icon={ARTIFACT_KIND_ICON.markdown}
                title={artifacts.length === 0 ? 'No artifacts yet' : 'Nothing matches those filters'}
                description={artifacts.length === 0 ? 'Ask an agent for a table, a plan or a chart — it opens beside the conversation and lands here.' : 'Clear a chip or the search box.'}
              />
            </div>
          )
        : (
            <ListRows>
              {rows.map((a) => {
                const Icon = ARTIFACT_KIND_ICON[a.kind];
                return (
                  <ListRow
                    key={a.id}
                    href={artifactHrefFor(a)}
                    icon={Icon}
                    title={(
                      <span className="flex items-center gap-2">
                        {pinned.has(a.id) && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">Pinned</span>}
                        <span className="truncate">{a.title}</span>
                      </span>
                    )}
                    meta={(
                      <>
                        {ARTIFACT_KIND_LABEL[a.kind]}
                        {' · v'}
                        {a.version}
                        {a.versions > 1 ? ` (${a.versions} versions)` : ''}
                        {' · '}
                        {authorLabel(a.authorKind, a.authorId, selfId)}
                        {' · '}
                        {relativeTime(a.updatedAt)}
                        {a.folder ? ` · ${a.folder}` : ''}
                        {a.conversationTitle ? ` · from “${a.conversationTitle}”` : ''}
                      </>
                    )}
                  />
                );
              })}
            </ListRows>
          )}
    </div>
  );
}
