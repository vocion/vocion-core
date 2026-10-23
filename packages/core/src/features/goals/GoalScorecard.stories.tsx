import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { GoalScorecard as Scorecard } from './types';
import { useState } from 'react';
import { Section } from '@/components/patterns';
import { GoalScorecard } from './GoalScorecard';

/**
 * A sprint's scorecard on the goal page: weekly targets down the side, the
 * latest weeks across, met in the pass tone, missed in amber, a dash where
 * nobody logged it. Click a cell to write your own number; it holds.
 * Fixtures are fictional (Northwind).
 */
const meta: Meta<typeof GoalScorecard> = {
  title: 'Goals/Scorecard',
  component: GoalScorecard,
  parameters: { layout: 'padded' },
};
export default meta;

const columns = [
  { week: '2026-10-26', label: 'Oct 26', current: false, note: 'Two partners out at a conference.' },
  { week: '2026-11-02', label: 'Nov 2', current: false },
  { week: '2026-11-09', label: 'Nov 9', current: false },
  { week: '2026-11-16', label: 'Nov 16', current: true },
];

const cell = (value: number | null, perWeek: number, by: 'agent' | 'person' = 'agent') => (value === null ? { value: null, met: null, by: null } : { value, met: value >= perWeek, by, ...(by === 'agent' ? { evidence: 'the calendar' } : {}) });

const SPRINT: Scorecard = {
  week: 4,
  weeks: 13,
  columns,
  rows: [
    { key: 't1', label: 'Daily touch', perWeek: 5, unit: 'touches', cells: [cell(5, 5), cell(4, 5), cell(5, 5, 'person'), cell(2, 5)] },
    { key: 't2', label: 'Discovery calls', perWeek: 3, cells: [cell(3, 3), cell(1, 3), cell(4, 3), cell(null, 3)] },
    { key: 't3', label: 'Proposals sent', perWeek: 1, cells: [cell(0, 1), cell(1, 1), cell(1, 1), cell(null, 1)] },
    { key: 't4', label: 'Referral partner meetings with Northwind and Larkfield', perWeek: 2, cells: [cell(2, 2), cell(2, 2), cell(1, 2), cell(null, 2)] },
  ],
};

function Live(props: { scorecard: Scorecard }) {
  const [card, setCard] = useState(props.scorecard);
  return (
    <div className="mx-auto max-w-3xl">
      <Section eyebrow="Scorecard">
        <GoalScorecard
          scorecard={card}
          editable
          pending={false}
          onSet={(week, key, value) => setCard(c => ({
            ...c,
            rows: c.rows.map(r => (r.key !== key ? r : { ...r, cells: r.cells.map((x, i) => (c.columns[i]!.week !== week ? x : cell(value, r.perWeek, 'person'))) })),
          }))}
        />
      </Section>
    </div>
  );
}

export const FourWeeksIn: StoryObj = { render: () => <Live scorecard={SPRINT} /> };

export const Phone: StoryObj = { render: () => <Live scorecard={SPRINT} />, globals: { viewport: { value: 'mobile1' } } };
