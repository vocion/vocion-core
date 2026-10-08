/**
 * The judge chooses; code routes. A decision becomes a change only when the
 * finding allows it and its typed fields make sense — a role the catalog
 * offered, a cap that is a cap, a rule that is a sentence — and a judge that
 * cannot be read leaves the review to file the fallbacks code can state.
 */
import type { Finding } from './findings';
import { describe, expect, it } from 'vitest';
import { changeFromDecision, judgeFindings } from './judge';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'idle:scout',
    signal: 'idle',
    agentSlug: 'scout',
    strength: 140,
    summary: 'Kestrel Scout has not run since never',
    facts: ['last run: never'],
    evidence: [{ label: 'Last run', value: 'never', href: '/dashboard/team-report/scout' }],
    allowed: ['retire_agent'],
    fallback: { change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout — no runs in 41 days', reason: 'Unused.' },
    ...over,
  };
}

const hire = finding({
  id: 'measures:revenue-ops',
  signal: 'measures',
  agentSlug: undefined,
  teamSlug: 'revenue-ops',
  allowed: ['hire_agent'],
  catalog: [{ slug: 'seo-specialist', name: 'SEO Specialist', description: 'Finds search demand.' }],
  fallback: null,
});

const decision = (over: Record<string, unknown>) => ({ finding: 1, change: 'none', headline: 'h', reason: 'r', confidence: 0.7, ...over }) as never;

/**
 * A model bound to the one report tool, answering with these args.
 * @param args - What the tool call carries.
 * @param seen - Collects the bind options and the messages.
 */
function modelSaying(args: unknown, seen: unknown[] = []) {
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

describe('code routes on the judge\'s typed fields', () => {
  it('turns an allowed decision into the finding\'s own change', () => {
    expect(changeFromDecision(finding(), decision({ change: 'retire_agent' }))).toEqual({ change: { kind: 'retire_agent', agentSlug: 'scout' } });
    expect(changeFromDecision(hire, decision({ change: 'hire_agent', catalog_slug: 'seo-specialist', daily_cents: 1500 }))).toEqual({ change: { kind: 'hire_agent', catalogSlug: 'seo-specialist', dailyCents: 1500 } });
  });

  it('refuses a change the finding does not allow, a role nobody offered, a cap that is not one, a rule with no words', () => {
    expect(changeFromDecision(finding(), decision({ change: 'hire_agent', catalog_slug: 'seo-specialist' }))).toHaveProperty('invalid');
    expect(changeFromDecision(hire, decision({ change: 'hire_agent', catalog_slug: 'growth-hacker' }))).toHaveProperty('invalid');
    expect(changeFromDecision(finding({ allowed: ['set_budget'] }), decision({ change: 'set_budget', daily_cents: 5 }))).toHaveProperty('invalid');
    expect(changeFromDecision(finding({ allowed: ['adopt_rule'] }), decision({ change: 'adopt_rule', rule_text: 'ok' }))).toHaveProperty('invalid');
  });

  it('reads "none", and a cap set to what it already is, as keeping things as they are', () => {
    expect(changeFromDecision(finding(), decision({ change: 'none' }))).toEqual({ keep: true });
    expect(changeFromDecision(finding({ allowed: ['set_budget'], currentDailyCents: 5000 }), decision({ change: 'set_budget', daily_cents: 5000 }))).toEqual({ keep: true });
  });

  it('writes a standing rule against the finding\'s agent, never one the model names', () => {
    const routed = changeFromDecision(finding({ allowed: ['adopt_rule'] }), decision({ change: 'adopt_rule', rule_text: 'Keep a first-touch email under 120 words.' }));

    expect(routed).toEqual({ change: { kind: 'adopt_rule', agentSlug: 'scout', ruleText: 'Keep a first-touch email under 120 words.' } });
  });
});

describe('judgeFindings', () => {
  it('asks once, through the forced report tool, and files what it chose', async () => {
    const seen: unknown[] = [];
    const out = await judgeFindings(
      { orgId: 'org_judge', workspace: { name: 'Northwind', goal: null }, findings: [finding(), hire] },
      modelSaying({ decisions: [
        { finding: 1, change: 'retire_agent', headline: 'Retire Kestrel Scout', reason: 'It has never run.', confidence: 0.9 },
        { finding: 2, change: 'none', headline: 'Keep', reason: 'The measure only started this week.', confidence: 0.6 },
      ] }, seen),
    );

    expect(seen[0]).toEqual({ tools: ['report_org_review'], opts: { tool_choice: 'report_org_review' } });
    expect(out.judged).toBe('model');
    expect(out.proposals).toEqual([expect.objectContaining({ change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout', confidence: 0.9, by: 'model' })]);
    expect(out.kept).toEqual([{ finding: hire, reason: 'The measure only started this week.' }]);
    expect(JSON.stringify(seen[1])).toContain('roles: seo-specialist (SEO Specialist');
  });

  it('drops a decision about a finding it was not shown, and one that does not fit', async () => {
    const out = await judgeFindings(
      { orgId: 'org_judge', workspace: { name: 'Northwind', goal: null }, findings: [finding()] },
      modelSaying({ decisions: [
        { finding: 4, change: 'retire_agent', headline: 'x', reason: 'x', confidence: 1 },
        { finding: 1, change: 'hire_agent', catalog_slug: 'x', headline: 'x', reason: 'x', confidence: 1 },
      ] }),
    );

    expect(out.proposals).toEqual([]);
    expect(out.invalid.map(i => i.why)).toEqual(['finding 4 was not one of the 1 given', 'hire_agent is not a change this finding allows (retire_agent)']);
  });

  it('files the fallbacks — and only those — when the judge cannot be read', async () => {
    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('rate limited');
    } }) } as never;
    const out = await judgeFindings({ orgId: 'org_judge', workspace: { name: 'Northwind', goal: null }, findings: [finding(), hire] }, broken);

    expect(out.judged).toBe('fallback');
    expect(out.proposals).toEqual([expect.objectContaining({ change: { kind: 'retire_agent', agentSlug: 'scout' }, by: 'fallback', confidence: 0.6 })]);

    const shapeless = await judgeFindings({ orgId: 'org_judge', workspace: { name: 'Northwind', goal: null }, findings: [finding()] }, modelSaying({ verdict: 'retire' }));

    expect(shapeless.judged).toBe('fallback');
  });
});
