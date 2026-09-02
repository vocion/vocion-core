import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { briefingSchema, missionRunSchema } from '@/models/Schema';
import { synthesizeAgentChips } from './synthesis';

/**
 * Workspace suggestion chips — the empty-state prompt starters.
 *
 * "Insert quarter, shoot aliens": the home is org eyebrow + "Ask <workspace>"
 * + a couple of tappable chips + composer. These chips are the whole
 * invitation, so they should point at what actually matters RIGHT NOW, not a
 * hardcoded marketing list.
 *
 * Signal sources, in priority order, each degrading gracefully to the next:
 *
 *   (a) SYNTHESIZED — per lead, from its declared context (mission × skills
 *       × tracker state; see `./synthesis.ts`), sampled ACROSS leads for
 *       breadth. The head of this list is the two constant-label anchors
 *       ("What should I do?" / "What can you do?") — the only chips visible
 *       before the "More" caret; specific starters rank behind it.
 *
 *   (b) URGENCY / BRIEF — recent briefing output + mission runs waiting on a
 *       human. Folded behind "More" alongside the specific synthesized
 *       starters.
 *
 *   (c) TEAM / LEAD CAPABILITIES (legacy YAML) — agents' `suggestions`
 *       survive only as last-resort filler for agents with nothing declared
 *       to synthesize from (no missions, no tracker) — per the
 *       emergent-capability architecture, chips must derive from live
 *       declared context, not canned prompt strings.
 *
 * Returns up to 6 chips (UI shows 2 + More). The synthesis layer is one
 * cached small-model call per lead (15-min TTL + apply-time bust) with a
 * deterministic no-LLM fallback, so a cold page load pays at most a short
 * Haiku call and warm loads pay nothing.
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

/**
 * Total chips returned. The UI shows the first 2 (the constant-label anchors,
 * per Chris 2026-07-20: "What should I do?" + "What can you do?") and folds
 * the rest — urgency + specific synthesized starters — behind the quiet
 * "More" caret.
 */
const MAX_CHIPS = 6;
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
 * (b) Capability signal — synthesized per lead from mission × skills ×
 * tracker state. Leads front their teams, so their synthesized chips ARE the
 * team's live capabilities; round-robin across leads keeps breadth. Capped
 * at 3 leads so a cold cache costs at most 3 parallel small-model calls.
 * @param orgId - Active project/org id.
 * @param agents - The chat agent list (used to pick leads).
 */
async function synthesizedCapabilityChips(orgId: string, agents: ChipAgent[]): Promise<WorkspaceChip[]> {
  const real = agents.filter(a => a.slug !== '__search__');
  const leads = real.filter(a => a.role === 'lead');
  const targets = (leads.length > 0 ? leads : real).slice(0, 3);

  const perAgent = await Promise.all(targets.map(async (agent) => {
    try {
      const chips = await synthesizeAgentChips(orgId, agent.slug);
      return chips.map(c => ({
        label: c.label,
        prompt: c.prompt,
        agentSlug: agent.slug,
        source: 'capability' as const,
      }));
    } catch {
      // Synthesis is best-effort — a failure for one lead must never break
      // the empty state; the YAML filler below covers the gap.
      return [];
    }
  }));

  // Round-robin: one chip per lead (breadth) before any lead's second chip.
  const merged: WorkspaceChip[] = [];
  const maxDepth = Math.max(0, ...perAgent.map(list => list.length));
  for (let depth = 0; depth < maxDepth; depth++) {
    for (const list of perAgent) {
      const chip = list[depth];
      if (chip) {
        merged.push(chip);
      }
    }
  }
  return merged;
}

/**
 * (b-fallback) Legacy capability signal — the agents' declared YAML
 * `suggestions`, sampled ACROSS different agents. Only fills slots the
 * synthesized chips left empty (agents with no missions/tracker declared).
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
 * Build the empty-state chips for a workspace. Synthesized chips lead — the
 * first two are the constant-label anchors the UI shows before "More" —
 * then urgency chips (capped at 2), then YAML capability filler for agents
 * with nothing declared to synthesize from. Capped at {@link MAX_CHIPS}.
 * De-duplicated by prompt and label.
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

  // (a) urgency + (b) synthesized capability — both best-effort and gathered
  // in parallel; a DB or model hiccup must never break the empty state.
  const [urgencyResult, synthesizedResult] = await Promise.allSettled([
    urgencyChips(opts.orgId, coordinatorSlug),
    synthesizedCapabilityChips(opts.orgId, opts.agents),
  ]);
  const urgency = urgencyResult.status === 'fulfilled' ? urgencyResult.value.slice(0, 2) : [];
  const synthesized = synthesizedResult.status === 'fulfilled' ? synthesizedResult.value : [];

  // (b-fallback) YAML capability chips — fill only what synthesis left empty.
  const capability = capabilityChips(opts.agents);

  // Order: synthesized chips FIRST — their head is the two constant-label
  // anchors ("What should I do?" / "What can you do?"), which are the only
  // chips visible before "More" — then urgency, then YAML filler, all behind
  // the caret. De-dupe by prompt AND by label — two chips can carry different
  // prompts under the same visible label (e.g. multiple leads' anchors), and
  // a duplicated chip label reads as a bug regardless of what it sends; the
  // first (coordinator lead's) wins.
  const seen = new Set<string>();
  const merged: WorkspaceChip[] = [];
  for (const chip of [...synthesized, ...urgency, ...capability]) {
    const promptKey = `p:${chip.prompt.trim().toLowerCase()}`;
    const labelKey = `l:${chip.label.trim().toLowerCase()}`;
    if (seen.has(promptKey) || seen.has(labelKey)) {
      continue;
    }
    seen.add(promptKey);
    seen.add(labelKey);
    merged.push(chip);
    if (merged.length >= MAX_CHIPS) {
      break;
    }
  }

  return merged;
}
