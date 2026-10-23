'use client';

import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import type { AppNav } from '@/features/navigation/apps';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { appMissingHere, workspaceLanding } from '@/features/navigation/apps';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { routing } from '@/libs/I18nRouting';
import { client } from '@/libs/Orpc';
import { useWorkspaceSlug } from '@/libs/workspaceSlug';
import { placeIn } from './workspaceMemory';
import { crossAccountSlug, WORKSPACE_HOME, workspaceSwitchHref } from './workspaceSwitch';

/** An app this workspace lacks, with what it owns (`appsElsewhere`). */
export type ElsewhereApp = Pick<AppNav, 'id' | 'name' | 'core' | 'owns'>;

/**
 * A deep link into an app this workspace does not have — a bookmark, a link
 * someone shared — is never a dead end (workspace first, founder 2026-10-23).
 * The page moves to this workspace's home (where the person left it, else its
 * home app, `workspaceLanding`) and one line says the app is not here and
 * which workspaces have it, each a link to the app there.
 * @param props - The workspace's apps and the ones it lacks.
 * @param props.apps - This workspace's apps (`splitNavByApp(...).apps`).
 * @param props.elsewhere - The apps it lacks, each with the pages it owns.
 */
export function AppNotHereNotice(props: { apps: readonly AppNav[]; elsewhere: readonly ElsewhereApp[] }) {
  const t = useTranslations('DashboardLayout');
  const pathname = usePathname();
  const router = useRouter();
  const slug = useWorkspaceSlug();
  const locale = useLocale();
  const [notice, setNotice] = useState<{ app: ElsewhereApp; home: string; where: Array<{ name: string; href: string }> } | null>(null);
  const missing = appMissingHere(pathname, props.apps, props.elsewhere);

  useEffect(() => {
    if (!missing) {
      return;
    }
    const app = props.elsewhere.find(a => a.id === missing)!;
    const core = props.apps.find(a => a.core);
    const home = workspaceLanding({
      targetApps: props.apps.map(a => ({ id: a.id, core: a.core, entry: a.href })),
      place: placeIn(globalThis.localStorage, slug),
      coreEntry: core?.href ?? WORKSPACE_HOME,
    }).path;
    router.replace(home);
    let cancelled = false;
    // Which workspaces have it, read only when a link needs it.
    Promise.all([client.projects.list(), client.apps.forUser()])
      .then(([r, a]) => {
        const accounts: SwitcherAccount[] = r.accounts;
        const entry = a.apps.find(x => x.id === app.id)?.entry ?? pathname;
        const ids = new Set((a.workspacesByApp[app.id] ?? []).map(w => w.projectId));
        const where = (r.projects as SwitcherProject[]).filter(p => ids.has(p.id)).map(p => ({
          name: p.name,
          href: workspaceSwitchHref({ slug: p.slug, pathname: entry, locale, defaultLocale: routing.defaultLocale, accountSlug: crossAccountSlug(p, r.account?.id, accounts) }),
        }));
        if (!cancelled) {
          setNotice({ app, home, where });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotice({ app, home, where: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [missing]);

  // The notice is for the page it moved the person to; moving on clears it.
  if (notice && !missing && pathname !== notice.home) {
    setNotice(null);
  }
  if (!notice) {
    return null;
  }
  return (
    <div role="status" className="flex items-start gap-2 border-b border-border bg-muted/40 px-4 py-2 text-[13px] text-foreground" data-testid="app-not-here">
      <p className="min-w-0 flex-1">
        {t('app_not_here', { app: notice.app.name })}
        {notice.where.length > 0 && (
          <>
            {' '}
            {t('app_not_here_open')}
            {' '}
            {notice.where.map((w, i) => (
              <span key={w.href}>
                {i > 0 && ', '}
                <a href={w.href} className="font-medium underline underline-offset-2 hover:text-foreground/80">{w.name}</a>
              </span>
            ))}
            .
          </>
        )}
      </p>
      <button type="button" onClick={() => setNotice(null)} aria-label={t('app_not_here_dismiss')} className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
