import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CanvasView } from '@/features/dashboard/canvas/CanvasView';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { clerkAuth as auth } from '@/libs/Auth';
import { getCanvas, listArtifactsForConversation, toPayload } from '@/services/ArtifactService';
import { getConversation } from '@/services/ConversationService';

/**
 * One conversation, expanded: the transcript beside its canvas of rendered
 * artifacts. `?grid=open` shows the canvas; `?canvas=<id>` opens a saved
 * canvas's layout instead of the live tiles. The rail links here to "pull
 * the conversation full screen".
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function ConversationCanvasPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ grid?: string; canvas?: string }>;
}) {
  const { locale, id } = await props.params;
  const { grid, canvas: canvasParam } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const conversationId = Number(id);
  if (!orgId || !Number.isInteger(conversationId) || conversationId <= 0) {
    notFound();
  }
  const conversation = await getConversation({ orgId, id: conversationId });
  if (!conversation) {
    notFound();
  }

  const { agents } = await loadChatAgentContext(orgId);

  let initialArtifacts;
  let savedCanvas: { id: number; name: string } | null = null;
  const canvasId = canvasParam ? Number(canvasParam) : NaN;
  if (Number.isInteger(canvasId) && canvasId > 0) {
    const found = await getCanvas({ orgId, id: canvasId });
    if (found) {
      initialArtifacts = found.artifacts.map(toPayload);
      savedCanvas = { id: found.canvas.id, name: found.canvas.name };
    }
  }
  initialArtifacts ??= (await listArtifactsForConversation({ orgId, conversationId })).map(toPayload);

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <CanvasView
        agents={agents}
        conversationId={conversationId}
        conversationTitle={conversation.title}
        agentSlug={conversation.agentSlug}
        initialArtifacts={initialArtifacts}
        gridOpen={grid === 'open' || savedCanvas !== null}
        savedCanvas={savedCanvas}
      />
    </div>
  );
}
