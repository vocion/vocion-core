import type { Metadata } from 'next';
import { ArrowRight, Bot, Code2, Database, Eye, GitBranch, Github, Inbox, LineChart, Mail, Plug, Puzzle, ScrollText, ShieldCheck, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Vocion — five building blocks for production AI workflows',
  description: 'Open framework for AI systems that hold up in production: context as code, typed plugins, human review, and full audit trails. Apache 2.0, self-hostable.',
};

const blocks = [
  {
    icon: Plug,
    name: 'Source',
    body: 'Connected systems that feed raw data in — Zoom, Gmail, HubSpot, your own APIs. Typed, authored per tenant.',
  },
  {
    icon: Database,
    name: 'Object',
    body: 'Business entities you care about — Account, Deal, Ticket. The canonical grounded record every run reads from.',
  },
  {
    icon: Zap,
    name: 'Skill',
    body: 'A single LLM-powered unit of work with typed I/O. Prompt today, plugin tomorrow — same slug, same history.',
  },
  {
    icon: GitBranch,
    name: 'Workflow',
    body: 'A sequence of Skills with human-in-the-loop approve gates. Durable on Postgres, resumable from any interface.',
  },
  {
    icon: Bot,
    name: 'Agent',
    body: 'An LLM orchestrator wired to a specific catalog of Skills + Workflows, with its own system prompt and voice.',
  },
];

const principles = [
  {
    icon: GitBranch,
    title: 'Context as code',
    body: 'Every building block lives in git as YAML + markdown. Review changes with PRs, not screenshots and guesswork.',
  },
  {
    icon: ShieldCheck,
    title: 'Human review built in',
    body: 'Approve gates exactly where they matter. Drafts land in one queue regardless of which interface triggered them.',
  },
  {
    icon: Eye,
    title: 'Full audit trail',
    body: 'Every run stamps the active context SHA. Any output traces back to the exact prompts + code that produced it.',
  },
  {
    icon: Puzzle,
    title: 'Typed plugin SDK',
    body: 'Ship skills + sources as npm packages with Zod contracts. Publish independently; pin per tenant.',
  },
];

const flow = [
  { n: '01', title: 'Author', body: 'Edit a skill.yaml or prompt.md in your editor.' },
  { n: '02', title: 'Apply', body: 'npm run context:apply reconciles YAML → DB and stamps a new context version.' },
  { n: '03', title: 'Run', body: 'Trigger from Claude Code, Slack, ChatGPT, the dashboard, or a scheduled workflow.' },
  { n: '04', title: 'Review', body: 'Drafts + paused workflows land in one queue. Approve, reject, resume.' },
  { n: '05', title: 'Audit', body: 'Every run records inputs, outputs, trace spans, retrieval hits, context SHA.' },
];

const starters = [
  {
    icon: Mail,
    title: 'Sales follow-up with approval',
    body: 'Draft outbound follow-ups from CRM notes, route them to review, keep a full trace of every message.',
    href: '/starters/sales-followup',
  },
  {
    icon: Inbox,
    title: 'Support reply drafting',
    body: 'Turn inbound tickets into draft responses with human approval on edge cases and full auditability.',
    href: '/starters/support-reply',
  },
  {
    icon: LineChart,
    title: 'Weekly business reporting',
    body: 'Generate consistent internal updates from raw metrics, review before distribution.',
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
            Apache 2.0 · self-host anywhere
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Five building blocks for production AI workflows.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Vocion is an open framework for teams that need AI to hold up in production — versioned context, typed plugins, human review, and a complete audit trail, reachable from every interface you already use.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Get started
              <ArrowRight className="ml-2 size-4" />
            </Link>
            <Link href="/docs" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Read the docs
            </Link>
            <a href="https://github.com/vocion/core" target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>
              <Github className="mr-2 size-4" />
              Source
            </a>
          </div>
        </section>

        {/* The five building blocks — the spine of the product */}
        <section className="mt-24">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Five building blocks. Everything else is runtime.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground">
              Read all five and you understand Vocion. They're the only things you author — every skill run, workflow, and agent decision composes from them.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {blocks.map((p) => {
              const Icon = p.icon;
              return (
                <Link
                  key={p.name}
                  href={`/docs/docs/concepts/${p.name.toLowerCase()}s`}
                  className="rounded-xl border border-border bg-background p-5 transition hover:border-primary/30"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="mt-3 font-semibold">{p.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.body}</p>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Pain */}
        <section className="mt-24 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">AI breaks when it leaves the demo.</h2>
          <div className="mt-5 max-w-3xl space-y-4 text-base leading-relaxed text-muted-foreground">
            <p>
              Most teams ship AI by stitching prompts into app code, bots, and internal tools. Then things drift. Nobody knows what changed. Outputs are hard to explain. Approvals happen in DMs. Every interface has its own copy of the logic.
            </p>
            <p>
              Vocion gives you one runtime for AI work that needs to survive production — same building blocks from CLI to Slack to your own app, with a review queue and an audit trail underneath everything.
            </p>
          </div>
        </section>

        {/* Principles */}
        <section className="mt-24">
          <div className="grid gap-6 sm:grid-cols-2">
            {principles.map((v) => {
              const Icon = v.icon;
              return (
                <article key={v.title} className="rounded-xl border border-border bg-background p-6">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Author → Apply → Run → Review → Audit.</h2>
            <p className="mt-3 text-base text-muted-foreground">One loop, every interface.</p>
          </div>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {flow.map(step => (
              <li key={step.n} className="rounded-lg border border-border bg-background p-4">
                <div className="font-mono text-xs text-muted-foreground">{step.n}</div>
                <div className="mt-1 text-base font-semibold">{step.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Starters */}
        <section className="mt-24">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Start with real business workflows.</h2>
            <p className="mt-3 text-base text-muted-foreground">Drop-in starter projects you can run in 10 minutes.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {starters.map((s) => {
              const Icon = s.icon;
              return (
                <Link key={s.title} href={s.href} className="block rounded-xl border border-border bg-background p-6 transition hover:border-primary/30">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for engineers who want leverage and control.</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Start with prompt-defined skills in YAML + markdown. Promote to typed plugins via
              {' '}
              <code className="rounded bg-muted px-1 font-mono text-sm">@vocion/sdk</code>
              {' '}
              when the logic gets complex. No migration; same slug, same history, cleaner upgrade path.
            </p>
            <ul className="mt-6 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                YAML + markdown for fast iteration
              </li>
              <li className="flex items-start gap-2">
                <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Typed plugins with Zod schemas
              </li>
              <li className="flex items-start gap-2">
                <Code2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Swap LLM providers per-skill without rewriting logic
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Start with prompts, graduate to code when needed
              </li>
            </ul>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 p-5 font-mono text-xs leading-relaxed">
            <code>
              {`context/<org>/
  sources/
    hubspot/source.yaml
  objects/
    deal/type.yaml
  skills/
    draft_followup/
      skill.yaml
      prompt.md
  workflows/
    discovery_followup/workflow.yaml
  agents/
    ziggy.yaml
    ziggy.system-prompt.md`}
            </code>
          </pre>
        </section>

        {/* Open core */}
        <section className="mt-24 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Open core by default.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Vocion is Apache 2.0 and designed to run on your infrastructure. Use your own model providers, retrieval stack, and deployment setup. Add managed services only if and when you want them.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/docs/docs/guides/self-hosting" className={buttonVariants({ variant: 'outline' })}>
              Self-host guide
            </Link>
            <a href="https://github.com/vocion/core" target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
              <Github className="mr-2 size-4" />
              View source
            </a>
          </div>
        </section>

        {/* MetaCTO bridge */}
        <section className="mt-20 rounded-xl border border-border bg-background p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Need help shipping it in a real business?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                MetaCTO uses Vocion to design and deploy production AI workflows for operating teams, support orgs, and internal platforms. If you want help implementing, hosting, or customizing it, work with the team behind the platform.
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
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Build AI systems that hold up in production.</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/docs" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
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
