import type { PageBlock } from '@/libs/workspace/pageFields';
import { BLOCK_TITLE, CheckLogBlock, MonitorsBlock } from './MonitorBlocks';
/**
 * A page's blocks at one position, read and drawn (kept apart from the
 * drawing so a component test never bundles the server reads). Renders nothing when the
 * page declares none there.
 * @param props - Props.
 * @param props.orgId - The workspace.
 * @param props.blocks - The page's `blocks`.
 * @param props.position - Above or below the rows.
 * @param props.plugin - The plugin that shipped the page, when one did.
 * @param props.now - The clock.
 */
export async function PageMonitorBlocks({ orgId, blocks, position, plugin, now }: { orgId: string; blocks: PageBlock[]; position: 'above' | 'below'; plugin: string | null; now: number }) {
  const here = blocks.filter(b => b.position === position);
  if (here.length === 0) {
    return null;
  }
  const { loadCheckLog, loadMonitors, monitorSlugs } = await import('@/services/workspace/monitors');
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const timeZone = await workspaceTimeZone(orgId);
  const drawn = await Promise.all(here.map(async (b, i) => {
    const slugs = await monitorSlugs(orgId, b, plugin);
    const title = b.title ?? BLOCK_TITLE[b.kind];
    return b.kind === 'monitors'
      ? <MonitorsBlock key={`${b.kind}-${i}`} title={title} monitors={await loadMonitors(orgId, slugs, new Date(now))} now={now} timeZone={timeZone} />
      : <CheckLogBlock key={`${b.kind}-${i}`} title={title} rows={await loadCheckLog(orgId, slugs, b.limit)} now={now} timeZone={timeZone} />;
  }));
  return <>{drawn}</>;
}
