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
  const dbAgents = orgId ? await listAgents(orgId) : [];

  // Workspace identity — account + project rows power the greeting AND name
  // the workspace lead. The chat page mounts under the dashboard layout,
  // which already guarantees the project row exists.
  const [ws] = orgId
    ? await db
        .select({
          projectName: projectSchema.name,
          accountName: tenantAccountSchema.name,
          leadAgentSlug: projectSchema.leadAgentSlug,
        })
        .from(projectSchema)
        .innerJoin(tenantAccountSchema, eq(projectSchema.accountId, tenantAccountSchema.id))
        .where(eq(projectSchema.id, orgId))
        .limit(1)
    : [];

  // Chat defaults to WORKSPACE scope: opening /dashboard/chat lands on the
  // workspace lead (`project.leadAgentSlug`, F1) — the front-door agent that
  // runs the whole workspace and consults the team leads — so the user just
  // starts typing, never has to pick an agent. When no workspace lead is
  // configured, fall back to `groupAgentHierarchy`'s first primary (a team
  // lead if one exists, else the first parentless agent). Deterministic and
  // never a dangling/deleted slug.
  const hierarchy = groupAgentHierarchy(dbAgents);
  const workspaceLeadSlug = ws?.leadAgentSlug ?? undefined;
  const coordinatorSlug = (workspaceLeadSlug && dbAgents.some(a => a.slug === workspaceLeadSlug))
    ? workspaceLeadSlug
    : hierarchy[0]?.primary.slug;

  // Order the flat list workspace-lead-first, then each team (lead followed
  // by its specialists), so both the fallback default (agents[0]) and the
  // switcher read workspace-first.
  const orderedHierarchy = [...hierarchy].sort((a, b) =>
    Number(b.primary.slug === coordinatorSlug) - Number(a.primary.slug === coordinatorSlug));
  const ordered = orderedHierarchy.flatMap(({ primary, specialists }) => [primary, ...specialists]);

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

  // Workspace-scoped greeting ("Metacto" eyebrow + "Ask Revenue") — a SHORT
  // label composed from the account + project names, never an agent name.
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
        agentSlug={requestedSlug ?? coordinatorSlug}
        greeting={greeting}
        suggestions={chips.map(c => ({ label: c.label, prompt: c.prompt }))}
        initialComposerValue={seededPrompt}
      />
    </div>
  );
}
