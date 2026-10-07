'use client';

import type { Chip } from '@/components/patterns';
import { useTranslations } from 'next-intl';
import { ChipRow } from '@/components/patterns';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { mergeSearch } from './searchParams';

/** A workspace as the scope's chips show it. */
export type ScopeWorkspace = { id: string; name: string; count: number; kind: 'shared' | 'personal' };

/**
 * This workspace, or every workspace the person reaches (`?scope=all`) — and,
 * across workspaces, one chip per workspace with its count (`?workspace=<id>`).
 * Writes the URL and nothing else, like `InboxControls`, so the view is a link
 * a person can paste. Switching scope drops the other scope's filters.
 * @param props - What the scope shows.
 * @param props.scope - Which view is showing.
 * @param props.workspaces - Across workspaces: each one read, with its count.
 * @param props.workspace - The workspace chip that is on, if any.
 * @param props.total - Every open decision across them.
 */
export function InboxScope({ scope, workspaces = [], workspace, total = 0 }: { scope: 'here' | 'all'; workspaces?: ScopeWorkspace[]; workspace?: string; total?: number }) {
  const t = useTranslations('Inbox');
  const router = useRouter();
  const pathname = usePathname();

  const go = (patch: Record<string, string | null>, keep: boolean) => {
    const current = keep && typeof window !== 'undefined' ? window.location.search : '';
    const s = mergeSearch(current, patch);
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const chips: Chip[] = [
    { key: 'all', label: t('all'), count: total, active: !workspace, pinned: true, onToggle: () => go({ workspace: null }, true) },
    ...workspaces.map<Chip>(w => ({
      key: w.id,
      label: w.kind === 'personal' ? t('scope_personal') : w.name,
      count: w.count,
      active: workspace === w.id,
      onToggle: () => go({ workspace: workspace === w.id ? null : w.id }, true),
    })),
  ];

  return (
    <div className="space-y-3">
      <nav aria-label={t('scope_label')} className="flex h-9 w-fit items-stretch rounded-md border border-border p-0.5 text-sm">
        {(['here', 'all'] as const).map(s => (
          <button
            key={s}
            type="button"
            aria-current={scope === s ? 'page' : undefined}
            onClick={() => go({ scope: s === 'all' ? 'all' : null }, false)}
            className={`inline-flex items-center rounded-[5px] px-3 transition ${scope === s ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t(s === 'all' ? 'scope_all' : 'scope_here')}
          </button>
        ))}
      </nav>
      {scope === 'all' && workspaces.length > 1 && (
        <div data-testid="inbox-workspace-filter">
          <ChipRow chips={chips} size="md" label={t('filter_workspace')} />
        </div>
      )}
    </div>
  );
}
