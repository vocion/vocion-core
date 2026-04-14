import type { Metadata } from 'next';
import { ArrowRight, BookOpen, Code2, Eye, GitBranch, Github, Inbox, LineChart, Mail, Puzzle, ScrollText, ShieldCheck, Workflow } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'CoreContext — Build production AI systems, not prompt spaghetti',
  description: 'Open runtime for AI workflows with versioned context, typed plugins, human review, and full audit trails. Build once, run from Slack, Claude Code, ChatGPT, or your own app. Apache 2.0, self-hostable.',
};

const valueProps = [
  {
    icon: GitBranch,
    title: 'Context as code',
    body: 'Prompts, skills, agents, and workflows live in git. Review changes with pull requests, not screenshots and guesswork.',
  },
  {
    icon: ShieldCheck,
    title: 'Human review built in',
    body: 'Add approval gates exactly where they matter. Resume from Slack, web, or any interface without losing state.',
  },
  {
    icon: Eye,
    title: 'Full audit trail',
    body: 'Every run records inputs, outputs, trace metadata, and the exact context version used.',
  },
  {
    icon: Puzzle,
    title: 'Typed plugin SDK',
    body: 'Build skills and sources as TypeScript modules with Zod-validated inputs and outputs.',
  },
  {
    icon: Workflow,
    title: 'Any model, any interface',
    body: 'Swap LLM providers per-skill. Trigger from Claude Code, Slack, ChatGPT, Teams, or your own app.',
  },
  {
    icon: Code2,
    title: 'Open and self-hostable',
    body: 'Apache 2.0 runtime on Postgres with pluggable retrieval. No forced cloud, no vendor lock-in.',
  },
];

const howSteps = [
  { n: '01', title: 'Define', body: 'Store context, skills, and workflows in your repo.' },
  { n: '02', title: 'Compose', body: 'Connect skills into workflows with explicit review steps.' },
  { n: '03', title: 'Run', body: 'Trigger from CLI, Slack, Claude Code, ChatGPT, or custom integrations.' },
  { n: '04', title: 'Review', body: 'Approve, reject, or resume from one shared review queue.' },
  { n: '05', title: 'Audit', body: 'Trace every output back to the exact version that generated it.' },
];

const starters = [
  {
    icon: Mail,
    title: 'Sales follow-up with approval',
    body: 'Draft outbound follow-ups from CRM notes, route them to review, and keep a full trace of every message.',
    href: '/starters/sales-followup',
  },
  {
    icon: Inbox,
    title: 'Support reply drafting',
    body: 'Turn inbound tickets into draft responses with human approval for edge cases and full auditability.',
    href: '/starters/support-reply',
  },
  {
    icon: LineChart,
    title: 'Weekly business reporting',
    body: 'Generate consistent internal updates from raw metrics and review them before distribution.',
    href: '/starters/weekly-report',
  },
];

export default async function SolvePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />

      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        {/* Hero */}
        <section className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            Apache 2.0 · self-host anywhere
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Build production AI systems,
            <br className="hidden sm:block" />
            {' '}
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              not prompt spaghetti
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            CoreContext is an open runtime for AI workflows with versioned context, typed plugins, human review, and full audit trails.
            Build once. Run from Slack, Claude Code, ChatGPT, or your own app.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Get started
              <ArrowRight className="ml-2 size-4" />
            </Link>
            <Link href="/starters" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              View starter projects
            </Link>
            <a href="https://github.com" target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>
              <Github className="mr-2 size-4" />
              Source
            </a>
          </div>
        </section>

        {/* Pain — why this exists */}
        <section className="mt-28 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">AI breaks when it leaves the demo</h2>
          <div className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground">
            <p>
              Most teams ship AI by stitching prompts into app code, bots, and internal tools. Then things drift.
              Nobody knows what changed. Outputs are hard to explain. Approval steps happen in DMs. Every interface has its own logic.
            </p>
            <p className="mt-4">CoreContext gives you one runtime for AI work that needs to survive production.</p>
          </div>
        </section>

        {/* Value prop grid */}
        <section className="mt-24">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {valueProps.map((v) => {
              const Icon = v.icon;
              return (
                <article key={v.title} className="rounded-xl border border-border bg-background p-6 transition hover:border-foreground/20 hover:shadow-sm">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-lg leading-snug font-semibold">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{v.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <section className="mt-24">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">One runtime. Every interface.</h2>
            <p className="mt-3 text-base text-muted-foreground">Five steps. No magic.</p>
          </div>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {howSteps.map(step => (
              <li key={step.n} className="rounded-lg border border-border bg-background p-4">
                <div className="font-mono text-xs text-muted-foreground">{step.n}</div>
                <div className="mt-1 text-base font-semibold">{step.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Starter projects */}
        <section className="mt-24">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Start with real business workflows</h2>
            <p className="mt-3 text-base text-muted-foreground">Drop-in starter projects you can run in 10 minutes.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {starters.map((s) => {
              const Icon = s.icon;
              return (
                <Link key={s.title} href={s.href} className="block rounded-xl border border-border bg-background p-6 transition hover:border-foreground/20 hover:shadow-sm">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-base leading-snug font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  <div className="mt-4 inline-flex items-center text-sm font-medium">
                    Explore
                    <ArrowRight className="ml-1 size-4" />
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="mt-8 text-center">
            <Link href="/starters" className={buttonVariants({ variant: 'outline' })}>
              All starter projects
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </div>
        </section>

        {/* Dev section */}
        <section className="mt-24 grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for developers who need leverage and control</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Start with prompt-defined skills in YAML and markdown. Promote them to typed plugins when the logic gets complex.
              No migration. No rewrite. Same slug, same history, cleaner upgrade path.
            </p>
            <ul className="mt-6 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                YAML + markdown for fast iteration
              </li>
              <li className="flex items-start gap-2">
                <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Typed plugins with Zod contracts
              </li>
              <li className="flex items-start gap-2">
                <Code2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Swap LLM providers without rewriting logic
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Start with prompts, upgrade to code when needed
              </li>
            </ul>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 p-5 font-mono text-xs leading-relaxed">
            <code>
              {`context/<org>/
  skills/
    summarize_ticket/
      skill.yaml
      prompt.md
    draft_reply/
      skill.yaml
      prompt.md

  workflows/
    support_triage/
      workflow.yaml

  agents/
    helper.yaml
    helper.system-prompt.md

plugins/
  @acme/crm-source
  @acme/approval-gate`}
            </code>
          </pre>
        </section>

        {/* Open core */}
        <section className="mt-24 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Open core by default</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            CoreContext is Apache 2.0 licensed and designed to run on your infrastructure. Use your own model providers,
            retrieval stack, and deployment setup. Add managed services only if and when you want them.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard/docs/docs/self-hosted" className={buttonVariants({ variant: 'outline' })}>
              <BookOpen className="mr-2 size-4" />
              Self-host guide
            </Link>
            <a href="https://github.com" target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
              <Github className="mr-2 size-4" />
              View source
            </a>
          </div>
        </section>

        {/* MetaCTO bridge — subordinated, secondary CTA */}
        <section className="mt-20 rounded-xl border border-border bg-background p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Need help shipping it in a real business?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                MetaCTO uses CoreContext to design and deploy production AI workflows for operating teams, support orgs, and internal platforms.
                If you want help implementing, hosting, or customizing it, work with the team behind the platform.
              </p>
            </div>
            <div className="flex gap-2">
              <a href="https://www.metacto.com" target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
                Talk to MetaCTO
              </a>
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="mt-20 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Build AI systems that hold up in production</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dashboard/docs" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Read the docs
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Start building
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </>
  );
}
