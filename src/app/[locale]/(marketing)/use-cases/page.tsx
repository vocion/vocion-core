import type { Metadata } from 'next';
import { Briefcase, HeartHandshake, LineChart, Users } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Use cases — CoreContext',
  description: 'How teams use CoreContext: sales ops, customer success, support, product intelligence.',
};

const cases = [
  {
    icon: Briefcase,
    title: 'Sales operations',
    summary: 'Post-call summaries, follow-up drafts, proposal generation, pipeline review. All stamped with the exact context SHA, reviewed in one queue.',
    status: 'Live: Ziggy agent (MetaCTO)',
  },
  {
    icon: HeartHandshake,
    title: 'Customer success',
    summary: 'Per-account exec assistant: meeting prep, daily triage across Slack/Teams/email, weekly health summary. Named agent per customer.',
    status: 'In spec: Algren (NINJIO)',
  },
  {
    icon: Users,
    title: 'Support triage',
    summary: 'Classify inbound tickets, draft responses using historical resolutions, escalate what needs human attention.',
    status: 'Planned',
  },
  {
    icon: LineChart,
    title: 'Product intelligence',
    summary: 'Synthesize Jira + Slack + user research + release notes into a rolling narrative. Highlight what shifted.',
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
            The platform is generic. The use cases are where it earns its keep.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2">
          {cases.map((c) => {
            const Icon = c.icon;
            return (
              <article key={c.title} className="rounded-xl border border-border bg-background p-6">
                <div className="flex size-10 items-center justify-center rounded-lg bg-foreground/5">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-4 text-xl font-semibold">{c.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.summary}</p>
                <div className="mt-4 font-mono text-xs tracking-wide text-muted-foreground/70 uppercase">
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
