/**
 * THE FIRST TURN IS READ BY A MODEL (conversation 397, 2026-09-30).
 *
 * A person asked for a change to a product's document page and wrote "Please
 * file it and build it." The keyword router scored the words against each
 * agent's handles and sent it to the wiki researcher, which had no factory
 * tools and improvised for five minutes. The router now asks a small model
 * which seat owns the work — with each seat's record types, tools and skills
 * in front of it — and routes on the typed answer; the keyword scorer is only
 * the fallback when that read fails or is slow.
 *
 * The reference case is fictional: Northwind builds Send, a document
 * signing app.
 */
import type { RoutableAgent } from './router';
import { describe, expect, it, vi } from 'vitest';
import { chooseAgent, ROUTE_CONFIDENCE_BAR, routeFirstTurn } from './router';
import { readRoute, seatLines } from './routeRead';

/** The reference roster: a researcher seat, a product-manager seat that owns `request`, and a lead. */
const researcher: RoutableAgent = {
  slug: 'wiki-researcher',
  name: 'Wiki researcher',
  description: 'Answers first and writes it down: researches a question against the wiki, the knowledge index and the web, plans as options / decision / next steps, and offers to put the standing part on a page the moment a conversation produces one.',
  handles: ['wiki', 'standing rules', 'standing fact', 'research', 'plan', 'decision'],
  suggestions: [{ label: 'Research this', prompt: 'Research the following against the wiki first, then write down what should stand.' }],
  initiative: 'high',
  skills: ['research-a-question'],
};
const productManager: RoutableAgent = {
  slug: 'product-manager',
  name: 'Product manager',
  description: 'PM. Owns the loop from the ask to the contract. Reads every request as the asker wrote it, decides in scope or not, writes the plan when the work needs one and the task contract when it is approved, keeps a ranked backlog.',
  handles: ['backlog', 'priorities', 'requests', 'bug', 'bug report'],
  initiative: 'normal',
  objectTypes: ['request', 'architecture_plan', 'engineering_task', 'release'],
  tools: ['product_access'],
  skills: ['triage-request', 'write-architecture-plan'],
};
const lead: RoutableAgent = {
  slug: 'northwind-lead',
  name: 'Northwind lead',
  description: 'Runs the Northwind workspace: the week, the people, what is waiting on whom.',
  handles: ['weekly review', 'status'],
};
const ROSTER = [lead, researcher, productManager];
const OWNERS = { 'product-manager': ['request'] };
const MESSAGE = 'On Send\'s document page, add a line under the document title that says when it was last opened and by whom. Senders keep asking whether a signer has seen it, and today the only way to know is the activity log. Keep the plan small: one line, no new page. Please file it and build it.';

/**
 * A model bound to the one report tool, answering with these fields.
 * @param args - The fields it reports.
 * @param seen - Collects the bind options and the messages it was sent.
 */
function modelSaying(args: Record<string, unknown>, seen: unknown[] = []) {
  return {
    bindTools: (tools: Array<{ name: string }>, opts: unknown) => {
      seen.push({ tools: tools.map(t => t.name), opts });
      return { invoke: async (messages: unknown) => {
        seen.push(messages);
        return { tool_calls: [{ name: tools[0]!.name, args }] };
      } };
    },
  } as never;
}

function humanText(seen: unknown[]): string {
  const messages = seen[1] as Array<{ content: unknown }>;
  return String(messages[1]!.content);
}

describe('the reference case: "file it and build it" goes to the seat that owns requests', () => {
  it('the keyword scorer alone sends it to the researcher — the specimen', () => {
    expect(chooseAgent({ agents: ROSTER, message: MESSAGE, leadSlug: lead.slug, surface: 'chat' })?.chosen).toBe('wiki-researcher');
  });

  it('the model is shown what each seat owns, and the turn routes on its typed answer', async () => {
    const seen: unknown[] = [];
    const model = modelSaying({ chosen: 'product-manager', confidence: 0.92, reason: 'They ask for a change to Send filed and built; the product manager owns requests.' }, seen);
    const decision = await routeFirstTurn(
      { orgId: 'org_route', agents: ROSTER, message: MESSAGE, leadSlug: lead.slug, surface: 'chat' },
      { owners: async () => OWNERS, read: input => readRoute(input, model) },
    );

    expect(decision).toMatchObject({ chosen: 'product-manager', defaulted: false, decidedBy: 'model', confidence: 0.92, surface: 'chat' });
    expect(decision?.reason).toMatch(/owns requests/);
    expect(seen[0]).toEqual({ tools: ['report_route'], opts: { tool_choice: 'report_route' } });

    const prompt = humanText(seen);

    expect(prompt).toContain(MESSAGE);
    expect(prompt).toContain('- northwind-lead (Northwind lead) — the workspace lead');
    expect(prompt).toMatch(/- product-manager \(Product manager\)[\s\S]*answers for these record types: request[\s\S]*reads and files records of type: request, architecture_plan[\s\S]*granted tools: product_access[\s\S]*skills: triage-request/);
  });
});

describe('the typed read', () => {
  it('throws when the model answers out of shape or without the tool, so the caller records why', async () => {
    const input = { orgId: 'org_route', message: 'hi', agents: ROSTER, leadSlug: lead.slug };

    await expect(readRoute(input, modelSaying({ chosen: 'product-manager', confidence: 'high', reason: 'x' }))).rejects.toThrow(/out of shape: confidence/);
    await expect(readRoute(input, { bindTools: () => ({ invoke: async () => ({ tool_calls: [] }) }) } as never)).rejects.toThrow(/without the report tool/);
  });

  it('writes a seat with only what it has', () => {
    expect(seatLines({ slug: 'a', name: 'A' }, null)).toBe('- a (A)');
  });
});

describe('routing on the read', () => {
  const route = (read: (input: { signal?: AbortSignal }) => Promise<{ chosen: string; confidence: number; reason: string }>, timeoutMs?: number) =>
    routeFirstTurn({ orgId: 'org_route', agents: ROSTER, message: MESSAGE, leadSlug: lead.slug, surface: 'mcp' }, { owners: async () => OWNERS, read, timeoutMs });

  it('below the confidence bar, the workspace lead answers and the reason says what the model leaned to', async () => {
    const d = await route(async () => ({ chosen: 'wiki-researcher', confidence: ROUTE_CONFIDENCE_BAR - 0.2, reason: 'Maybe a research question.' }));

    expect(d).toMatchObject({ chosen: 'northwind-lead', defaulted: true, decidedBy: 'model', confidence: 0.3 });
    expect(d?.reason).toMatch(/leaned to wiki-researcher at 0.3/);
  });

  it('a pick that is not an active agent falls back to the keywords, and says so', async () => {
    const d = await route(async () => ({ chosen: 'release-engineer', confidence: 0.9, reason: 'Ships it.' }));

    expect(d).toMatchObject({ chosen: 'wiki-researcher', decidedBy: 'keywords', fallback: 'named release-engineer, which is not an active agent here' });
    expect(d?.reason).toMatch(/^The model read named release-engineer.*so the keyword match decided: wiki-researcher matched/);
  });

  it('a failed read falls back to the keywords with the failure recorded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = await route(async () => {
      throw new Error('rate limited');
    });

    expect(d).toMatchObject({ chosen: 'wiki-researcher', decidedBy: 'keywords', fallback: 'failed (rate limited)' });
  });

  it('a read slower than the bound is abandoned: the keywords decide, and the call is aborted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let aborted = false;
    const started = Date.now();
    const d = await route(input => new Promise((resolve) => {
      input.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      setTimeout(() => resolve({ chosen: 'product-manager', confidence: 1, reason: 'late' }), 5_000);
    }), 50);

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(aborted).toBe(true);
    expect(d).toMatchObject({ chosen: 'wiki-researcher', decidedBy: 'keywords', fallback: 'timed out after 50 ms' });
  });

  it('merges the workspace\'s type owners into the seats the model reads', async () => {
    let seats: RoutableAgent[] = [];
    await routeFirstTurn(
      { orgId: 'org_route', agents: ROSTER, message: MESSAGE, leadSlug: lead.slug, surface: 'chat' },
      { owners: async () => OWNERS, read: async (input) => {
        seats = input.agents;
        return { chosen: 'product-manager', confidence: 0.9, reason: 'owns requests' };
      } },
    );

    expect(seats.find(s => s.slug === 'product-manager')?.owns).toEqual(['request']);
    expect(seats.find(s => s.slug === 'wiki-researcher')?.owns).toEqual([]);
  });

  it('one active agent answers without a model call; none, and there is no decision', async () => {
    const read = vi.fn();

    expect(await routeFirstTurn({ orgId: 'org_route', agents: [productManager, { ...researcher, active: false }], message: MESSAGE, surface: 'chat' }, { read, owners: async () => ({}) })).toMatchObject({ chosen: 'product-manager', decidedBy: 'roster' });
    expect(await routeFirstTurn({ orgId: 'org_route', agents: [{ ...researcher, active: 'false' }], message: MESSAGE, surface: 'chat' }, { read })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

/**
 * The same reference case against the real classifier. Skipped unless a key
 * is handed in as `VOCION_ROUTER_LIVE_KEY` (the unit env replaces
 * `ANTHROPIC_API_KEY` with a fixture), so CI never calls a model.
 */
const LIVE_KEY = process.env.VOCION_ROUTER_LIVE_KEY;

describe.skipIf(!LIVE_KEY)('the reference case, live', () => {
  it('routes "file it and build it" to the owner of requests', async () => {
    const { buildChatModel } = await import('@/libs/llm/langchain');
    process.env.ANTHROPIC_API_KEY = LIVE_KEY;
    const model = buildChatModel('classifier', { provider: 'anthropic', temperature: 0, streaming: false, maxTokens: 300 });
    const started = Date.now();
    const decision = await routeFirstTurn(
      { orgId: 'org_route_live', agents: ROSTER, message: MESSAGE, leadSlug: lead.slug, surface: 'chat' },
      { owners: async () => OWNERS, read: input => readRoute(input, model as never) },
    );
    console.warn('live route', { ms: Date.now() - started, decision });

    expect(decision).toMatchObject({ chosen: 'product-manager', decidedBy: 'model' });
  });
});
