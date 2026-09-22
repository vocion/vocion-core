import type { ChatMessageArtifact } from '@/features/dashboard/chat/types';

/**
 * Which turn each artifact of a conversation hangs under, from persisted rows.
 *
 * The chip under a turn ("📄 Release readiness · v3 updated") was set only by
 * the live `artifact` event, so a reload lost every one of them (Chris,
 * 2026-09-18: "when I refreshed this page, I lost the chip"). The database
 * already knows the answer: `artifact.message_id` is stamped when the turn
 * persists. This puts it back deterministically, and for rows stamped before
 * that existed, hangs the artifact under the first assistant turn written
 * after it was made — the turn that produced it, in every ordinary case.
 * @param messages - The conversation's messages, oldest first.
 * @param artifacts - Every artifact of the conversation (uploads excluded by the caller).
 */
export function artifactChipsByMessage(
  messages: ReadonlyArray<{ id: number; role: string; createdAt: Date }>,
  artifacts: ReadonlyArray<{ id: number; title: string; kind: string; currentVersion: number; messageId: number | null; createdAt: Date; visibility?: string }>,
): Map<number, ChatMessageArtifact[]> {
  const out = new Map<number, ChatMessageArtifact[]>();
  const ids = new Set(messages.map(m => m.id));
  const assistant = messages.filter(m => m.role === 'assistant');
  const add = (messageId: number, a: typeof artifacts[number]) => {
    const list = out.get(messageId) ?? [];
    if (!list.some(x => x.id === a.id)) {
      list.push({ id: a.id, title: a.title, kind: a.kind as ChatMessageArtifact['kind'], version: a.currentVersion });
    }
    out.set(messageId, list);
  };
  for (const a of artifacts) {
    if (a.visibility === 'system') {
      continue;
    }
    if (a.messageId !== null && ids.has(a.messageId)) {
      add(a.messageId, a);
      continue;
    }
    const after = assistant.find(m => m.createdAt.getTime() >= a.createdAt.getTime());
    const home = after ?? assistant[assistant.length - 1];
    if (home) {
      add(home.id, a);
    }
  }
  return out;
}
