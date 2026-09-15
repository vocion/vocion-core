import { setRequestLocale } from 'next-intl/server';
import { ArtifactLog } from '@/features/dashboard/artifacts/ArtifactLog';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listArtifactFolders, listArtifacts } from '@/services/ArtifactService';
import { getNavPrefs } from '@/services/NavPrefService';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/artifacts — the log. Everything the workspace's agents and
 * people have made beside a conversation: tables, documents, charts,
 * records, files. Replaces /dashboard/canvases, which listed saved tile
 * arrangements nobody arranged twice.
 * @param props
 * @param props.params
 */
export default async function ArtifactsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const [artifacts, folders, prefs] = orgId
    ? await Promise.all([
        listArtifacts({ orgId }),
        listArtifactFolders({ orgId }),
        userId ? getNavPrefs({ orgId, userId }) : Promise.resolve({ pins: [], dismissed: [] }),
      ])
    : [[], [], { pins: [], dismissed: [] }];

  return (
    <>
      <TitleBar
        title="Artifacts"
        description="Everything made beside a conversation — each one live, versioned, and editable by you or the agent."
      />
      <ArtifactLog artifacts={artifacts} folders={folders} pins={prefs.pins} selfId={userId ?? null} />
    </>
  );
}
