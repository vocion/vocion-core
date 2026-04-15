import type { Metadata } from 'next';
import { Briefcase, HeartHandshake, LineChart, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Use cases — Vocion',
  description: 'How teams compose the five primitives into production AI: sales ops, customer success, support, product intelligence.',
};

type Shape = {
  icon: typeof Briefcase;
  title: string;
  summary: string;
  stack: { sources: string[]; objects: string[]; skills: number; workflows: number; agent: string };
  status: string;
};

const cases: Shape[] = [
  {
    icon: Briefcase,
    title: 'Sales operations',
    summary: 'Post-call summaries, follow-up drafts, proposal generation, pipeline review. One agent, many skills, HITL where it matters.',
    stack: {
      sources: ['Zoom', 'Gmail', 'HubSpot', 'Google Drive'],
      objects: ['Account', 'Deal', 'Discovery Call'],
      skills: 13,
      workflows: 2,
      agent: 'Ziggy (one)',
    },
    status: 'Live · MetaCTO internal',
  },
  {
    icon: HeartHandshake,
    title: 'Customer success',
    summary: 'Per-account exec assistant: meeting prep, daily triage across Slack/Teams/email, weekly health summary. One agent per customer.',
    stack: {
      sources: ['Slack', 'Gmail', 'Zoom', 'Jira'],
      objects: ['Account', 'Ticket', 'Meeting', 'Health signal'],
      skills: 8,
      workflows: 3,
      agent: 'Algren (one per account)',
    },
    status: 'In spec · NINJIO',
  },
  {
    icon: Users,
    title: 'Support triage',
    summary: 'Classify inbound tickets, draft responses from historical resolutions, escalate what needs human attention.',
    stack: {
      sources: ['Zendesk', 'Knowledge base', 'Slack'],
      objects: ['Ticket', 'Customer', 'Resolution'],
      skills: 6,
      workflows: 2,
      agent: 'One agent',
    },
    status: 'Planned',
  },
  {
    icon: LineChart,
    title: 'Product intelligence',
    summary: 'Synthesize Jira + Slack + user research + release notes into a rolling narrative. Highlight what shifted.',
    stack: {
      sources: ['Jira', 'Slack', 'Research archive', 'Release notes'],
      objects: ['Feature', 'Insight', 'Release'],
      skills: 5,
      workflows: 1,
      agent: 'One agent',
    },
    status: 'Planned',
  },
];

export default async function UseCasesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Use cases</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            The framework is generic. The use cases are where it earns its keep. Every one is the same five primitives — Sources, Objects, Skills, Workflows, Agents — composed differently.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2">
          {cases.map((c) => {
            const Icon = c.icon;
            return (
              <article key={c.title} className="rounded-xl border border-border bg-background p-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-4 text-xl font-semibold">{c.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.summary}</p>

                <dl className="mt-4 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 font-mono text-muted-foreground">sources</dt>
                    <dd className="text-muted-foreground">{c.stack.sources.join(', ')}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 font-mono text-muted-foreground">objects</dt>
                    <dd className="text-muted-foreground">{c.stack.objects.join(', ')}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 font-mono text-muted-foreground">skills</dt>
                    <dd className="text-muted-foreground">{c.stack.skills}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 font-mono text-muted-foreground">workflows</dt>
                    <dd className="text-muted-foreground">{c.stack.workflows}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 font-mono text-muted-foreground">agent</dt>
                    <dd className="text-muted-foreground">{c.stack.agent}</dd>
                  </div>
                </dl>

                <div className="mt-4 font-mono text-[11px] tracking-wide text-muted-foreground/70 uppercase">
                  {c.status}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <Footer />
    </>
  );
}
