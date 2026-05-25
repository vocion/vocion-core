import { setRequestLocale } from 'next-intl/server';
import { NewChatButton } from '@/features/dashboard/AskChat';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { TitleBar } from '@/features/dashboard/TitleBar';
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
 * The virtual `__search__` agent (search-only mode against the
 * connected systems) is always appended so users have a fallback path
 * even with an empty agent table.
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
      placeholder: a.description?.trim()
        ? `Ask ${a.name} — ${a.description.replace(/\.$/, '')}…`
        : `Ask ${a.name}…`,
    })),
    SEARCH_ONLY_AGENT,
  ];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-between">
        <TitleBar title="Chat" description="Talk to your agents, grounded in enterprise context" />
        <NewChatButton />
      </div>
      <ChatShell agents={agents} />
    </div>
  );
}
