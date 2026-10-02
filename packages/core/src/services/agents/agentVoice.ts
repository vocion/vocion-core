/**
 * READ AND SET HOW AN AGENT TALKS — the one service the agent's page, the
 * API, MCP and chat all call (parity: Chris, 2026-09-29). A setting made here
 * is the agent's `voice_override`: the next workspace apply rewrites `voice`
 * from the YAML and leaves this alone, so a person's choice stands until a
 * person changes it (or clears it, and the YAML's voice returns).
 */
import type { ResolvedVoice, Voice } from '@/libs/agents/voice';
import { and, eq } from 'drizzle-orm';
import { resolveVoice, VoiceSchema } from '@/libs/agents/voice';
import { db } from '@/libs/DB';
import { agentSchema } from '@/models/Schema';

export type AgentVoiceReading = {
  slug: string;
  /** What the agent runs with. */
  voice: ResolvedVoice;
  /** What its YAML says. */
  fromWorkspace: Voice | null;
  /** What a person set, over the YAML. */
  override: Voice | null;
};

export class AgentVoiceError extends Error {
  constructor(public code: 'NOT_FOUND' | 'VALIDATION_FAILED', message: string) {
    super(message);
    this.name = 'AgentVoiceError';
  }
}

async function row(orgId: string, slug: string) {
  const [agent] = await db.select({ id: agentSchema.id, slug: agentSchema.slug, voice: agentSchema.voice, voiceOverride: agentSchema.voiceOverride })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)))
    .limit(1);
  if (!agent) {
    throw new AgentVoiceError('NOT_FOUND', `No agent "${slug}" in this workspace.`);
  }
  return agent;
}

/**
 * How an agent talks, and where each part came from.
 * @param orgId - The workspace.
 * @param slug - The agent.
 */
export async function getAgentVoice(orgId: string, slug: string): Promise<AgentVoiceReading> {
  const agent = await row(orgId, slug);
  return { slug: agent.slug, voice: resolveVoice(agent.voice, agent.voiceOverride), fromWorkspace: agent.voice ?? null, override: agent.voiceOverride ?? null };
}

/**
 * Set how an agent talks: the keys given replace the person's earlier ones;
 * `null` for a key clears it back to the YAML; `clear: true` clears them all.
 * @param orgId - The workspace.
 * @param slug - The agent.
 * @param change - The settings to change.
 * @param opts - Options.
 * @param opts.clear - Drop every setting a person made.
 */
export async function setAgentVoice(orgId: string, slug: string, change: { [K in keyof Voice]?: Voice[K] | null }, opts: { clear?: boolean } = {}): Promise<AgentVoiceReading> {
  const agent = await row(orgId, slug);
  const merged: Record<string, unknown> = opts.clear ? {} : { ...(agent.voiceOverride ?? {}) };
  for (const [k, v] of Object.entries(change ?? {})) {
    if (v === null) {
      delete merged[k];
    } else if (v !== undefined) {
      merged[k] = v;
    }
  }
  const parsed = VoiceSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AgentVoiceError('VALIDATION_FAILED', `Not a voice: ${parsed.error.issues.map(i => `${i.path.join('.') || 'voice'} ${i.message}`).join('; ')}. length is brief | standard | detailed, narration is off | on, creativity is 0 to 1, style is a wiki page slug.`);
  }
  const override = Object.keys(parsed.data).length > 0 ? parsed.data : null;
  await db.update(agentSchema).set({ voiceOverride: override }).where(eq(agentSchema.id, agent.id));
  const { forgetAgentBlueprint } = await import('@/services/agents/harness');
  forgetAgentBlueprint(orgId, slug);
  return { slug: agent.slug, voice: resolveVoice(agent.voice, override), fromWorkspace: agent.voice ?? null, override };
}
