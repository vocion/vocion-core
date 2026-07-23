import type { BriefGroup } from '@/features/dashboard/BriefingsView';
import { desc, eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { BriefingsView } from '@/features/dashboard/BriefingsView';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { briefingSchema, projectSchema, teamSchema } from '@/models/Schema';

/**
 * Briefings — grouped BY TEAM: the workspace ROLLUP tab first (the
 * director/workspace-lead's cross-team read), then one tab per team. Each tab:
 * latest brief, previous-brief history, Regenerate, and a floating chat pill
 * scoped to that team's lead.
 */
export default async function BriefingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return (
      <>
        <TitleBar title="Briefings" description="Team briefs and the workspace rollup." />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Sign in to an organization to see briefings.</div>
      </>
    );
  }

  const [briefings, teams, projects] = await Promise.all([
    db.select({ id: briefingSchema.id, title: briefingSchema.title, content: briefingSchema.content, createdAt: briefingSchema.createdAt, teamSlug: briefingSchema.teamSlug })
      .from(briefingSchema)
      .where(eq(briefingSchema.orgId, orgId))
      .orderBy(desc(briefingSchema.createdAt))
      .limit(100),
    db.select({ slug: teamSchema.slug, name: teamSchema.name, lead: teamSchema.leadAgentSlug })
      .from(teamSchema)
      .where(eq(teamSchema.orgId, orgId)),
    db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1),
  ]);

  const rows = briefings.map(b => ({ ...b, createdAt: b.createdAt.toISOString() }));
  const groups: BriefGroup[] = [
    {
      teamSlug: null,
      teamName: 'Workspace rollup',
      leadSlug: projects[0]?.lead ?? null,
      briefs: rows.filter(b => b.teamSlug == null),
    },
    ...teams.map(t => ({
      teamSlug: t.slug,
      teamName: t.name,
      leadSlug: t.lead,
      briefs: rows.filter(b => b.teamSlug === t.slug),
    })),
  ];

  return (
    <>
      <TitleBar
        title="Briefings"
        description="Each team's brief plus the workspace rollup — regenerate on demand, explore history, or chat with a brief."
      />
      <BriefingsView groups={groups} />
    </>
  );
}
