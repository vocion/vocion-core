/**
 * How an agent talks, set by a person: kept over the YAML, key by key, and
 * never written by an apply (`agentVoice.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { getAgentVoice, setAgentVoice, AgentVoiceError } = await import('./agentVoice');

const ORG = 'org_agent_voice';

beforeEach(async () => {
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'product-manager', name: 'Product manager', systemPrompt: 'Be useful.', voice: { length: 'standard', creativity: 0.2 } } as never);
});

afterEach(async () => {
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
});

describe('setting how an agent talks', () => {
  it('reads the YAML voice under the platform default', async () => {
    const r = await getAgentVoice(ORG, 'product-manager');

    expect(r.voice).toEqual({ length: 'standard', narration: 'on', creativity: 0.2 });
    expect(r.override).toBeNull();
  });

  it('keeps a person\'s settings over the YAML, key by key; null resets one, clear resets all', async () => {
    await setAgentVoice(ORG, 'product-manager', { length: 'brief' });
    const both = await setAgentVoice(ORG, 'product-manager', { narration: 'off' });

    expect(both.voice).toEqual({ length: 'brief', narration: 'off', creativity: 0.2 });
    expect(both.override).toEqual({ length: 'brief', narration: 'off' });

    expect((await setAgentVoice(ORG, 'product-manager', { length: null })).voice.length).toBe('standard');
    expect((await setAgentVoice(ORG, 'product-manager', {}, { clear: true })).override).toBeNull();
  });

  it('refuses what is not a voice, and an agent that is not there', async () => {
    await expect(setAgentVoice(ORG, 'product-manager', { length: 'short' as never })).rejects.toBeInstanceOf(AgentVoiceError);
    await expect(getAgentVoice(ORG, 'nobody')).rejects.toBeInstanceOf(AgentVoiceError);
  });
});

describe('voice parity: the page, chat, MCP and the API set the same thing', () => {
  it('has the setting on each surface', async () => {
    const root = resolve(__dirname, '../../..');

    expect(existsSync(resolve(root, 'src/app/api/v1/agents/[slug]/voice/route.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src/interfaces/mcp/tools/voice-tools.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src/services/agents/tools/setVoice.ts'))).toBe(true);

    // The page's route, read from the router table (importing it pulls in auth).
    expect(readFileSync(resolve(root, 'src/routers/index.ts'), 'utf8')).toMatch(/agents: \{\s*setVoice: setAgentVoiceRoute/);
  });
});
