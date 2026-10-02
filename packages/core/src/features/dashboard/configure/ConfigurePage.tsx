import type { LoadedPage } from '@/libs/workspace/pages';
import { ListEmpty } from '@/components/patterns';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { pagePlugin } from '@/libs/workspace/pages';
import { loadConfigure } from '@/services/plugins/configureData';
import { CONFIGURE_TAB_PARAM, ConfigureLayout } from './ConfigureLayout';
import { planConfigure } from './configurePlan';

/**
 * `/dashboard/p/<slug>` for a page declared `archetype: configure` — what
 * drives the plugin that ships it: its seats, skills, automations, trust
 * rules, what it learned and its measures, with how it is doing, what needs
 * attention and what changed beside them.
 * @param props
 * @param props.orgId - The project.
 * @param props.manifest - The page.
 * @param props.searchParams - The URL's query; `?tab=` picks the tab.
 * @param props.now - One instant for every relative time on the page.
 */
export async function ConfigurePage(props: {
  orgId: string;
  manifest: LoadedPage;
  searchParams: Record<string, string | string[] | undefined>;
  now: number;
}) {
  const { manifest } = props;
  const plugin = pagePlugin(manifest);
  if (!plugin) {
    // A configure page is a plugin's: its tabs are that plugin's relations.
    return (
      <>
        <TitleBar title={manifest.title} description={manifest.description} />
        <ListEmpty variant="inline" title="Turn on the plugin this page configures." />
      </>
    );
  }
  const input = await loadConfigure(props.orgId, plugin, new Date(props.now));
  const view = planConfigure(input, manifest.configure, { tab: props.searchParams[CONFIGURE_TAB_PARAM], now: props.now });
  return (
    <>
      <TitleBar title={manifest.title} description={manifest.description} />
      <ConfigureLayout view={view} />
    </>
  );
}
