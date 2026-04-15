import type { Metadata } from 'next';
import { ArrowRight, Inbox, LineChart, Mail } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Starter projects — Vocion',
  description: 'Drop-in AI workflows you can run in 10 minutes. Sales follow-up, support reply drafting, weekly business reporting.',
};

const starters = [
  {
    icon: Mail,
    slug: 'sales-followup',
    title: 'Sales follow-up with approval',
    audience: 'RevOps, sales engineering, founders',
    summary: 'Replace manual SDR follow-up with AI + human approval. Drafts emails from CRM notes, routes to review queue, sends + logs everything.',
    showcases: ['Draft generation', 'Human-in-the-loop', 'Audit trail', 'Multi-interface execution'],
  },
  {
    icon: Inbox,
    slug: 'support-reply',
    title: 'Support reply drafting with escalation',
    audience: 'Support, CX, operations',
    summary: 'Draft support replies with AI; require human approval for edge cases. Confidence-gated, fully traced.',
    showcases: ['Workflows', 'Approval gates', 'Typed plugins', 'Traceability'],
  },
  {
    icon: LineChart,
    slug: 'weekly-report',
    title: 'Weekly business reporting',
    audience: 'Ops, finance, product, leadership',
    summary: 'Turn raw metrics into consistent executive summaries with optional approval before distribution.',
    showcases: ['Repeatable workflows', 'Source integrations', 'Stable outputs', 'Versioned reports'],
  },
];

export default async function StartersPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Starter projects</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Drop-in AI workflows you can run in 10 minutes. Each starter is a real, production-shaped use case showing how the pieces fit.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {starters.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.slug} href={`/starters/${s.slug}`} className="block rounded-xl border border-border bg-background p-6 transition hover:border-foreground/20 hover:shadow-sm">
                <div className="flex size-10 items-center justify-center rounded-lg bg-foreground/5">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-4 text-lg leading-snug font-semibold">{s.title}</h2>
                <div className="mt-1 font-mono text-xs tracking-wide text-muted-foreground/80 uppercase">{s.audience}</div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.summary}</p>
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {s.showcases.map(tag => (
                    <li key={tag} className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-muted-foreground">{tag}</li>
                  ))}
                </ul>
                <div className="mt-5 inline-flex items-center text-sm font-medium">
                  Read more
                  <ArrowRight className="ml-1 size-4" />
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-16 rounded-xl border border-border bg-muted/30 p-6 text-center sm:p-8">
          <h2 className="text-lg font-semibold">More starters coming</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Internal report generators, customer success briefings, candidate screening flows, contract review pipelines.
            File a request on GitHub or build your own.
          </p>
        </div>
      </div>
      <Footer />
    </>
  );
}
