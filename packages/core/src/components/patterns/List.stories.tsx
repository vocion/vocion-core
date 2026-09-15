import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Sparkles } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { StatusPill } from '@/components/ui/status-pill';
import { Column, ListEmpty, ListPage, ListRow, ListRows, ListToolbar, Subline } from './index';

/**
 * The List archetype: title, one toolbar row (lanes with counts · find ·
 * sort · direction), hairline rows with right-aligned columns and a state
 * chip. No boxes; the rows are the list. `docs/design/patterns.md` § List.
 */
const meta: Meta = {
  title: 'Patterns/List',
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj;

const ROWS = [
  { id: 1, name: 'Jamie Smith', title: 'Managing Partner', company: 'Redpoint IT', arrived: 'Aug 24', source: 'Ebook', level: 'confident', score: 0.88, lane: 'Review', status: 'pending' as const },
  { id: 2, name: 'Rosa Lindqvist', title: 'VP Operations', company: 'Meridian Group', arrived: 'Aug 26', source: 'Paid social', level: 'uncertain', score: 0.64, lane: 'Review', status: 'pending' as const },
  { id: 3, name: 'Pete Laverick', title: 'CEO', company: 'Incline Gaming Marketing', arrived: 'Sep 1', source: 'Paid social', level: 'speculative', score: 0.42, lane: 'Review', status: 'pending' as const },
  { id: 4, name: 'Marta Kovac', title: 'Head of RevOps', company: 'Orlin Health', arrived: 'Aug 19', source: 'Organic search', level: 'confident', score: 0.84, lane: 'Sent', status: 'completed' as const },
];

function Demo(props: { rows?: typeof ROWS; toolbar?: boolean }) {
  const [tab, setTab] = useState('review');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('arrived');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const rows = (props.rows ?? ROWS).filter(r => (tab === 'all' || r.lane.toLowerCase() === tab) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <ListPage title="Personalization" description="Researched leads waiting on your decision. Each row opens the lead's page. Nothing here has been sent.">
      {props.toolbar !== false && (
        <ListToolbar
          tabs={{ items: [{ key: 'review', label: 'Review', count: 3 }, { key: 'hand off', label: 'Hand off', count: 0 }, { key: 'held', label: 'Held', count: 0 }, { key: 'sent', label: 'Sent', count: 1 }, { key: 'all', label: 'All', count: 4 }], value: tab, onChange: setTab }}
          search={{ value: q, onChange: setQ, placeholder: 'Find a lead or company' }}
          sort={{ value: sort, onChange: setSort, options: [{ key: 'arrived', label: 'Arrived' }, { key: 'confidence', label: 'Confidence' }, { key: 'name', label: 'Name' }] }}
          direction={{ value: dir, onChange: setDir }}
        />
      )}
      {rows.length === 0
        ? <ListEmpty variant="inline" title={q ? 'No lead matches that search.' : 'Nothing in this lane.'} />
        : (
            <ListRows className="mt-1">
              {rows.map(r => (
                <ListRow
                  key={r.id}
                  href={`/gtm/lead/${r.id}`}
                  chevron={false}
                  title={r.name}
                  subline={<Subline separator="·" segments={[r.title, r.company, `arrived ${r.arrived}`, r.source]} />}
                  columns={<Column kind="score">{`${r.level} ${r.score.toFixed(2)}`}</Column>}
                  chip={<StatusPill status={r.status} label={r.lane} size="sm" />}
                />
              ))}
            </ListRows>
          )}
    </ListPage>
  );
}

/** The reference: the personalization queue's shape. */
export const Page: Story = { render: () => <Demo /> };

/** Rows on their own: numbers right-aligned in a fixed column, chip last. */
export const Rows: Story = { render: () => <Demo toolbar={false} /> };

/** Chips instead of lanes — for a list that filters by category. */
export const WithChips: Story = {
  render: () => {
    const [active, setActive] = useState<string[]>([]);
    return (
      <ListToolbar
        search={{ value: '', onChange: () => {}, placeholder: 'Find a meeting' }}
        sort={{ value: 'date', onChange: () => {}, options: [{ key: 'date', label: 'Date' }, { key: 'score', label: 'Score' }] }}
        direction={{ value: 'desc', onChange: () => {} }}
        chips={{ items: [{ key: 'generate', label: 'generate', count: 3 }, { key: 'confirm', label: 'confirm', count: 5 }, { key: 'drop', label: 'drop', count: 12 }], active, onChange: setActive }}
      />
    );
  },
};

/** Hover a row: the actions appear at its right; the row is one 44px target. */
export const HoverActions: Story = {
  render: () => (
    <ListRows>
      {ROWS.slice(0, 2).map(r => (
        <ListRow
          key={r.id}
          onClick={() => {}}
          title={r.name}
          subline={<Subline segments={['Workspace', 'Revenue', r.company]} />}
          columns={(
            <>
              <Column kind="date">{r.arrived}</Column>
              <Column kind="score">{`${r.level} ${r.score.toFixed(2)}`}</Column>
            </>
          )}
          chip={<StatusPill status={r.status} label={r.lane} size="sm" />}
          actions={<button type="button" className="h-8 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-surface-hover hover:text-foreground">Snooze</button>}
        />
      ))}
    </ListRows>
  ),
};

/** The whole list empty: an icon in a soft circle, one line, one action. */
export const Empty: Story = {
  render: () => (
    <ListPage title="Personalization" description="Researched leads waiting on your decision.">
      <ListEmpty
        icon={Sparkles}
        title="No briefs yet"
        description="The hourly sweep queues each new MQL, researches it, and posts the brief here."
        action={{ label: 'Open the review queue', href: '/dashboard/review' }}
      />
    </ListPage>
  ),
};
