import { AIMessageChunk } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { catalogContext, measureCatalog } from '@/services/agents/toolMeasure';
import { buildDomainTools } from '@/services/agents/tools/registry';
import { EVAL_AGENTS, EVAL_CASES } from './dataset';
import { loadForMode, runCase } from './run';
import { gradeCase } from './score';
import { stubAnswer } from './stubs';

const agent = (slug: string) => EVAL_AGENTS.find(a => a.slug === slug)!;

describe('the agent-behaviour dataset', () => {
  it('names only tools its agents have, in its cases and in their history', () => {
    for (const a of EVAL_AGENTS) {
      const names = new Set(buildDomainTools(catalogContext(a)).map(t => t.name));

      expect(a.history.filter(n => !names.has(n))).toEqual([]);

      for (const c of EVAL_CASES.filter(x => x.agent === a.slug)) {
        expect(c.expectTools.length === 0 || c.expectTools.some(n => names.has(n)), c.id).toBe(true);
      }
    }
  });

  it('is wide enough to read a difference: 40 to 50 cases, unique ids, every kind on more than one agent', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(40);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(50);
    expect(new Set(EVAL_CASES.map(c => c.id)).size).toBe(EVAL_CASES.length);

    for (const kind of ['write', 'long-tail', 'refusal-probe', 'connector', 'grounding', 'save', 'args'] as const) {
      expect(new Set(EVAL_CASES.filter(c => c.kind === kind).map(c => c.agent)).size, kind).toBeGreaterThanOrEqual(kind === 'connector' ? 1 : 2);
    }
  });

  it('backs every grounding case with a record that says the right thing, against the guess in the message', () => {
    const grounding = EVAL_CASES.filter(c => c.grounding);

    expect(grounding.length).toBeGreaterThanOrEqual(5);

    for (const c of grounding) {
      const record = stubAnswer(c.expectTools[0]!, { query: c.message });

      expect(c.grounding!.mustSay.every(re => re.test(record)), c.id).toBe(true);
    }
  });

  it('checks the arguments the message names: a right call passes, a wrong one does not', () => {
    const args = (id: string) => EVAL_CASES.find(c => c.id === id)!.args!;

    expect(args('pa-args-company-id').ok({ tool: 'hubspot_company_deals', input: { company_id: 'C-201' } })).toBe(true);
    expect(args('pa-args-company-id').ok({ tool: 'hubspot_company_deals', input: { company_id: 'Meridian Dental' } })).toBe(false);
    expect(args('pa-write-deal').ok({ tool: 'recommend_action', input: { action_input: { properties: { amount: '84,000', closedate: '2026-12-15' } } } })).toBe(true);
    expect(args('rl-connector-calendar').ok({ tool: 'calendar_events', input: { day: '2026-11-04' } })).toBe(false);
    expect(args('rl-longtail-chart').ok({ tool: 'render_chart', input: { x: '["Oct 5","Oct 12","Oct 19","Oct 26"]' } })).toBe(true);
  });

  it('answers a company\'s deals only for an id the search returned, as HubSpot would', () => {
    expect(JSON.parse(stubAnswer('hubspot_company_deals', { company_id: 'C-201' })).deals.map((d: { company: string }) => d.company)).toEqual(['Meridian Dental', 'Meridian Dental']);
    expect(() => stubAnswer('hubspot_company_deals', { company_id: 'Meridian Dental' })).toThrow(/Search for the company first/);
  });

  it('gives every case an agent, and every agent a case', () => {
    expect(EVAL_CASES.filter(c => !EVAL_AGENTS.some(a => a.slug === c.agent))).toEqual([]);
    expect(EVAL_AGENTS.filter(a => !EVAL_CASES.some(c => c.agent === a.slug))).toEqual([]);
  });

  it('reproduces the incident\'s shape: history defers the analyst\'s write path, and core loads it', () => {
    const analyst = agent('pipeline-analyst');
    const tools = buildDomainTools(catalogContext(analyst));

    expect(loadForMode(analyst, 'history', tools).plan.keep!.has('recommend_action')).toBe(false);
    expect(loadForMode(analyst, 'core', tools).plan.keep!.has('recommend_action')).toBe(true);
    expect(loadForMode(analyst, 'all', tools).plan.keep).toBeNull();
  });

  it('runs the Revenue Lead over the cap by deferring whole connector families, never its grants', () => {
    const lead = agent('revenue-lead');
    const { modes } = measureCatalog(lead);
    const plan = loadForMode(lead, 'core', buildDomainTools(catalogContext(lead))).plan;

    expect(modes.core.overBudget).toBe(false);
    expect(lead.grantTools.filter(g => !plan.keep!.has(g))).toEqual([]);
    expect(plan.searchable.map(s => s.family)).toContain('HubSpot');
  });
});

describe('running a case', () => {
  /**
   * A model that answers from a script, one message per call, streamed as one chunk.
   * @param script - The messages, in order.
   */
  function scripted(script: AIMessageChunk[]) {
    let i = 0;
    return {
      bindTools: () => ({
        stream: async () => (async function* () {
          yield script[Math.min(i++, script.length - 1)]!;
        })(),
      }),
    };
  }

  it('calls the stubbed tool, records the call and grades it', async () => {
    const write = EVAL_CASES.find(c => c.id === 'pa-write-deal')!;
    const run = await runCase({
      agent: agent('pipeline-analyst'),
      evalCase: write,
      mode: 'core',
      level: 'standard',
      model: scripted([
        new AIMessageChunk({ content: '', tool_call_chunks: [], tool_calls: [{ id: 't1', name: 'recommend_action', args: { action_id: 'hubspot.update', action_input: { objectType: 'deals', objectId: 'D-1001', properties: { amount: 84000, closedate: '2026-12-15' } }, label: 'Update the Northwind deal' } }] }),
        new AIMessageChunk({ content: 'Done: the Northwind deal is $84,000, closing 2026-12-15.' }),
      ]),
    });

    expect(run.crashed).toBeUndefined();
    expect(run.calls).toEqual([expect.objectContaining({ tool: 'recommend_action', error: false })]);
    expect(gradeCase(write, run)).toEqual({ aware: true, falseRefusal: false, argsOk: true, grounded: null, madeUpSave: false });
  });

  it('counts a malformed call and a call to a tool the agent does not have as errors', async () => {
    const run = await runCase({
      agent: agent('pipeline-analyst'),
      evalCase: EVAL_CASES.find(c => c.id === 'pa-longtail-chart')!,
      mode: 'history',
      level: 'quick',
      model: scripted([
        new AIMessageChunk({ content: '', tool_calls: [{ id: 't1', name: 'render_chart', args: { nonsense: true } }, { id: 't2', name: 'update_deal', args: {} }] }),
        new AIMessageChunk({ content: 'I can\'t draw charts.' }),
      ]),
    });

    expect(run).toMatchObject({ toolErrors: 2, unknownTools: 1 });
  });
});
