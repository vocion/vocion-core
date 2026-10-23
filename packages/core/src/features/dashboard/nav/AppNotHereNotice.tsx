'use client';

import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import type { AppNav } from '@/features/navigation/apps';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { CLOSE_BUTTON } from '@/components/ui/buttonVariants';
import { Notice } from '@/components/ui/notice';
import { appMissingHere } from '@/features/navigation/apps';
import { usePathname } from '@/libs/I18nNavigation';
import { routing } from '@/libs/I18nRouting';
import { client } from '@/libs/Orpc';
import { crossAccountSlug, workspaceSwitchHref } from './workspaceSwitch';

/** An app this workspace lacks, with what it owns (`appsElsewhere`). */
export type ElsewhereApp = Pick<AppNav, 'id' | 'name' | 'core' | 'owns'>;

/**
 * A deep link into an app this workspace does not have — a bookmark, a link
 * someone shared — is never a dead end (workspace first, founder 2026-10-23).
 * The page stays where it is, and one line above it says the app is not
 * here and which workspaces have it, each a link to the app there.
 *
 * It never navigates. The first version moved the person to this workspace's
 * home from an effect, after the page had rendered and while they were using
 * it; on 2026-10-23 that yanked the bulk actions page away mid-interaction
 * and failed main's queue E2E on every commit from #1389 on.
 * @param props - The workspace's apps and the ones it lacks.
 * @param props.apps - This workspace's apps (`splitNavByApp(...).apps`).
 * @param props.elsewhere - The apps it lacks, each with the pages it owns.
 */
export function AppNotHereNotice(props: { apps: readonly AppNav[]; elsewhere: readonly ElsewhereApp[] }) {
  const t = useTranslations('DashboardLayout');
  const pathname = usePathname();
  const locale = useLocale();
  const [notice, setNotice] = useState<{ app: ElsewhereApp; where: Array<{ name: string; href: string }> } | null>(null);
  const missing = appMissingHere(pathname, props.apps, props.elsewhere);

  useEffect(() => {
    if (!missing) {
      return;
    }
    const app = props.elsewhere.find(a => a.id === missing)!;
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
          setNotice({ app, where });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotice({ app, where: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [missing]);

  // The notice is for a page of the missing app; moving out of it clears it.
  if (notice && missing !== notice.app.id) {
    setNotice(null);
  }
  if (!notice) {
    return null;
  }
  return (
    <Notice
      edge
      tone="info"
      data-testid="app-not-here"
      action={(
        <button type="button" onClick={() => setNotice(null)} aria-label={t('app_not_here_dismiss')} className={CLOSE_BUTTON}>
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    >
      <p>
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
    </Notice>
  );
}
