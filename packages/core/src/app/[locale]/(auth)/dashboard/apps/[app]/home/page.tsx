import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Section } from '@/components/patterns';
import { HomeAskBar } from '@/features/dashboard/appHome/HomeAskBar';
import { ActivitySection, NeedsYouSection, ProjectsSection, SectionPending, StandingSection } from '@/features/dashboard/appHome/HomeSections';
import { LaunchTiles } from '@/features/dashboard/appHome/LaunchTiles';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { resolveTint } from '@/libs/tints';
import { firstNameOf, firstTile, greetingPart } from '@/libs/workspace/appHomeLinks';
import { userSchema } from '@/models/Schema';
import { homeHasWork, loadHomeScope } from '@/services/apps/appHome';

type Props = { params: Promise<{ locale: string; app: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { app } = await props.params;
  const { orgId } = await auth();
  const scope = orgId ? await loadHomeScope(orgId, app).catch(() => null) : null;
  return { title: scope ? (scope.app.shortName ?? scope.app.name) : 'Home' };
}

/**
 * AN APP'S HOME (`/dashboard/apps/<app>/home`) — where an app opens
 * (founder, 2026-10-30: a person who landed on an empty SEO chat did not
 * know what to do first). Declared in the app's manifest (`app.yaml` `home:`,
 * `AppHomeSchema`) and drawn from pieces that exist:
 *
 *   1. a greeting and the ask bar ("Ask the SEO team…"), which opens Chat
 *      with the words sent, routed to the app's lead;
 *   2. Start something: the launch tiles, the one emphasized element;
 *   3. Needs you: the app's open decisions, decided in place on the decision
 *      card (hidden when there are none);
 *   4. where things stand: the workspace's figures, then one block per
 *      project using the app, every number linked to its source and dated;
 *   5. running now and recently made.
 *
 * A new app (nothing yet) shows the ask bar and its first tile only, with
 * one line saying what the app does. Sections 3–5 stream in under their own
 * `<Suspense>`, so a slow figure never holds up the page.
 * @param props
 */
export default async function AppHomePage(props: Props) {
  const { locale, app: appId } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  if (!orgId || !userId) {
    return notFound();
  }
  const scope = await loadHomeScope(orgId, appId).catch(() => null);
  if (!scope) {
    return notFound();
  }
  const [t, timeZone, person, hasWork] = await Promise.all([
    getTranslations('AppHome'),
    workspaceTimeZone(orgId),
    db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1).then(r => r[0] ?? null),
    homeHasWork(orgId, userId, scope).catch(() => true),
  ]);
  const { app } = scope;
  const home = app.home;
  const appName = app.shortName ?? app.name;
  const tint = resolveTint(app.tint, app.id);
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
  const name = person ? firstNameOf(person) : null;
  const part = greetingPart(hour);
  const greeting = name ? t(`greeting_${part}`, { name }) : t(`greeting_${part}_plain`);
  const labels = { start: t('tile_start'), open: t('tile_open'), run: t('tile_run'), drop: t('tile_drop', { types: '{types}' }), dropping: t('tile_dropping'), dropFailed: t('tile_drop_failed') };

  return (
    <div className="mx-auto w-full max-w-5xl px-1 pt-4 pb-12 sm:pt-8" data-testid="app-home" data-app={app.id} data-empty={hasWork ? undefined : 'true'}>
      <header className="mb-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{greeting}</h1>
          {!hasWork && <p className="mt-1 text-[15px] text-muted-foreground" data-testid="home-about">{app.description}</p>}
        </div>
        <HomeAskBar placeholder={t('ask_placeholder', { app: appName })} sendLabel={t('ask_send')} focusOnLoad={!hasWork} />
      </header>

      {!hasWork
        ? (
            <LaunchTiles tiles={[firstTile(home)]} tint={tint} labels={labels} first />
          )
        : (
            <>
              <Section eyebrow={t('start')} data-testid="home-start">
                <LaunchTiles tiles={home.launch} tint={tint} labels={labels} />
              </Section>
              <Suspense fallback={null}>
                <NeedsYouSection orgId={orgId} userId={userId} scope={scope} />
              </Suspense>
              {(home.measures?.length ?? 0) > 0 && (
                <Suspense fallback={<SectionPending eyebrow={t('standing')} />}>
                  <StandingSection orgId={orgId} userId={userId} scope={scope} timeZone={timeZone} />
                </Suspense>
              )}
              {home.projects && (
                <Suspense fallback={<SectionPending eyebrow={t('projects')} />}>
                  <ProjectsSection orgId={orgId} scope={scope} timeZone={timeZone} />
                </Suspense>
              )}
              <Suspense fallback={null}>
                <ActivitySection orgId={orgId} scope={scope} timeZone={timeZone} />
              </Suspense>
            </>
          )}
    </div>
  );
}
