import { permanentRedirect } from 'next/navigation';
import { appForPlugin } from '@/features/navigation/apps';
import { safeListApps } from '@/libs/workspace/apps';
import { listPluginSlugs } from '@/libs/workspace/plugins';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/plugins/<slug> → the page of the app the plugin is a feature of,
 * at that feature (308). Since 2026-10-08 a plugin is an app's feature: its
 * switch, what it brings and its developer facts live on the app's page. The
 * chat's recommend cards and older links still land on the right switch.
 * @param props
 * @param props.params - The plugin slug.
 */
export default async function PluginRedirect(props: { params: Promise<{ slug: string }> }): Promise<never> {
  const { slug } = await props.params;
  const app = appForPlugin(slug, listPluginSlugs(), safeListApps());
  permanentRedirect(app ? `/dashboard/apps/${app.id}#feature-${slug}` : '/dashboard/apps');
}
