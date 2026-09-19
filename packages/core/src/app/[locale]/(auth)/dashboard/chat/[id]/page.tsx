import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ConversationArtifactView } from '@/features/dashboard/artifacts/ConversationArtifactView';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { clerkAuth as auth } from '@/libs/Auth';
import { listArtifactsForConversation, toPayload } from '@/services/ArtifactService';
import { getConversation } from '@/services/ConversationService';

/**
 * One conversation, expanded: the transcript beside ONE live artifact.
 * `?artifact=<id>` names which; without it the newest one opens. The rail
 * links here to "pull the conversation full screen".
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function ConversationArtifactPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ artifact?: string }>;
}) {
  const { locale, id } = await props.params;
  const { artifact: artifactParam } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const conversationId = Number(id);
  if (!orgId || !Number.isInteger(conversationId) || conversationId <= 0) {
    notFound();
  }
  const conversation = await getConversation({ orgId, id: conversationId, requestedBy: userId ?? null });
  if (!conversation) {
    notFound();
  }

  const { agents } = await loadChatAgentContext(orgId);
  const artifacts = (await listArtifactsForConversation({ orgId, conversationId })).map(toPayload);
  const requested = artifactParam ? Number(artifactParam) : Number.NaN;
  const initialArtifactId = Number.isInteger(requested) && artifacts.some(a => a.id === requested) ? requested : null;

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <ConversationArtifactView
        agents={agents}
        conversationId={conversationId}
        conversationTitle={conversation.title}
        agentSlug={conversation.agentSlug}
        initialArtifacts={artifacts}
        initialArtifactId={initialArtifactId}
        selfId={userId ?? null}
      />
    </div>
  );
}
