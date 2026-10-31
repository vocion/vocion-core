import { eq } from 'drizzle-orm';
import { History } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { AutomationsList } from '@/features/dashboard/automations/AutomationsList';
import { planAutomations } from '@/features/dashboard/automations/automationsPlan';
import { readAutomationRegister } from '@/features/dashboard/automations/readRegister';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { knowledgeSourceSchema } from '@/models/Schema';
import { ORG_ROLE } from '@/types/Auth';

export const dynamic = 'force-dynamic';

/**
 * AUTOMATIONS — every automation in the workspace, with its switch (Chris,
 * 2026-10-01: "Put all those automations on an Automations page with toggle
 * switches. Make it on main nav under More dropdown. Leave most off").
 *
 * One row per automation: its name, the app that installed it, what it
 * reacts to, the seat that owns it, its last run, and a switch. Switching one off pauses it and switching it on
 * resumes it — the same pause the automation's own page records, with who and
 * when, and Undo in the toast. Which ones are on is each workspace's decision,
 * not this page's: nothing here switches anything by itself.
 *
 * ONE REGISTER PER WORKSPACE, FILTERED BY APP (2026-10-29). Every automation
 * is a workspace row that records the app that installed it (`source`); the
 * page lists them all, each row naming its app, with one chip per app above
 * (`?app=<id>`, All by default) — the link an app's "How it is doing" panel
 * hands out. System automations (`visibility: system`, an app's internal
 * hand-offs) are left out; an admin can show them (`?system=1`). They still
 * fire, keep their own page and are in the run log.
 *
 * The automation's own page (`/dashboard/schedules/<slug>`) keeps the rest:
 * its parameters, its schedule's health, a test run and every fire.
 * @param props
 * @param props.params
 * @param props.searchParams - `app` (an app id, or `workspace`) and `system` (`1` shows system automations to an admin).
 */
export default async function AutomationsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ app?: string; system?: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await auth();
  if (!orgId) {
    return null;
  }
  const query = await props.searchParams;
  const canShowSystem = has({ role: ORG_ROLE.ADMIN });
  const showSystem = canShowSystem && query.system === '1';
  const now = await currentTime();
  const register = await readAutomationRegister(orgId);
  const view = planAutomations({ ...register, now, filter: { app: query.app ?? '', showSystem } });

  // Connector refresh crons are connector config, not automations; listed so
  // "what runs on a schedule here" has one answer.
  const sources = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId));
  const syncing = sources.filter(s => s.enabled === 'true' && (s.configJson as { schedule?: string } | null)?.schedule);

  return (
    <ListPage
      title="Schedules"
      description="Control when work starts: recurring schedules and event-trigger rules. Switch one off to pause it."
      actions={(
        <Link href="/dashboard/schedules/runs" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <History className="size-3.5" />
          Run log
        </Link>
      )}
    >
      <AutomationsList rows={view.rows} filter={{ apps: view.apps, selected: view.selected, systemHidden: canShowSystem ? view.systemHidden : 0, canShowSystem, showSystem }} />
      {syncing.length > 0 && (
        <section className="mt-8" aria-label="Source syncs">
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Source syncs</h2>
          <ListRows>
            {syncing.map(s => (
              <ListRow
                key={s.slug}
                href="/dashboard/connectors"
                title={s.slug}
                subline={<Subline segments={[cronToText((s.configJson as { schedule?: string }).schedule ?? ''), 'Set on the connector']} separator="·" />}
              />
            ))}
          </ListRows>
        </section>
      )}
    </ListPage>
  );
}

/** Now, read once per render: `Date.now()` counts as impure inside a render. */
async function currentTime(): Promise<number> {
  return Date.now();
}
