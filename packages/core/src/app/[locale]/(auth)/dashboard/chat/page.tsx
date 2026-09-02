import { setRequestLocale } from 'next-intl/server';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { clerkAuth as auth } from '@/libs/Auth';
import { buildWorkspaceChips } from '@/services/chat/suggestions';
import { workspaceGreeting } from '@/services/chat/workspaceLabel';

/**
 * Chat surface. Server-loads the project's agents from the DB so the
 * client-side ChatShell has a real list to pick from — no hardcoded
 * fallback. When the project has no agents authored, ChatShell renders
 * a "no agents yet" empty state pointing at the authoring path.
 *
 * Deep-linkable: `?agent=<slug>` starts with that agent (unknown slugs fall
 * back to the workspace-coordinator default) and `?prompt=<text>` pre-fills
 * the composer without sending.
 *
 * Deliberately chrome-free: no TitleBar, no header strip — "insert quarter,
 * shoot aliens." The surface is messages + composer; New chat / Switch agent
 * live behind a single ⋯ menu that ChatShell portals into the shell top bar.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function ChatPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ agent?: string; prompt?: string }>;
}) {
  const { locale } = await props.params;
  const { agent: requestedSlug, prompt: seededPrompt } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();

  // Shared with the floating chat bubble — same ordering, same default agent.
  const { agents, coordinatorSlug, accountName, projectName } = orgId
    ? await loadChatAgentContext(orgId)
    : { agents: [], coordinatorSlug: undefined, accountName: undefined, projectName: undefined };

  // Workspace-scoped greeting ("Metacto" eyebrow + "Ask Revenue") — a SHORT
  // label composed from the account + project names, never an agent name.
  const greeting = workspaceGreeting(accountName, projectName);

  // Dynamic empty-state chips: urgency (recent brief / review queue) first,
  // then team capabilities across agents. Falls back to capability chips when
  // no live urgency data exists (the pre-F1 default).
  const chips = orgId
    ? await buildWorkspaceChips({ orgId, agents, coordinatorSlug })
    : [];

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <ChatShell
        agents={agents}
        agentSlug={requestedSlug ?? coordinatorSlug}
        greeting={greeting}
        suggestions={chips.map(c => ({ label: c.label, prompt: c.prompt }))}
        initialComposerValue={seededPrompt}
      />
    </div>
  );
}
