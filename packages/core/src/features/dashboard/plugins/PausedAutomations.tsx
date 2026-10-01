import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { AutomationPauseControl } from '@/features/dashboard/AutomationPauseControl';
import { db } from '@/libs/DB';
import { pausedSince } from '@/libs/factory/delivery';
import { listPluginSlugs, loadPlugin, pluginContents } from '@/libs/workspace/plugins';
import { automationSchema } from '@/models/Schema';
import { pausesFor } from '@/services/AutomationService';
import { enabledPluginsForOrg } from '@/services/PluginService';

/**
 * PAUSED IS VISIBLE WHERE THE WORK IS (2026-10-01, #294). The automation that
 * answers a failed deploy had been paused for ten days; the Work page and the
 * product page listed the work it would have carried and said nothing of it,
 * so a failed deploy sat for two hours with no line anywhere.
 *
 * Every page a plugin ships carries this above its rows: each of the plugin's
 * automations a person has paused, with who paused it, since when, the note
 * they left, and Resume — the same control the automation's own page has.
 * Renders nothing when none is paused, so a surface mounts it unconditionally.
 * @param props
 * @param props.orgId - The project.
 * @param props.slug - The plugin whose automations these are.
 */
export async function PausedAutomations({ orgId, slug }: { orgId: string; slug: string }) {
  if (!listPluginSlugs().includes(slug) || !(await enabledPluginsForOrg(orgId)).includes(slug)) {
    return null;
  }
  const slugs = pluginContents(loadPlugin(slug)).automations;
  if (slugs.length === 0) {
    return null;
  }
  const rows = await db
    .select({ slug: automationSchema.slug, name: automationSchema.name, description: automationSchema.description, pausedAt: automationSchema.pausedAt, pausedBy: automationSchema.pausedBy, pausedNote: automationSchema.pausedNote })
    .from(automationSchema)
    .where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.status, 'active'), inArray(automationSchema.slug, slugs), isNotNull(automationSchema.pausedAt)));
  if (rows.length === 0) {
    return null;
  }
  const pauses = await pausesFor(rows, orgId);
  return (
    <section className="mb-6" data-testid="paused-automations" aria-label="Paused automations">
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {rows.length === 1 ? '1 automation paused' : `${rows.length} automations paused`}
        {' — what each would do is not happening until it is resumed'}
      </h2>
      <ListRows>
        {rows.sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
          const pause = pauses.get(r.slug);
          const byName = pause?.by.name ?? r.pausedBy ?? 'someone';
          const when = pausedSince(r.pausedAt!.toISOString());
          return (
            <ListRow
              key={r.slug}
              data-testid={`paused-automation-${r.slug}`}
              href={`/dashboard/automation/${r.slug}`}
              title={r.name}
              subline={<Subline segments={[`Paused by ${byName} since ${when}`, r.pausedNote ?? '', r.description ?? '']} separator="·" />}
              chip={<StatusPill status="paused" label="Paused" size="sm" />}
              actions={<AutomationPauseControl slug={r.slug} paused={{ byName, when, note: r.pausedNote }} compact />}
              actionsAlways
            />
          );
        })}
      </ListRows>
    </section>
  );
}
