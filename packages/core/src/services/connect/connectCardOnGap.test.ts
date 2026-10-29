import type * as RealRegistry from '@/libs/connect/registry';
import type { RuntimeContext } from '@/services/agents/types';
import { tool } from '@langchain/core/tools';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

// Every login app is set up on this test's server, whatever the developer's
// .env holds, so the card reads the same on a laptop and in CI.
vi.mock('@/libs/connect/registry', async (importOriginal) => {
  const real = await importOriginal<typeof RealRegistry>();
  return { ...real, connectOptionFor: async (orgId: string, slug: string) => {
    const option = await real.connectOptionFor(orgId, slug);
    return option ? { ...option, configured: true } : null;
  } };
});

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { connectCardForGap, hasOneClickSignIn, SHOW_THE_CONNECT_CARD, withConnectCardOnGap } = await import('./connectCardOnGap');
const { listCapabilitiesTool } = await import('@/services/agents/tools/capabilities');

const ORG = 'org_gap_card';

function turn(emit: (event: unknown) => void, over: Partial<RuntimeContext> = {}): RuntimeContext {
  return { orgId: ORG, userId: 'usr-gap-admin', agentSlug: 'workspace-lead', conversationId: 11, connectorSources: [], enabledPlugins: [], emit, ...over } as unknown as RuntimeContext;
}

/** A tool that read GitHub and found it was not connected, the way connector tools say so. */
function githubReadTool() {
  return tool(async () => 'No GitHub source is connected in this workspace, so there is nothing to read.', {
    name: 'github_repo_read',
    description: 'Read a repository.',
    schema: z.object({ repo: z.string() }),
  });
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct_gap_card', name: 'Northwind', slug: 'northwind-gap-card' } as never);
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_gap_card', slug: 'gap-card', name: 'Northwind' } as never);
  await db.insert(userSchema).values({ id: 'usr-gap-admin', name: 'Ada', email: 'ada@northwind.example' } as never);
  await db.insert(accountMembershipSchema).values({ accountId: 'acct_gap_card', userId: 'usr-gap-admin', role: 'admin' });
});

describe('a system that is not connected is answered with its connect card (2026-10-29)', () => {
  it('a tool that could not run for want of GitHub shows the Log in with GitHub card in the same turn', async () => {
    const emit = vi.fn();
    const out = await withConnectCardOnGap(githubReadTool(), turn(emit)).invoke({ repo: 'example-org/northwind-site' });

    expect(emit).toHaveBeenCalledTimes(1);

    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ kind: 'link', title: 'Connect GitHub', hrefLabel: 'Log in with GitHub', secondaryHrefLabel: 'Use an API key instead' });
    expect(String(out)).toContain('No GitHub source is connected');
    expect(String(out)).toContain('THE CARD IS UP');
    expect(String(out)).toContain('never offer to walk them through it');
  });

  it('shows one card per system per turn, however many tools find the gap', async () => {
    const emit = vi.fn();
    const ctx = turn(emit);
    await withConnectCardOnGap(githubReadTool(), ctx).invoke({ repo: 'a' });
    const again = await withConnectCardOnGap(githubReadTool(), ctx).invoke({ repo: 'b' });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(String(again)).not.toContain('THE CARD IS UP');
  });

  it('asking about a system by name (list_capabilities connector) carries the card when it is not connected', async () => {
    const emit = vi.fn();
    const out = await listCapabilitiesTool(turn(emit)).invoke({ connector: 'github' });

    expect(emit.mock.calls.map(c => c[0].card?.title)).toEqual(['Connect GitHub']);
    expect(String(out).startsWith('NOT CONNECTED — THE CARD IS UP')).toBe(true);
  });

  it('shows nothing on an agent\'s own schedule, where nobody could tap it', async () => {
    const emit = vi.fn();

    expect(await connectCardForGap(turn(emit, { conversationId: undefined, missionRunId: 4 } as Partial<RuntimeContext>), 'github')).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it('only a one-click sign-in gets the card unasked; the rule forbids walking them through it', () => {
    expect(hasOneClickSignIn('github')).toBe(true);
    expect(hasOneClickSignIn('no-such-connector')).toBe(false);
    expect(SHOW_THE_CONNECT_CARD).toContain('walk them through');
    expect(SHOW_THE_CONNECT_CARD).toContain('offer_connection');
  });
});
