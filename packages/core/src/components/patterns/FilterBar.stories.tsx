import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { Chip } from './ChipRow';
import { useState } from 'react';
import { ChipRow } from './ChipRow';
import { FilterBar } from './FilterBar';

/**
 * One field for filtering and searching, with the full grid behind the funnel.
 *
 * The shape here is the review queue's: three independent dimensions (kind,
 * type, agent) that used to be three chip rows, one of which overflowed into
 * "+3 more". Fixture data only.
 */
const meta: Meta<typeof FilterBar> = {
  title: 'Patterns/FilterBar',
  component: FilterBar,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof FilterBar>;

const OPTIONS = [
  { value: 'kind:proposal', label: 'Proposals', count: 136, group: 'Kind' },
  { value: 'kind:ruling', label: 'Suggested rules', count: 2, group: 'Kind' },
  { value: 'type:hubspot.update', label: 'HubSpot update', count: 104, group: 'Type' },
  { value: 'type:personalization.enroll', label: 'Personalization enroll', count: 76, group: 'Type' },
  { value: 'type:discovery.review_proposal', label: 'Discovery review proposal', count: 25, group: 'Type' },
  { value: 'type:gmail.send', label: 'Gmail send', count: 6, group: 'Type' },
  { value: 'type:objects.propose_candidate', label: 'Objects propose candidate', count: 4, group: 'Type' },
  { value: 'agent:revenue-lead', label: 'revenue-lead', count: 131, group: 'Agent' },
  { value: 'agent:deal-desk', label: 'deal-desk', count: 5, group: 'Agent' },
  { value: 'agent:proposal-writer', label: 'proposal-writer', count: 2, group: 'Agent' },
];

function Harness({ initial = [] as string[], q = '' }) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState(q);
  const chips: Chip[] = OPTIONS.map(o => ({
    key: o.value,
    label: o.label,
    count: o.count,
    active: selected.includes(o.value),
    onToggle: () => setSelected(s => (s.includes(o.value) ? s.filter(v => v !== o.value) : [...s, o.value])),
  }));

  return (
    <FilterBar
      label="Filter the review queue"
      placeholder="Filter or search…"
      query={query}
      onQueryChange={setQuery}
      options={OPTIONS}
      selected={selected}
      onSelectedChange={setSelected}
      searching="deals, contacts and agents"
      advancedCount={selected.length}
      advanced={<ChipRow chips={chips} size="sm" label="All filters" />}
    />
  );
}

/** At rest: one field, one funnel. Four controls became two. */
export const Default: Story = { render: () => <Harness /> };

/** What a filtered queue looks like — the choices ride in the field. */
export const Filtered: Story = {
  render: () => <Harness initial={['type:hubspot.update', 'agent:revenue-lead']} />,
};

/** Typing narrows every dimension at once, and searches the list at the same time. */
export const Typing: Story = { render: () => <Harness q="hub" /> };
