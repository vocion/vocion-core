import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import { groupAgentHierarchy, listAgents } from '@/services/AgentService';
import { buildWorkspaceChips } from '@/services/chat/suggestions';
import { workspaceGreeting } from '@/services/chat/workspaceLabel';

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
 * "insert quarter, shoot aliens." The surface is messages + composer; the
 * chat's New chat / Switch agent live behind a single ⋯ menu that ChatShell
 * portals into the shell top bar (not floating on the canvas).
 * @param props - Route props.
 * @param props.params - The locale route params.
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

  // Workspace-scoped greeting ("Metacto" eyebrow + "Ask Metacto Revenue") —
  // composed from the account + project names, never an agent name. The
  // chat page mounts under the dashboard layout, which already guarantees the
  // project row exists.
  const [ws] = orgId
    ? await db
        .select({ projectName: projectSchema.name, accountName: tenantAccountSchema.name })
        .from(projectSchema)
        .innerJoin(tenantAccountSchema, eq(projectSchema.accountId, tenantAccountSchema.id))
        .where(eq(projectSchema.id, orgId))
        .limit(1)
    : [];
  const greeting = workspaceGreeting(ws?.accountName, ws?.projectName);

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
        agentSlug={coordinatorSlug}
        greeting={greeting}
        suggestions={chips.map(c => ({ label: c.label, prompt: c.prompt }))}
      />
    </div>
  );
}
