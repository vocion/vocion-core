import { and, desc, eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { ListRow, ListRows } from '@/components/ui/list-row';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { briefingSchema, teamSchema } from '@/models/Schema';
import { briefingHref } from '@/services/briefings/links';

/**
 * The briefing archive — where search and filter live
 * (`docs/specs/briefing-v2.md` §10).
 *
 * > History turns the page into an archive. The previous briefs list runs for
 * > dozens of entries and consumes a huge portion of the page. Show the last
 * > 3 to 5. Then "View all briefings". Search/filter can live on the archive
 * > view.
 *
 * So the brief itself shows five rows and links here; this page holds the
 * rest. Search is a substring over the title, filter is the team scope —
 * both in the URL, so a filtered archive is a link a person can send.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function BriefingArchivePage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; team?: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { q = '', team = '' } = await props.searchParams;
  const { orgId } = await auth();
  if (!orgId) {
    return (
      <>
        <TitleBar title="All briefings" />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Sign in to an organization to see briefings.</div>
      </>
    );
  }

  const [rows, teams] = await Promise.all([
    db.select({ id: briefingSchema.id, title: briefingSchema.title, createdAt: briefingSchema.createdAt, teamSlug: briefingSchema.teamSlug })
      .from(briefingSchema)
      .where(team ? and(eq(briefingSchema.orgId, orgId), eq(briefingSchema.teamSlug, team)) : eq(briefingSchema.orgId, orgId))
      .orderBy(desc(briefingSchema.createdAt))
      .limit(500),
    db.select({ slug: teamSchema.slug, name: teamSchema.name }).from(teamSchema).where(eq(teamSchema.orgId, orgId)),
  ]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter(r => r.title.toLowerCase().includes(needle)) : rows;
  const nameOf = new Map(teams.map(t => [t.slug, t.name]));

  return (
    <>
      <TitleBar title="All briefings" description={`${shown.length} of ${rows.length} — search by title, filter by team.`} />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search titles"
          aria-label="Search briefings by title"
          className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        />
        <select
          name="team"
          defaultValue={team}
          aria-label="Filter by team"
          className="h-9 rounded-lg border border-border bg-background px-2 text-[13px]"
        >
          <option value="">All teams</option>
          {teams.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
        <button type="submit" className="h-9 rounded-lg border border-border px-3 text-[13px] hover:bg-surface-hover">Apply</button>
      </form>

      {shown.length === 0
        ? <p className="text-sm text-muted-foreground">No briefing matches that.</p>
        : (
            <ListRows>
              {shown.map(r => (
                <ListRow
                  key={r.id}
                  href={briefingHref(r.id)}
                  title={r.title}
                  meta={`${r.teamSlug ? nameOf.get(r.teamSlug) ?? r.teamSlug : 'Workspace'} · ${r.createdAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                />
              ))}
            </ListRows>
          )}

      <p className="mt-4 text-[13px]">
        <Link href="/dashboard/briefings" className="text-brand-amber-deep hover:opacity-80">Back to the latest briefs</Link>
      </p>
    </>
  );
}
