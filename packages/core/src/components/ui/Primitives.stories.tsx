import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Blocks, Plus, Users, Wand2 } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { AGENT_ACCENT_NAMES } from '@/libs/agentAccents';
import { TINTS } from '@/libs/tints';
import { AgentDot, AgentDots } from './agent-dot';
import { EmptyState } from './empty-state';
import { LetterTile } from './letter-tile';
import { StatusBadge } from './status-badge';

/**
 * The front-door primitives: `AgentDot` (the one shape an agent takes),
 * `LetterTile` (the one mark for a thing with no logo), `StatusBadge`
 * (whether a catalog item can be had yet) and `EmptyState` (an empty page is
 * a front door: one sentence, one action). Fictional fixtures.
 */
const meta: Meta = {
  title: 'UI/Front-door primitives',
  parameters: { layout: 'padded' },
  // EmptyState's action is the locale-aware Link, which reads the intl context.
  decorators: [Story => <NextIntlClientProvider locale="en"><Story /></NextIntlClientProvider>],
};

export default meta;

type Story = StoryObj;

/** Every authored accent, as a dot. A white initial clears AA on each (`agentAccents.test.ts`). */
export const AgentDotAccents: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        {AGENT_ACCENT_NAMES.map(accent => (
          <span key={accent} className="inline-flex items-center gap-1.5 text-[13px]">
            <AgentDot name={accent} accent={accent} decorative />
            {accent}
          </span>
        ))}
      </div>
      <div className="flex items-end gap-3">
        <AgentDot name="Revenue Lead" accent="blue" size="xs" />
        <AgentDot name="Revenue Lead" accent="blue" size="sm" />
        <AgentDot name="Revenue Lead" accent="blue" size="md" />
        <AgentDot name="Revenue Lead" accent="blue" size="lg" />
      </div>
      <AgentDots agents={[{ name: 'Revenue Lead', accent: 'blue' }, { name: 'Proposal Writer', accent: 'orange' }, { name: 'Controller', accent: 'teal' }, { name: 'Analyst', accent: 'violet' }, { name: 'Researcher', accent: 'rose' }]} />
    </div>
  ),
};

export const LetterTiles: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <LetterTile name="Northwind" />
      <LetterTile name="Kestrel Capital" />
      <LetterTile name="Contoso" size="lg" />
      <LetterTile name="Acme Cloud" size="sm" />
      <LetterTile name="Workforce" icon={Users} tint="sky" />
      {TINTS.map(tint => <LetterTile key={tint} name={tint} tint={tint} />)}
      <LetterTile name="Add app" icon={Plus} muted />
      <LetterTile name="Coming" muted />
    </div>
  ),
};

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status="available" />
      <StatusBadge status="beta" />
      <StatusBadge status="coming" />
      <StatusBadge status="available" label="Today" />
      <StatusBadge status="coming" label="On the roadmap" />
    </div>
  ),
};

/** The empty state: a mark, a title, one sentence, one arrow. */
export const Empty: Story = {
  render: () => (
    <EmptyState
      icon={Blocks}
      title="No eval datasets yet"
      description="Author one under evals/ in the workspace and apply it to start scoring an agent."
      action={{ label: 'Read how evals work', href: '#' }}
    />
  ),
};

/** On an app's tint, when the empty page belongs to that app. */
export const EmptyOnTint: Story = {
  render: () => (
    <EmptyState
      icon={Wand2}
      tint="violet"
      title="Your whole catalog is working"
      description="Ask the Automation Engineer to build the next agent from work you still do by hand."
      action={{ label: 'Build a new agent', href: '#' }}
    />
  ),
};
