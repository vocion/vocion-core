import type { AgentOption } from './types';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { assistantName, isPersonalAssistant } from '@/libs/workspace/assistantName';
import { isSeededLead, leadName, leadWorkspaceLabel } from '@/libs/workspace/leadName';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import { groupAgentHierarchy, listAgents } from '@/services/AgentService';

/**
 * Built-in virtual agent — corpus search without an LLM in the loop.
 * Always appended to the agent list so users have a fallback path
 * even before any agents are authored.
 */
const SEARCH_ONLY_AGENT: AgentOption = {
  slug: '__search__',
  name: 'Search only',
  icon: 'search',
  placeholder: 'Search across your connected systems…',
};

/** Everything a chat surface needs to render its agent picker and greeting. */
export type ChatAgentContext = {
  /** Workspace-lead-first, then each team (lead followed by its specialists). */
  agents: AgentOption[];
  /** Agent a fresh chat opens on. Undefined when the workspace has no agents. */
  coordinatorSlug?: string;
  /** Tenant account name — the greeting eyebrow. */
  accountName?: string;
  /** Project name — the subject of the greeting headline. */
  projectName?: string;
};

/**
 * Loads the agent list both chat surfaces (the full `/dashboard/chat` page and
 * the floating chat bubble) pick from, plus the workspace names the greeting
 * is composed from.
 *
 * Chat defaults to WORKSPACE scope: opening a chat lands on the workspace lead
 * (`project.leadAgentSlug`) — the front-door agent that runs the whole
 * workspace and consults the team leads — so the user just starts typing and
 * never has to pick an agent. When no workspace lead is configured, fall back
 * to `groupAgentHierarchy`'s first primary (a team lead if one exists, else the
 * first parentless agent). Deterministic, and never a dangling/deleted slug.
 * @param orgId - Organization (project) ID whose agents to load.
 */
export async function loadChatAgentContext(orgId: string): Promise<ChatAgentContext> {
  let dbAgents = await listAgents(orgId);
  // A workspace with nobody in it gets its first agent now: a Personal
  // workspace its person's assistant (`personalAssistant.ts`), a shared one
  // its workspace lead (`workspaceLead.ts`). One that never had it, or lost
  // it, heals the first time anyone opens chat instead of opening on an empty
  // state (Metacto, 2026-10-09). A failure leaves the roster as it was, and
  // the empty state offers Retry.
  if (dbAgents.length === 0) {
    const [{ ensurePersonalAssistant }, { ensureWorkspaceLead }] = await Promise.all([
      import('@/services/workspace/personalAssistant'),
      import('@/services/workspace/workspaceLead'),
    ]);
    const seeded = await ensurePersonalAssistant(orgId).catch((error: unknown) => {
      console.error('chat: could not seed the personal assistant', { orgId, error: error instanceof Error ? error.message : String(error) });
      return false;
    }) || await ensureWorkspaceLead(orgId).catch(() => false);
    if (seeded) {
      dbAgents = await listAgents(orgId);
    }
  }

  // Workspace identity — account + project rows power the greeting AND name
  // the workspace lead. Both chat surfaces mount under the app shell, which
  // already guarantees the project row exists.
  const [workspace] = await db
    .select({
      projectName: projectSchema.name,
      projectKind: projectSchema.kind,
      accountName: tenantAccountSchema.name,
      leadAgentSlug: projectSchema.leadAgentSlug,
    })
    .from(projectSchema)
    .innerJoin(tenantAccountSchema, eq(projectSchema.accountId, tenantAccountSchema.id))
    .where(eq(projectSchema.id, orgId))
    .limit(1);

  const hierarchy = groupAgentHierarchy(dbAgents);
  const workspaceLeadSlug = workspace?.leadAgentSlug ?? undefined;
  const coordinatorSlug = (workspaceLeadSlug && dbAgents.some(agent => agent.slug === workspaceLeadSlug))
    ? workspaceLeadSlug
    : hierarchy[0]?.primary.slug;

  // Order the flat list workspace-lead-first, then each team (lead followed
  // by its specialists), so both the fallback default (agents[0]) and the
  // switcher read workspace-first.
  const orderedHierarchy = [...hierarchy].sort((a, b) =>
    Number(b.primary.slug === coordinatorSlug) - Number(a.primary.slug === coordinatorSlug));
  const ordered = orderedHierarchy.flatMap(({ primary, specialists }) => [primary, ...specialists]);

  // The seeded lead is named for the workspace ("Revenue lead"), or by the
  // given name an Org set ("Ava"), never "Workspace lead" (`leadName.ts`).
  const workspaceLabel = leadWorkspaceLabel(workspace?.accountName, workspace?.projectName);
  const personal = workspace?.projectKind === 'personal';
  const named = (agent: { slug: string; name: string }) => {
    // A person's own assistant: "your personal assistant on Metacto" until
    // they name it, then that name ("Ziggy") — `assistantName.ts`.
    if (personal && isPersonalAssistant(agent.slug)) {
      const n = assistantName({ agentName: agent.name, orgName: workspace?.accountName });
      return { name: n.given ?? 'Assistant', leadRole: n.role, personal: true as const, ...(n.given ? { givenName: n.given } : {}) };
    }
    if (!isSeededLead(agent.slug)) {
      return { name: agent.name };
    }
    const n = leadName({ agentName: agent.name, workspaceLabel });
    return { name: n.short, leadLabel: n.label, leadRole: n.role, ...(n.given ? { givenName: n.given } : {}) };
  };

  const agents: AgentOption[] = [
    ...ordered.map(agent => ({
      slug: agent.slug,
      ...named(agent),
      workspaceLabel,
      icon: 'bot' as const,
      role: (agent.role === 'lead' ? 'lead' : 'specialist') as 'lead' | 'specialist',
      parentSlug: agent.parentAgentSlug ?? undefined,
      eyebrow: agent.eyebrow ?? undefined,
      description: agent.description ?? undefined,
      suggestions: agent.suggestions ?? [],
      placeholder: `Message ${named(agent).name}…`,
      ...(agent.accent ? { accent: agent.accent } : {}),
      ...(workspace?.projectName ? { workspaceName: workspace.projectName } : {}),
    })),
    { ...SEARCH_ONLY_AGENT, ...(workspace?.projectName ? { workspaceName: workspace.projectName } : {}) },
  ];

  return {
    agents,
    coordinatorSlug,
    accountName: workspace?.accountName,
    projectName: workspace?.projectName,
  };
}
