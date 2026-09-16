import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StandaloneArtifactView } from '@/features/dashboard/artifacts/StandaloneArtifactView';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getArtifact, toPayload } from '@/services/ArtifactService';
import { getConversation } from '@/services/ConversationService';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/artifacts/[id] — one artifact on its own page.
 *
 * The same pane the conversation shows, without a conversation beside it:
 * where a person lands from the log when the thread that produced it is gone
 * (or was never there — a mission file), and what "Copy link" hands to a
 * colleague.
 * @param props
 * @param props.params
 */
export default async function ArtifactPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const artifactId = Number(id);
  if (!orgId || !Number.isInteger(artifactId) || artifactId <= 0) {
    notFound();
  }
  const row = await getArtifact({ orgId, id: artifactId });
  if (!row) {
    notFound();
  }
  const conversation = row.conversationId ? await getConversation({ orgId, id: row.conversationId }) : null;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-2">
      <p className="text-[12px] text-muted-foreground">
        <Link href="/dashboard/artifacts" className="hover:text-foreground">Artifacts</Link>
        {conversation && (
          <>
            {' · '}
            <Link href={`/dashboard/chat/${conversation.id}?artifact=${row.id}`} className="hover:text-foreground">
              Back to “
              {conversation.title}
              ”
            </Link>
          </>
        )}
      </p>
      <StandaloneArtifactView artifact={toPayload(row)} selfId={userId ?? null} />
    </div>
  );
}
