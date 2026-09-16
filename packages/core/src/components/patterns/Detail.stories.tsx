import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Check, X } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import {
  Accordion,
  ConfidenceMeter,
  DetailMeta,
  DetailPage,
  EvidenceList,
  FactList,
  MetaChip,
  RightColumn,
  Section,
  StatusDot,
  StickyActionBar,
} from './index';

/**
 * The Detail archetype: breadcrumb › H1 › ONE meta row, hairline sections,
 * an evidence column that drops under the content on a phone, and the
 * decision in a sticky bar. No outer card. `docs/design/patterns.md` § Detail.
 */
const meta: Meta = {
  title: 'Patterns/Detail',
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

const CLAIMS = [
  { text: 'Runs an iGaming affiliate marketing agency.', kind: 'Fact', source: 'https://incline.bet/about', date: '2026-08-30' },
  { text: 'Compliance tracking is the likely pain point.', kind: 'Inference', source: 'https://incline.bet/compliance' },
  { text: 'Opened both follow-ups within a day.', kind: 'engagement', source: 'hubspot:contacts/88201', date: '2026-08-25' },
];

function Page(props: { withBar?: boolean }) {
  const [open, setOpen] = useState(['send-1']);
  const [note, setNote] = useState('');
  return (
    <DetailPage
      crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Personalization', href: '/gtm/personalization' }, { label: 'Pete Laverick' }]}
      title="Pete Laverick"
      subtitle="CEO · Incline Gaming Marketing Inc"
      meta={(
        <DetailMeta
          items={[
            <MetaChip key="sys">Personalization</MetaChip>,
            <StatusDot key="st" tone="amber" label="Ready for review" />,
            'proposed by revenue-lead',
            <ConfidenceMeter key="c" value={0.6} label="uncertain" format="score" rationale="The angle rests on one public page and the entrance path; nothing names the compliance workload directly." />,
            'Paid social',
            'MQL Sep 1',
            <MetaChip key="crm" href="https://app.hubspot.com">Open in HubSpot ↗</MetaChip>,
          ]}
        />
      )}
      aside={(
        <RightColumn>
          <Section tone="quiet" eyebrow="Confidence"><p>0.60 · uncertain</p></Section>
          <Section tone="quiet" eyebrow="Timeline">
            <FactList layout="column" facts={[{ label: 'Arrived', value: 'Aug 29, 2026' }, { label: 'Became MQL', value: 'Sep 1, 2026' }, { label: 'Briefed', value: 'Sep 1, 2026' }]} />
          </Section>
          <Section tone="quiet" eyebrow="CRM context">
            <FactList layout="column" facts={[{ label: 'Source', value: 'Paid social' }, { label: 'Campaign', value: 'LinkedIn' }, { label: 'Engagement', value: '2 sent · 1 opened' }]} />
          </Section>
        </RightColumn>
      )}
      bar={props.withBar && (
        <StickyActionBar
          primary={{ label: 'Enroll', onClick: () => {}, icon: Check }}
          secondary={[{ label: 'Snooze', onClick: () => {} }, { label: 'Decline', onClick: () => {}, icon: X, tone: 'danger' }]}
          field={{ label: 'Feedback', placeholder: 'What should change?', value: note, onChange: setNote, action: { label: 'Regenerate', onClick: () => {}, disabled: !note.trim() } }}
        />
      )}
    >
      <Section eyebrow="Recommended action" action={<a href="#research" className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-surface-hover hover:text-foreground">View research</a>}>
        <p className="text-[15px] leading-snug font-semibold">Enroll in: LinkedIn Ebook Inbound Sequence · 2 sends</p>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-foreground/80">The ebook was the entrance path and the compliance section is the one most agencies act on first. Two sends, four days apart.</p>
      </Section>
      <Section eyebrow="Prospect facts">
        <FactList facts={[{ label: 'Role', value: 'CEO' }, { label: 'Company', value: 'Incline Gaming Marketing Inc' }, { label: 'Entrance', value: 'Paid social · LinkedIn' }]} />
      </Section>
      <Section eyebrow="Research that matters" id="research">
        <EvidenceList items={CLAIMS} />
      </Section>
      <Section
        eyebrow="Outreach · 2 sends"
        action={<button type="button" onClick={() => setOpen(open.length === 2 ? [] : ['send-1', 'send-2'])} className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-surface-hover hover:text-foreground">{open.length === 2 ? 'Collapse all' : 'Edit all'}</button>}
      >
        <Accordion
          open={open}
          onToggle={(id, on) => setOpen(o => (on ? [...o, id] : o.filter(x => x !== id)))}
          items={[
            { id: 'send-1', label: 'Day 0', title: 'The ebook you pulled', children: <p className="text-sm leading-relaxed text-foreground/80">Pete, following up on the LinkedIn ebook — the state-by-state compliance section is the one most agencies act on first.</p> },
            { id: 'send-2', label: 'Day 4', title: 'One level deeper', meta: 'edited', children: <p className="text-sm leading-relaxed text-foreground/80">The compliance tracker walkthrough, if useful.</p> },
          ]}
        />
      </Section>
    </DetailPage>
  );
}

/** The whole archetype, with the decision bar. */
export const WithDecision: Story = { render: () => <Page withBar /> };

/** The record state: same page, no bar. */
export const Record: Story = { render: () => <Page /> };

/** The meta row's parts on their own. */
export const MetaRow: Story = {
  render: () => (
    <DetailMeta
      items={[
        <MetaChip key="sys">Gmail</MetaChip>,
        <StatusDot key="st" tone="pass" label="Approved" />,
        'proposed by revenue-lead',
        <ConfidenceMeter key="c" value={0.91} rationale="Three sources agree on the pain point; the ask matches the sequence's first send." alignment={{ value: 0.87 }} />,
        '3 of 213',
      ]}
    />
  ),
};

/** Evidence rows: the claim, then Fact | Inference and the citation. */
export const Evidence: Story = { render: () => <Section eyebrow="Research that matters"><EvidenceList items={CLAIMS} /></Section> };

/** Facts as rows (content column) and as a column (right column). */
export const Facts: Story = {
  render: () => (
    <div className="grid gap-10 sm:grid-cols-2">
      <Section eyebrow="Rows"><FactList facts={[{ label: 'Role', value: 'CEO' }, { label: 'Company', value: 'Incline Gaming Marketing Inc' }, { label: 'Record', value: 'contacts/88201', href: 'https://app.hubspot.com' }]} /></Section>
      <Section eyebrow="Column" tone="quiet"><FactList layout="column" facts={[{ label: 'Arrived', value: 'Aug 29, 2026' }, { label: 'Became MQL', value: 'Sep 1, 2026' }]} /></Section>
    </div>
  ),
};
