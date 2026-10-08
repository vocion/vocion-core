import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { FactList, Section } from '@/components/patterns';
import { HowItsAuthored } from '@/components/ui/how-its-authored';
import { LetterTile } from '@/components/ui/letter-tile';
import { AddAppButton } from '@/features/dashboard/apps/AddAppButton';
import { TemplatePicker } from '@/features/dashboard/apps/TemplatePicker';
import { iconByName } from '@/features/dashboard/iconByName';
import { FeatureSwitch } from '@/features/dashboard/plugins/FeatureSwitch';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { userSchema } from '@/models/Schema';
import { loadProject } from '@/routers/AuthGuards';
import { workspaceFolderForProject } from '@/routers/Workspace';
import { getAppOffer } from '@/services/AppCatalogService';
import { appTemplatesForProject } from '@/services/apps/AppTemplateService';
import { pluginWriteTarget } from '@/services/PluginService';
import { ORG_ROLE } from '@/types/Auth';

type Props = { params: Promise<{ locale: string; app: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { app: id } = await props.params;
  const { orgId } = await auth();
  const app = orgId ? await getAppOffer(orgId, id) : null;
  return { title: app?.name ?? 'Apps' };
}

/**
 * One app's page (`/dashboard/apps/<app>`): what it is in one sentence, Add or
 * Open, its templates when it ships any (the Company app's start page: a
 * function stood up in one move), its features as plain On/Off switches, what it brings by name, the
 * tools it reads with whether each is connected, and — closed — the developer
 * Details (the plugin slugs, the workspace.yaml line, the counts).
 *
 * States are the person's: an app is added or not, a feature is on or off.
 * Every switch is the one `FeatureSwitch`; Add is one apply of all the app's
 * features (`plugins.addApp`); an app that ships templates is added by
 * picking one (`TemplatePicker`). Nothing here names an app or a feature: it
 * is all read from the manifests (`AppCatalogService`, `AppTemplateService`).
 * @param props
 */
export default async function AppPage(props: Props) {
  const { locale, app: id } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId, has } = await auth();
  if (!orgId) {
    return notFound();
  }
  const [viewer] = userId ? await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, userId)).limit(1) : [];
  const [app, t, project, folder, templates] = await Promise.all([
    getAppOffer(orgId, id),
    getTranslations('Apps'),
    loadProject(orgId),
    workspaceFolderForProject(orgId),
    appTemplatesForProject(orgId, id, { email: viewer?.email ?? '', name: viewer?.name ?? '' }),
  ]);
  if (!app) {
    return notFound();
  }
  const hasTemplates = (templates?.templates.length ?? 0) > 0;
  // An app whose entry is this page (an app started from templates) has no
  // separate place to open.
  const opensElsewhere = app.href !== `/dashboard/apps/${app.id}`;
  const isAdmin = has({ role: ORG_ROLE.ADMIN });
  // On a deploy-managed host the workspace is a read-only checkout: the
  // switches show their state and, on hover, why they cannot change here.
  const target = await pluginWriteTarget(orgId, project?.slug ?? orgId, folder?.path ?? null, folder?.explicit ?? false);
  const note = target.mode === 'project' ? t('project_note') : null;
  const nameOf = new Map(app.features.map(f => [f.slug, f.name]));
  const list = (names: string[]) => (names.length > 0 ? names.join(' · ') : t('none'));

  return (
    <>
      <TitleBar
        title={(
          <span className="flex items-center gap-3">
            <LetterTile name={app.name} icon={iconByName(app.icon)} tint={app.tint} />
            {app.name}
          </span>
        )}
        description={app.job}
        actions={app.added && opensElsewhere
          ? (
              <Link href={app.href} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-action px-4 text-sm font-medium text-action-foreground transition-colors hover:bg-action/90">
                {t('open_app', { name: app.name })}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            )
          : app.added || hasTemplates
            ? undefined
            : isAdmin && !target.blocker
              ? <AddAppButton id={app.id} name={app.name} />
              : <span className="text-[13px] text-muted-foreground">{t('not_added')}</span>}
      />

      {templates && hasTemplates && (
        <Section eyebrow={t('templates')} id="templates">
          <TemplatePicker appId={templates.app.id} templates={templates.templates} writable={templates.writable} canInstall={isAdmin} />
        </Section>
      )}

      <Section eyebrow={t('features')} id="features">
        <ul className="divide-y divide-rule border-t border-rule" data-testid="app-features">
          {app.features.map(f => (
            <li key={f.slug} id={`feature-${f.slug}`} className="flex scroll-mt-24 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{f.name}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {f.job}
                  {f.needs.length > 0 && <span className="text-muted-foreground/80">{` ${t('needs', { features: f.needs.join(', ') })}.`}</span>}
                </p>
              </div>
              <FeatureSwitch
                slug={f.slug}
                name={f.name}
                on={f.on}
                canToggle={isAdmin}
                blocker={target.blocker}
                note={note}
                dependents={f.dependents.map(d => nameOf.get(d) ?? d)}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section eyebrow={t('what_you_get')}>
        <FactList
          facts={[
            { label: t('agents'), value: list(app.agents) },
            { label: t('pages'), value: list(app.pages) },
            { label: t('automations'), value: list(app.automations) },
          ]}
        />
      </Section>

      <Section eyebrow={t('connects_to')}>
        {app.connectors.length === 0
          ? <p className="text-[13px] text-muted-foreground">{t('connects_none')}</p>
          : (
              <ul className="divide-y divide-rule border-t border-rule" data-testid="app-connectors">
                {app.connectors.map(c => (
                  <li key={c.slug} className="flex items-center gap-3 py-2.5">
                    <LetterTile name={c.name} size="sm" />
                    <span className="min-w-0 flex-1 text-sm">
                      {c.name}
                      {c.needed && <span className="ml-1.5 text-[12px] text-muted-foreground">{t('needed')}</span>}
                    </span>
                    {c.connected
                      ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                            <span aria-hidden className="size-1.5 rounded-full bg-brand-pass" />
                            {t('connected')}
                          </span>
                        )
                      : (
                          <span className="flex items-center gap-3 text-[13px]">
                            <span className="text-muted-foreground">{t('not_connected')}</span>
                            <Link href={`/dashboard/connectors?add=${encodeURIComponent(c.slug)}`} className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0">
                              {t('connect')}
                              <ArrowRight className="size-3.5" aria-hidden />
                            </Link>
                          </span>
                        )}
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <HowItsAuthored label={t('details')} className="mt-8">
        <p>{t('details_features', { plugins: app.details.plugins.join(', ') })}</p>
        <p className="mt-1">{t('details_line')}</p>
        <p className="mt-1"><code>{`plugins: [${app.details.plugins.join(', ')}]`}</code></p>
        <p className="mt-1">{t('details_counts', { skills: app.details.skills, missions: app.details.missions, objects: app.details.objectTypes, teams: app.details.teams })}</p>
      </HowItsAuthored>
    </>
  );
}
