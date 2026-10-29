import type { PageManifest } from '@/libs/workspace/pages';
import type { ArtifactListItem } from '@/services/ArtifactService';
import { LayoutDashboard } from 'lucide-react';
import { ListRow, ListRows } from '@/components/patterns/ListRow';
import { EmptyState } from '@/components/ui/empty-state';
import { authorLabel, relativeTime } from '@/features/dashboard/artifacts/kinds';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { DashboardCardView } from '@/libs/cards/firstParty/dashboard';
import { asOfLabel } from '@/libs/dashboards/format';
import { dashboardSpecSchema } from '@/libs/dashboards/spec';
import { Link } from '@/libs/I18nNavigation';
import { getArtifact, listArtifacts, toPayload } from '@/services/ArtifactService';

/**
 * The `dashboards` archetype — `/dashboard/p/<slug>` and `/dashboard/p/<slug>/<id>`.
 *
 * The workspace's dashboards, read as pages: with one, the page IS that
 * dashboard, full width; with several, one row each with its lead and when
 * its numbers are as of, and a row opens it at `/dashboard/p/<slug>/<id>`.
 * A dashboard is an artifact, so its history, sharing and pinning are the
 * artifact's own, one link away (principle 7). The folder comes from the
 * manifest's `source`; no folder means every dashboard in the workspace.
 */

/**
 * The dashboards a page lists, newest refresh first.
 * @param orgId - The workspace.
 * @param manifest - The page.
 */
async function loadDashboards(orgId: string, manifest: PageManifest): Promise<ArtifactListItem[]> {
  const folder = manifest.source?.kind === 'artifacts' ? manifest.source.folder ?? null : null;
  return listArtifacts({ orgId, kinds: ['dashboard'], folder, visibility: 'all', limit: 100 });
}

/**
 * The lead's first sentence, without markdown, for a row.
 * @param summary
 */
function leadLine(summary: unknown): string | null {
  if (typeof summary !== 'string' || !summary.trim()) {
    return null;
  }
  const plain = summary.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const first = plain.match(/^.+?[.!?](?:\s|$)/)?.[0] ?? plain;
  return first.length > 220 ? `${first.slice(0, 217)}…` : first.trim();
}

function OneDashboard(props: { id: number; spec: unknown; version: number; updatedAt: string; authorKind: 'agent' | 'human' | 'system'; authorId: string | null; backHref?: string; backLabel?: string }) {
  const parsed = dashboardSpecSchema.safeParse(props.spec);
  if (!parsed.success) {
    return <EmptyState icon={LayoutDashboard} title="This dashboard could not be drawn" description="Its saved content no longer matches the dashboard shape. Ask for it to be rebuilt." action={{ label: 'Open its history', href: `/dashboard/artifacts/${props.id}` }} />;
  }
  return (
    <>
      <TitleBar title={parsed.data.title} />
      <div className="space-y-6 px-1 pb-16">
        <p className="flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
          {props.backHref && <Link href={props.backHref} className="hover:text-foreground">{`← ${props.backLabel ?? 'Dashboards'}`}</Link>}
          <span>{`v${props.version} · ${authorLabel(props.authorKind, props.authorId)} · ${relativeTime(props.updatedAt)}`}</span>
          <Link href={`/dashboard/artifacts/${props.id}`} className="hover:text-foreground">History and sharing</Link>
        </p>
        <DashboardCardView data={{ ...parsed.data, __artifactId: props.id }} surface="artifact" />
      </div>
    </>
  );
}

/**
 * The index, or the one dashboard when there is only one.
 * @param props - The workspace and the page.
 * @param props.orgId - The workspace.
 * @param props.manifest - The page's manifest.
 */
export async function DashboardsIndex(props: { orgId: string; manifest: PageManifest }) {
  const { manifest } = props;
  const rows = await loadDashboards(props.orgId, manifest);
  if (rows.length === 1) {
    const only = rows[0]!;
    return <OneDashboard id={only.id} spec={only.spec} version={only.version} updatedAt={only.updatedAt} authorKind={only.authorKind} authorId={only.authorId} />;
  }
  return (
    <>
      <TitleBar title={manifest.title} description={manifest.description} />
      {rows.length === 0
        ? (
            <EmptyState
              icon={LayoutDashboard}
              title="No dashboards yet"
              description="Ask for one in words: what you want to watch, and where the numbers live. The agent builds it, dates it, and keeps the recipe so it can refresh it."
              action={{ label: 'Build a dashboard', href: `/dashboard/chat?prompt=${encodeURIComponent('Build a dashboard of ')}` }}
            />
          )
        : (
            <ListRows>
              {rows.map((r) => {
                const asOf = typeof r.spec.asOf === 'string' ? asOfLabel(r.spec.asOf) : null;
                return (
                  <ListRow
                    key={r.id}
                    href={`/dashboard/p/${manifest.slug}/${r.id}`}
                    icon={LayoutDashboard}
                    title={r.title}
                    subline={[leadLine(r.spec.summary), asOf ? `As of ${asOf}` : null].filter(Boolean).join(' · ')}
                    data-testid="dashboard-row"
                  />
                );
              })}
            </ListRows>
          )}
    </>
  );
}

/**
 * One dashboard of a page's folder, by artifact id.
 * @param props - The workspace, the page and the id.
 * @param props.orgId - The workspace.
 * @param props.manifest - The page's manifest.
 * @param props.id - The artifact id from the path.
 */
export async function DashboardById(props: { orgId: string; manifest: PageManifest; id: number }) {
  const row = await getArtifact({ orgId: props.orgId, id: props.id });
  if (!row || row.kind !== 'dashboard') {
    return null;
  }
  const p = toPayload(row);
  return (
    <OneDashboard
      id={p.id}
      spec={p.spec}
      version={p.version}
      updatedAt={p.updatedAt}
      authorKind={p.authorKind}
      authorId={p.authorId}
      backHref={`/dashboard/p/${props.manifest.slug}`}
      backLabel={props.manifest.title}
    />
  );
}
