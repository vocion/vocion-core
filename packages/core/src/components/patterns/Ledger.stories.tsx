import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { LedgerEntry, LedgerGroup, ProvenanceLine, ScoreChip, VerdictBadge } from './index';

/**
 * The Ledger archetype: day groups of hairline entries — title · when, the
 * verdict and routing state at the right, score chips against their
 * thresholds, a two-line summary, a mono provenance footer, and what a
 * person did. `docs/design/patterns.md` § Ledger.
 */
const meta: Meta = {
  title: 'Patterns/Ledger',
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj;

const REASONING = 'The buyer names a budget, a decision maker and a timeline, and describes the current proposal process as entirely manual across forty stores. The call ends with an explicit ask for a phased plan. Both dimensions clear their thresholds with room.';

const provenance = (
  <ProvenanceLine
    items={[
      { value: 'claude-haiku-4-5-20251001#discovery-v1', title: 'Model + prompt version' },
      { value: 'revops-lead', title: 'mission_run #4412' },
      { label: 'run', value: '#4412' },
      { label: 'transcript', value: '9f3c2a1b7e0d' },
      { label: 'ws', value: 'a81f0c3e22b9' },
    ]}
  />
);

/** A day of assessed calls: generated, confirmed, dropped, skipped. */
export const Group: Story = {
  render: () => (
    <>
      <LedgerGroup label="Mon, Sep 14" count={3}>
        <LedgerEntry
          title="Acme <> Metacto intro"
          when="Sep 14, 10:00 AM"
          detail="Matched hubspot-deal · deals:1201"
          state={<span>routed</span>}
          verdict={<VerdictBadge verdict="generate" />}
          scores={(
            <>
              <ScoreChip label="discovery" value={0.95} threshold={0.8} />
              <ScoreChip label="proposal-ready" value={0.88} threshold={0.75} />
            </>
          )}
          summary={REASONING}
          provenance={provenance}
          human={<a href="/dashboard/inbox?kind=proposal" className="underline decoration-border underline-offset-2 hover:text-foreground">review: pending →</a>}
        />
        <LedgerEntry
          title="Northwind — quarterly check-in"
          when="Sep 14, 2:30 PM"
          detail="Matched hubspot-contact · contacts:9412"
          state={<span>routed</span>}
          verdict={<VerdictBadge verdict="confirm" />}
          scores={(
            <>
              <ScoreChip label="discovery" value={0.82} threshold={0.8} />
              <ScoreChip label="proposal-ready" value={0.61} threshold={0.75} />
            </>
          )}
          summary="A discovery conversation, but the buyer defers budget to next quarter and no decision maker is on the call."
          provenance={provenance}
          human={<a href="/dashboard/inbox?kind=proposal" className="underline decoration-border underline-offset-2 hover:text-foreground">review: approved →</a>}
        />
        <LedgerEntry
          title="Weekly pipeline sync"
          when="Sep 14, 4:00 PM"
          detail="Matched calendly-external · example.com"
          state={<span>dropped</span>}
          verdict={<VerdictBadge verdict="drop" />}
          scores={(
            <>
              <ScoreChip label="discovery" value={0.12} threshold={0.8} />
              <ScoreChip label="proposal-ready" value={0.05} threshold={0.75} />
            </>
          )}
          summary="An internal status meeting; no buyer, no scope, no ask."
          provenance={provenance}
        />
      </LedgerGroup>
      <LedgerGroup label="Sun, Sep 13" count={1}>
        <LedgerEntry
          title="zoom:8f1e-…"
          when="Sep 13, 9:00 AM"
          detail="Matched hubspot-company · companies:77"
          state={<span>matched</span>}
          verdict={<VerdictBadge verdict="skipped" />}
          human={<span className="text-brand-borderline">skipped: no-transcript</span>}
        />
      </LedgerGroup>
    </>
  ),
};

/** Score chips: pass, fail, and a plain reading with no threshold. */
export const Scores: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      <ScoreChip label="discovery" value={0.95} threshold={0.8} />
      <ScoreChip label="proposal-ready" value={0.61} threshold={0.75} />
      <ScoreChip label="alignment" value={0.42} />
    </div>
  ),
};

/** The verdicts and their three colours: ink, green, amber. */
export const Verdicts: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <VerdictBadge verdict="drop" />
      <VerdictBadge verdict="generate" />
      <VerdictBadge verdict="confirm" />
      <VerdictBadge verdict="hold" />
      <VerdictBadge verdict="skipped" />
      <VerdictBadge verdict="pending" />
    </div>
  ),
};

/** The mono footer. */
export const Provenance: Story = { render: () => provenance };
