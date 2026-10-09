import type { AgentOption } from './types';
import { describe, expect, it } from 'vitest';
import { speakerOf, speakersOf } from './speakers';

const AGENTS: AgentOption[] = [
  { slug: 'revenue-lead', name: 'Revenue lead', icon: 'bot', placeholder: '', role: 'lead' },
  { slug: 'dana', name: 'Dana', icon: 'bot', placeholder: '', role: 'specialist', accent: 'violet', eyebrow: 'Pricing' },
  { slug: 'kit', name: 'Kit', icon: 'bot', placeholder: '', role: 'specialist', accent: 'teal' },
];
const own = { slug: 'revenue-lead', name: 'Revenue' };

describe('who is speaking, turn by turn (founder, 2026-10-09)', () => {
  it('opens a turn with the teammate it changed to, once; the same speaker carries on quietly', () => {
    const turns = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'assistant', agentSlug: 'dana', agentName: 'Dana' },
      { role: 'user' },
      { role: 'assistant', agentSlug: 'dana', agentName: 'Dana' },
      { role: 'user' },
      { role: 'assistant', agentSlug: 'kit', agentName: 'Kit' },
      { role: 'assistant' },
      { role: 'assistant', agentSlug: 'dana', agentName: 'Dana' },
    ];
    const openers = speakersOf(turns, own, AGENTS).map(s => s.opener?.name ?? null);

    expect(openers).toEqual([null, null, null, 'Dana', null, null, null, 'Kit', null, 'Dana']);
  });

  it('names the writer of every turn, the lead included', () => {
    const [, lead, , dana] = speakersOf([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant', agentSlug: 'dana', agentName: 'Dana' }], own, AGENTS);

    expect(lead!.speaker).toMatchObject({ slug: 'revenue-lead', name: 'Revenue lead' });
    expect(dana!.speaker).toEqual({ slug: 'dana', name: 'Dana', accent: 'violet', eyebrow: 'Pricing' });
  });

  it('finds an agent by slug, then by name, and draws an unknown one by its name alone', () => {
    expect(speakerOf(AGENTS, { name: 'Kit' })).toMatchObject({ slug: 'kit', accent: 'teal' });
    expect(speakerOf(AGENTS, { slug: 'nope', name: 'Dana' })).toMatchObject({ slug: 'dana' });
    expect(speakerOf(AGENTS, { name: 'Morgan' })).toEqual({ name: 'Morgan', accent: null });
  });
});
