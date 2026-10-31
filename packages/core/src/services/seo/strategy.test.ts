/**
 * A client's strategy draft, pure: the goal's title from what the client
 * wants first, 3–7 milestones each linked to the record that completes it,
 * and the document. Every client here is fictional.
 */
import type { StrategyInputs } from './strategy';
import { describe, expect, it } from 'vitest';
import { renderStrategyDoc, strategyMilestones, strategyTitle } from './strategy';

const BASE: StrategyInputs = {
  client: 'Tally Books',
  profile: { clientType: 'b2b_saas', goals: ['ai_answers', 'organic_leads'], offering: 'Invoicing for creative agencies. Time tracking too.' },
  horizonText: 'in Q1 2027',
  audit: { id: 11, title: 'Audit · Tally Books · 2026-10-29', highCount: 2, openCount: 9, checkedAt: '2026-10-29T10:00:00.000Z', reportArtifactId: 40, nextSteps: ['No Organization schema on the home page (high, ai visibility)'] },
  batches: [{ id: 21, title: 'Tally Books: comparisons', total: 4, published: 1 }, { id: 22, title: 'Tally Books: done', total: 2, published: 2 }],
  prompts: [{ id: 31, prompt: 'best invoicing tool for agencies', visibility: 'absent' }, { id: 32, prompt: 'Tally Books vs Ledgerly', visibility: 'mentioned' }, { id: 33, prompt: 'how do agencies get paid faster', visibility: 'unchecked' }],
  keywords: { total: 40, ideas: 25, ranking: 3 },
};

describe('the strategy goal', () => {
  it('is titled by what the client wants first', () => {
    expect(strategyTitle(BASE)).toBe('Tally Books named in AI answers for invoicing for creative agencies in Q1 2027');
    expect(strategyTitle({ ...BASE, client: 'Fernwood Plumbing', topic: 'emergency plumbing', profile: { clientType: 'local_services', goals: ['google_business_profile'], locations: ['Fairview, OH'] } })).toBe('Fernwood Plumbing in Google\'s local results for emergency plumbing in Fairview in Q1 2027');
    expect(strategyTitle({ ...BASE, profile: undefined, topic: 'agency invoicing' })).toBe('Tally Books winning leads from search for agency invoicing in Q1 2027');
  });

  it('links each milestone to the record that completes it, AI answers first when that is the first goal', () => {
    const ms = strategyMilestones(BASE);

    expect(ms).toEqual([
      { label: 'Resolve the audit\'s 9 open findings', link: { kind: 'record', id: '11', label: 'Audit · Tally Books · 2026-10-29' } },
      { label: 'Named in AI answers for "best invoicing tool for agencies"', link: { kind: 'record', id: '31', label: 'best invoicing tool for agencies' } },
      { label: 'Named in AI answers for "how do agencies get paid faster"', link: { kind: 'record', id: '33', label: 'how do agencies get paid faster' } },
      { label: 'Publish "Tally Books: comparisons" (1 of 4 live)', link: { kind: 'record', id: '21', label: 'Tally Books: comparisons' } },
    ]);
  });

  it('names the work still to start when there is no record yet, and keeps 3 to 7', () => {
    const bare = strategyMilestones({ ...BASE, audit: null, batches: [], prompts: [], keywords: { total: 0, ideas: 0, ranking: 0 } });

    expect(bare.map(m => m.label)).toEqual(['Audit the site and fix what it finds first', 'Track the questions buyers ask AI assistants', 'Plan and publish the first landing pages']);
    expect(bare.every(m => !m.link)).toBe(true);

    const many = strategyMilestones({ ...BASE, profile: { ...BASE.profile, goals: ['organic_leads', 'google_business_profile', 'ai_answers'] }, batches: Array.from({ length: 6 }, (_, i) => ({ id: 50 + i, title: `B${i}`, total: 3, published: 0 })) });

    expect(many.length).toBe(7);
    expect(many[1]!.label).toBe('Publish "B0" (0 of 3 live)');
  });

  it('writes the document: the goal, the client, what comes first, where things stand and the milestones', () => {
    const md = renderStrategyDoc(BASE, { title: 'Tally Books named in AI answers', milestones: strategyMilestones(BASE), projectId: 7, date: '2026-10-29' });

    expect(md).toContain('# SEO strategy · Tally Books');
    expect(md).toContain('**Tally Books named in AI answers**');
    expect(md).toContain('- Goals, most important first: Named in AI answers, Organic leads');
    expect(md).toContain('[report](/dashboard/artifacts/40)');
    expect(md).toContain('- **AI prompts**: 3 tracked, the client named on 1');
    expect(md).toContain('1. Resolve the audit\'s 9 open findings — [Audit · Tally Books · 2026-10-29](/dashboard/objects/11)');
  });
});
