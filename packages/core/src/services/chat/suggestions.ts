import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { briefingSchema, missionRunSchema } from '@/models/Schema';

/**
 * Workspace suggestion chips — the empty-state prompt starters.
 *
 * "Insert quarter, shoot aliens": the home is org eyebrow + "Ask <workspace>"
 * + a couple of tappable chips + composer. These chips are the whole
 * invitation, so they should point at what actually matters RIGHT NOW, not a
 * hardcoded marketing list.
 *
 * v1 signal sources, in priority order, each degrading gracefully to the next:
 *
 *   (a) URGENCY / BRIEF — recent briefing output + mission runs waiting on a
 *       human. When the workspace has fresh, time-sensitive work, one or two
 *       chips surface it so the operator lands straight on it. This is the
 *       seam the future "Founder GTM — time-sensitive action items" chip
 *       plugs into (see the TODO in `urgencyChips`).
 *
 *   (b) TEAM / LEAD CAPABILITIES — the agents' own declared `suggestions`,
 *       sampled ACROSS different agents/leads so the chips cover the team's
 *       breadth ("what needs my attention", "pipeline health", "draft a
 *       proposal") rather than three variations from one agent.
 *
 * Returns 2–4 chips. Fast by design: two cheap indexed reads + in-memory
 * ranking, no LLM on the page-load path.
 */

export type WorkspaceChip = {
  /** Short tappable label. */
  label: string;
  /** The prompt injected + auto-sent when tapped. */
  prompt: string;
  /** Which agent/lead this should route to, when known. */
  agentSlug?: string;
  /** Provenance — for telemetry + graceful-degradation notes. */
  source: 'urgency' | 'capability';
};

/** Minimal agent shape the chip builder needs — a subset of the chat AgentOption. */
export type ChipAgent = {
  slug: string;
  name: string;
  role?: 'lead' | 'specialist';
  parentSlug?: string;
  suggestions?: Array<{ label: string; prompt: string }>;
};

const MAX_CHIPS = 4;
/** Briefings older than this aren't "what needs my attention today". */
const URGENCY_WINDOW_DAYS = 3;

/**
 * (a) Urgency signal — fresh briefings + work parked in the review queue.
 *
 * EXTENSION POINT (F1): when the workspace exposes flagged-urgent / mission
 * "time-sensitive action items" (e.g. the Founder GTM brief), surface them
 * here as the top-priority chip — a label like "Founder GTM — time-sensitive
 * action items" routed to the owning lead. That data doesn't exist in this
 * pre-F1 build, so today this returns at most a "latest briefing" chip and an
 * "awaiting your approval" chip; everything else falls through to capability
 * chips.
 * @param orgId - Active project/org id to read briefings + mission runs for.
 * @param coordinatorSlug - The lead urgency chips route to.
 */
async function urgencyChips(orgId: string, coordinatorSlug?: string): Promise<WorkspaceChip[]> {
  const chips: WorkspaceChip[] = [];

  const since = new Date(Date.now() - URGENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // TODO(F1): read flagged-urgent / time-sensitive mission action items here
  // and push them FIRST — they outrank a routine briefing. Shape roughly:
  //   { label: `${missionName} — time-sensitive action items`, prompt: …,
  //     agentSlug: ownerLead, source: 'urgency' }

  const [latestBrief] = await db
    .select({ title: briefingSchema.title, createdAt: briefingSchema.createdAt })
    .from(briefingSchema)
    .where(and(eq(briefingSchema.orgId, orgId), gte(briefingSchema.createdAt, since)))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(1);

  if (latestBrief) {
    chips.push({
      label: 'What needs my attention today?',
      prompt: `Walk me through the latest briefing ("${latestBrief.title}") — the headline, what's at risk, and the moves that matter most today.`,
      agentSlug: coordinatorSlug,
      source: 'urgency',
    });
  }

  const awaiting = await db
    .select({ title: missionRunSchema.title })
    .from(missionRunSchema)
    .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, 'awaiting_review')))
    .orderBy(desc(missionRunSchema.updatedAt))
    .limit(1);

  if (awaiting.length > 0) {
    chips.push({
      label: 'Review what\'s waiting on me',
      prompt: 'Summarize everything currently waiting on my approval and what each one is for, so I can clear the queue.',
      agentSlug: coordinatorSlug,
      source: 'urgency',
    });
  }

  return chips;
}

/**
 * (b) Capability signal — sample the agents' declared suggestions ACROSS
 * different agents so the chips cover the team's breadth. Coordinator-first,
 * then one from each specialist, before taking any agent's second suggestion.
 * @param agents - The chat agent list; real agents carry `suggestions`.
 */
function capabilityChips(agents: ChipAgent[]): WorkspaceChip[] {
  // Real agents only (drop the virtual __search__ entry), coordinator/leads
  // first so their front-door suggestion leads the list.
  const ranked = agents
    .filter(a => a.slug !== '__search__' && (a.suggestions?.length ?? 0) > 0)
    .sort((a, b) => (a.role === 'lead' ? 0 : 1) - (b.role === 'lead' ? 0 : 1));

  const chips: WorkspaceChip[] = [];
  // Round-robin: pass `depth` = which suggestion index to take from each agent,
  // so we exhaust "one per agent" (breadth) before doubling up on any agent.
  const maxDepth = Math.max(0, ...ranked.map(a => a.suggestions?.length ?? 0));
  for (let depth = 0; depth < maxDepth && chips.length < MAX_CHIPS; depth++) {
    for (const agent of ranked) {
      if (chips.length >= MAX_CHIPS) {
        break;
      }
      const s = agent.suggestions?.[depth];
      if (s) {
        chips.push({ label: s.label, prompt: s.prompt, agentSlug: agent.slug, source: 'capability' });
      }
    }
  }
  return chips;
}

/**
 * Build the empty-state chips for a workspace. Urgency chips lead (capped at
 * 2 so the surface stays quiet); capability chips fill the rest up to 4.
 * De-duplicated by prompt.
 * @param opts - orgId + the chat agent list + optional coordinator slug.
 * @param opts.orgId - Active project/org id.
 * @param opts.agents - The chat agent list (real agents carry `suggestions`).
 * @param opts.coordinatorSlug - The workspace coordinator urgency chips route to.
 */
export async function buildWorkspaceChips(opts: {
  orgId: string;
  agents: ChipAgent[];
  coordinatorSlug?: string;
}): Promise<WorkspaceChip[]> {
  const coordinatorSlug = opts.coordinatorSlug
    ?? opts.agents.find(a => a.role === 'lead')?.slug
    ?? opts.agents.find(a => a.slug !== '__search__')?.slug;

  // (a) urgency — best-effort; a DB hiccup must never break the empty state.
  let urgency: WorkspaceChip[] = [];
  try {
    urgency = (await urgencyChips(opts.orgId, coordinatorSlug)).slice(0, 2);
  } catch {
    urgency = [];
  }

  // (b) capability — always available from agent config.
  const capability = capabilityChips(opts.agents);

  const seen = new Set<string>();
  const merged: WorkspaceChip[] = [];
  for (const chip of [...urgency, ...capability]) {
    const key = chip.prompt.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(chip);
    if (merged.length >= MAX_CHIPS) {
      break;
    }
  }

  return merged;
}
