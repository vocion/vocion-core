import { setRequestLocale } from 'next-intl/server';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { clerkAuth as auth } from '@/libs/Auth';
import { groupAgentHierarchy, listAgents } from '@/services/AgentService';

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
 * Deliberately chrome-free: no TitleBar, no header strip at all —
 * "insert quarter, shoot aliens." The surface is messages + composer;
 * new-chat and agent targeting live behind ChatShell's single ⋯ menu.
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

  // Chat defaults to WORKSPACE scope: opening /dashboard/chat lands on the
  // workspace coordinator — the front-door primary that orchestrates the
  // team — so the user just starts typing, never has to pick an agent.
  // `groupAgentHierarchy` sorts primaries-with-a-team first, so its first
  // primary is the coordinator (a team lead if one exists, else the first
  // parentless agent). Deterministic and never a dangling/deleted slug.
  const hierarchy = groupAgentHierarchy(dbAgents);
  const coordinatorSlug = hierarchy[0]?.primary.slug;

  // Order the flat list coordinator-first, then its team, so both the
  // fallback default (agents[0]) and the switcher read team-first.
  const ordered = hierarchy.flatMap(({ primary, specialists }) => [primary, ...specialists]);

  const agents = [
    ...ordered.map(a => ({
      slug: a.slug,
      name: a.name,
      icon: 'bot' as const,
      role: (a.role === 'lead' ? 'lead' : 'specialist') as 'lead' | 'specialist',
      parentSlug: a.parentAgentSlug ?? undefined,
      eyebrow: a.eyebrow ?? undefined,
      description: a.description ?? undefined,
      suggestions: a.suggestions ?? [],
      placeholder: `Message ${a.name}…`,
    })),
    SEARCH_ONLY_AGENT,
  ];

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <ChatShell agents={agents} agentSlug={coordinatorSlug} />
    </div>
  );
}
