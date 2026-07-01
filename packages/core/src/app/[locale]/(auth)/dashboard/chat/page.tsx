import { setRequestLocale } from 'next-intl/server';
import { NewChatButton } from '@/features/dashboard/AskChat';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { clerkAuth as auth } from '@/libs/Auth';
import { listAgents } from '@/services/AgentService';

/**
 * Built-in virtual agent — corpus search without an LLM in the loop.
 * Always appended to the agent list so users have a fallback path
 * even before any agents are authored.
 */
const SEARCH_ONLY_AGENT = {
  slug: '__search__',
  name: 'Search only',
  icon: 'search' as const,
  placeholder: 'Search across your connected systems…',
};

/**
 * Chat surface. Server-loads the project's agents from the DB so the
 * client-side ChatShell has a real list to pick from — no hardcoded
 * fallback. When the project has no agents authored, ChatShell renders
 * a "no agents yet" empty state pointing at the authoring path.
 *
 * Deliberately chrome-free: no page TitleBar — the agent header inside
 * ChatShell IS the identity of this surface (eyebrow · name · scope),
 * so the agent isn't announced four times on one screen.
 * @param props
 * @param props.params
 */
export default async function ChatPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const dbAgents = orgId ? await listAgents(orgId) : [];

  const agents = [
    ...dbAgents.map(a => ({
      slug: a.slug,
      name: a.name,
      icon: 'bot' as const,
      eyebrow: a.eyebrow ?? undefined,
      description: a.description ?? undefined,
      suggestions: a.suggestions ?? [],
      placeholder: `Message ${a.name}…`,
    })),
    SEARCH_ONLY_AGENT,
  ];

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <ChatShell agents={agents} headerAction={<NewChatButton />} />
    </div>
  );
}
