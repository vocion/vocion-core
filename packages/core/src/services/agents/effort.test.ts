/**
 * Effort levels (`effort.ts`): a level sets an envelope, never a step count;
 * the person's choice beats the agent's default beats Auto; the two ceilings
 * make the turn answer with tools off instead of stopping.
 */
import { describe, expect, it } from 'vitest';
import { personEffortChoice } from '@/services/AgentService';
import { autoFloor, CONSULT_TOOL, createEffortMiddleware, decideEffort, EffortCeilings, effortNote, envelopeFor, inferEffort, nextLevel, parseEffort, synthesisLevel } from './effort';

describe('choosing the level', () => {
  const auto = async () => ({ level: 'deep' as const, reason: 'research across months' });

  it('the person beats the agent beats Auto, and Auto says why', async () => {
    expect(await decideEffort({ person: 'quick', agent: 'deep', auto })).toEqual({ level: 'quick', chosenBy: 'person' });
    expect(await decideEffort({ person: 'auto', agent: 'standard', auto })).toEqual({ level: 'standard', chosenBy: 'agent' });
    expect(await decideEffort({ person: 'auto', agent: 'auto', auto })).toEqual({ level: 'deep', chosenBy: 'auto', reason: 'research across months' });
  });

  it('reads a thread\'s older strength/thinking setting as the level it amounts to', () => {
    expect(personEffortChoice(undefined)).toBe('auto');
    expect(personEffortChoice({ strength: 'balanced', effort: 'off', level: 'auto' })).toBe('auto');
    expect(personEffortChoice({ strength: 'fast', effort: 'off', level: 'auto' })).toBe('quick');
    expect(personEffortChoice({ strength: 'balanced', effort: 'high', level: 'auto' })).toBe('deep');
    expect(personEffortChoice({ strength: 'deep', effort: 'off', level: 'standard' })).toBe('standard');
  });

  it('auto reads the request with a small model and falls back to standard when it cannot', async () => {
    const said: string[] = [];
    const read = await inferEffort({ orgId: 'org-effort', message: 'What sales emails do I need to answer', model: async (_s, user) => {
      said.push(user);
      return { text: '{"level":"standard","reason":"gather and synthesise"}' };
    } });

    expect(read).toEqual({ level: 'standard', reason: 'gather and synthesise' });
    expect(said[0]).toContain('What sales emails do I need to answer');
    expect((await inferEffort({ orgId: 'org-effort', message: 'hi', model: async () => ({ text: 'not json' }) })).level).toBe('standard');
    expect((await inferEffort({ orgId: 'org-effort', message: 'hi', model: async () => {
      throw new Error('no key');
    } })).level).toBe('standard');
    expect(parseEffort('{"level":"enormous"}')).toBeNull();
  });
});

describe('the Auto floor', () => {
  it('never puts drafting or a check across systems on Quick, from the typed facts', () => {
    expect(parseEffort('{"level":"quick","reason":"revise a draft","drafts":true,"systems":0}')).toEqual({ level: 'standard', reason: 'drafting something you will send' });
    expect(parseEffort('{"level":"quick","reason":"contact lookup","drafts":false,"systems":2}')).toEqual({ level: 'standard', reason: 'checking 2 systems' });
    expect(parseEffort('{"level":"deep","reason":"plan","drafts":true,"systems":4}')).toEqual({ level: 'deep', reason: 'plan' });
    expect(parseEffort('{"level":"quick","reason":"calendar"}')).toEqual({ level: 'quick', reason: 'calendar' });
    expect(autoFloor({ drafts: false, systems: 1 })).toBeNull();
  });

  it('never puts a change to many records on Quick, from the typed count', () => {
    expect(parseEffort('{"level":"quick","reason":"clear old items","drafts":false,"systems":1,"changes":64}')).toEqual({ level: 'standard', reason: 'changing many records at once' });
    expect(parseEffort('{"level":"quick","reason":"approve one","drafts":false,"systems":1,"changes":1}')).toEqual({ level: 'quick', reason: 'approve one' });
    expect(parseEffort('{"level":"deep","reason":"audit","drafts":false,"systems":1,"changes":40}')).toEqual({ level: 'deep', reason: 'audit' });
    expect(autoFloor({ drafts: false, systems: 1, changes: 0 })).toBeNull();
  });
});

describe('a lead synthesising teams', () => {
  it('reads the typed team count from the answer', () => {
    expect(parseEffort('{"level":"standard","reason":"status across teams","drafts":false,"systems":3,"changes":0,"teams":3}')).toEqual({ level: 'standard', reason: 'status across teams', teams: 3 });
    expect(parseEffort('{"level":"quick","reason":"calendar"}')).toEqual({ level: 'quick', reason: 'calendar' });
  });

  it('runs Deep when a lead brings two or more teams\' work together, and says so', () => {
    const read = parseEffort('{"level":"standard","reason":"weekly status","drafts":false,"systems":3,"changes":0,"teams":3}')!;

    expect(synthesisLevel(read, { leadsTeammates: true })).toEqual({ level: 'deep', reason: 'synthesizing 3 teams', teams: 3 });
  });

  it('leaves an agent with no teammates, a one-team question and a Deep read alone', () => {
    const across = { level: 'standard' as const, reason: 'weekly status', teams: 2 };

    expect(synthesisLevel(across, { leadsTeammates: false })).toEqual(across);
    expect(synthesisLevel({ level: 'quick', reason: 'one deal', teams: 1 }, { leadsTeammates: true })).toEqual({ level: 'quick', reason: 'one deal', teams: 1 });
    expect(synthesisLevel({ level: 'deep', reason: 'audit the pipeline', teams: 4 }, { leadsTeammates: true })).toEqual({ level: 'deep', reason: 'audit the pipeline', teams: 4 });
    expect(synthesisLevel({ level: 'standard', reason: 'no count' }, { leadsTeammates: true })).toEqual({ level: 'standard', reason: 'no count' });
  });
});

describe('the envelope', () => {
  it('sets shape, not counts, and a workspace may move the ceilings', () => {
    const quick = envelopeFor('quick');

    expect(quick).toMatchObject({ strength: 'fast', thinking: 'off', consults: 'none' });
    expect(envelopeFor('deep')).toMatchObject({ thinking: 'high', consults: 'parallel' });
    expect(envelopeFor('standard', { standard: { seconds: 45, cents: 30 } })).toMatchObject({ ceilingSeconds: 45, ceilingCents: 30, targetSeconds: 20 });
    expect(nextLevel('quick')).toBe('standard');
    expect(nextLevel('deep')).toBeNull();
  });

  it('tells the agent rounds, depth and width are its call, with a sufficiency check', () => {
    const note = effortNote(envelopeFor('standard'), { level: 'standard', chosenBy: 'auto', reason: 'gather and synthesise' }, { canConsult: true });

    expect(note).toContain('EFFORT: Standard (read from the request: gather and synthesise)');
    expect(note).toContain('about 20 seconds');
    expect(note).toContain('do I have enough to answer well?');
    expect(note).toContain('at most one');
    expect(effortNote(envelopeFor('quick'), { level: 'quick', chosenBy: 'person' }, { canConsult: true })).toContain('Do not consult teammates');
  });
});

describe('the ceilings', () => {
  it('trips on wall clock or on spend, once', () => {
    const t0 = 1_000_000;
    const c = new EffortCeilings(envelopeFor('quick'), t0);

    expect(c.reached(t0 + 10_000)).toBeNull();
    expect(c.reached(t0 + 41_000)).toBe('time');

    const spend = new EffortCeilings(envelopeFor('quick'), t0);
    spend.spentSoFar(10 * 1_000_000);

    expect(spend.reached(t0)).toBeNull();

    spend.spentSoFar(16 * 1_000_000);

    expect(spend.reached(t0)).toBe('cost');
  });

  it('past a ceiling the model call goes out with tools off and a wrap-up line; at Quick the consult tool is left out', async () => {
    const seen: Array<{ tools: string[]; toolChoice?: unknown; system: string }> = [];
    const handler = async (req: { tools: Array<{ name: string }>; toolChoice?: unknown; systemMessage: { content: unknown } }) => {
      seen.push({ tools: req.tools.map(t => t.name), toolChoice: req.toolChoice, system: JSON.stringify(req.systemMessage.content) });
      return {} as never;
    };
    const { SystemMessage } = await import('@langchain/core/messages');
    const request = { tools: [{ name: 'search_knowledge' }, { name: CONSULT_TOOL }], systemMessage: new SystemMessage('You are the lead.') };

    const open = new EffortCeilings(envelopeFor('standard'));
    const wrap = createEffortMiddleware({ ceilings: open, consults: true }).wrapModelCall as unknown as (r: unknown, h: unknown) => Promise<unknown>;
    await wrap(request, handler);

    expect(seen[0]).toMatchObject({ tools: ['search_knowledge', CONSULT_TOOL] });
    expect(seen[0]!.toolChoice).toBeUndefined();

    const quick = createEffortMiddleware({ ceilings: new EffortCeilings(envelopeFor('quick')), consults: false }).wrapModelCall as unknown as (r: unknown, h: unknown) => Promise<unknown>;
    await quick(request, handler);

    expect(seen[1]!.tools).toEqual(['search_knowledge']);

    const spent = new EffortCeilings(envelopeFor('standard'));
    spent.spentSoFar(80 * 1_000_000);
    const atCeiling = createEffortMiddleware({ ceilings: spent, consults: true }).wrapModelCall as unknown as (r: unknown, h: unknown) => Promise<unknown>;
    await atCeiling(request, handler);

    expect(seen[2]!.toolChoice).toBe('none');
    expect(seen[2]!.system).toContain('WRAP UP NOW');
    expect(seen[2]!.system).toContain('spend ceiling');
  });
});
