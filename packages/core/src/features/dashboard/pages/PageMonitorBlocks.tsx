import type { PageBlock } from '@/libs/workspace/pageFields';
import { BLOCK_TITLE, CheckLogBlock, MonitorsBlock } from './MonitorBlocks';
/**
 * A page's blocks at one position, read and drawn (kept apart from the
 * drawing so a component test never bundles the server reads). Renders nothing when the
 * page declares none there. Each block sits in a `data-page-block` wrapper
 * naming its kind, the anchor a tour points at.
 * @param props - Props.
 * @param props.orgId - The workspace.
 * @param props.userId - The person looking (Needs you is theirs).
 * @param props.blocks - The page's `blocks`.
 * @param props.position - Above or below the rows.
 * @param props.plugin - The plugin that shipped the page, when one did.
 * @param props.now - The clock.
 */
export async function PageMonitorBlocks({ orgId, userId, blocks, position, plugin, now }: { orgId: string; userId?: string | null; blocks: PageBlock[]; position: 'above' | 'below'; plugin: string | null; now: number }) {
  const here = blocks.filter(b => b.position === position);
  if (here.length === 0) {
    return null;
  }
  const { loadCheckLog, loadMonitors, monitorSlugs } = await import('@/services/workspace/monitors');
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const timeZone = await workspaceTimeZone(orgId);
  const drawn = await Promise.all(here.map(async (b, i) => {
    const title = b.title ?? BLOCK_TITLE[b.kind];
    if (b.kind === 'needsYou') {
      const { NeedsYouBlock } = await import('./PageLiveBlocks');
      return userId ? <NeedsYouBlock key={`${b.kind}-${i}`} orgId={orgId} userId={userId} title={b.title ?? null} /> : null;
    }
    if (b.kind === 'dashboard') {
      const { DashboardBlock } = await import('./PageLiveBlocks');
      return <DashboardBlock key={`${b.kind}-${i}`} orgId={orgId} dashboard={b.dashboard!} title={b.title ?? null} />;
    }
    if (b.kind === 'team' || b.kind === 'flow') {
      const [{ loadFlowBlock, loadTeamBlock }, { FlowBlock, TeamBlock }] = await Promise.all([import('@/services/workspace/teamFlow'), import('./TeamFlowBlocks')]);
      return b.kind === 'team'
        ? <TeamBlock key={`${b.kind}-${i}`} title={title} team={await loadTeamBlock(orgId, b, new Date(now), timeZone)} />
        : <FlowBlock key={`${b.kind}-${i}`} title={title} steps={await loadFlowBlock(orgId, b.steps ?? [], new Date(now))} now={now} timeZone={timeZone} />;
    }
    const slugs = await monitorSlugs(orgId, b, plugin);
    return b.kind === 'monitors'
      ? <MonitorsBlock key={`${b.kind}-${i}`} title={title} monitors={await loadMonitors(orgId, slugs, new Date(now))} now={now} timeZone={timeZone} />
      : <CheckLogBlock key={`${b.kind}-${i}`} title={title} rows={await loadCheckLog(orgId, slugs, b.limit)} now={now} timeZone={timeZone} />;
  }));
  return (
    <>
      {drawn.map((node, i) => node && (
        // eslint-disable-next-line react/no-array-index-key -- blocks have no id; their order is the identity
        <div key={`${here[i]!.kind}-${i}`} data-page-block={here[i]!.kind}>{node}</div>
      ))}
    </>
  );
}
