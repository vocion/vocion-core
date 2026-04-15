import type { Metadata } from 'next';
import { ArrowRight, Bot, Code2, Database, Eye, GitBranch, Github, Inbox, LineChart, Mail, Plug, ScrollText, ShieldCheck, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Vocion — one runtime for AI work that has to survive production',
  description: 'Open framework for AI workflows with versioned context, typed plugins, human review, and full traceability across web, Slack, Teams, CLI, and your own app. Apache 2.0, self-hostable.',
};

const blocks = [
  {
    icon: Plug,
    name: 'Source',
    body: 'Connected systems that feed raw data in. Zoom, Gmail, HubSpot, Postgres, your own APIs. Typed and authored per tenant.',
  },
  {
    icon: Database,
    name: 'Object',
    body: 'The business entities you care about. Account, Deal, Ticket, Incident. Canonical grounded records every run reads from.',
  },
  {
    icon: Zap,
    name: 'Skill',
    body: 'A single LLM-powered unit of work with typed input and output. Prompt today, plugin tomorrow. Same slug, same history.',
  },
  {
    icon: GitBranch,
    name: 'Workflow',
    body: 'A sequence of Skills with human review where it matters. Durable on Postgres. Resumable from any interface.',
  },
  {
    icon: Bot,
    name: 'Agent',
    body: 'An orchestrator wired to a specific catalog of Skills and Workflows, with its own system prompt, voice, and operating boundary.',
  },
];

const loop = [
  { title: 'Feedback', body: 'Capture human judgment at review time, not weeks later after the workflow is forgotten.' },
  { title: 'Audit', body: 'Every run records inputs, outputs, trace spans, retrieval hits, approvals, and the exact active context version.' },
  { title: 'Evals', body: 'Run fixtures against Skills and Workflows so regressions become visible before they hit production.' },
  { title: 'Iteration', body: 'Change prompts, workflows, and plugins in git. Review them in PRs. Apply them deliberately.' },
  { title: 'Measurement', body: 'Track run volume, approval rate, latency, and cost so the workflow can be improved, not just admired.' },
];

const flow = [
  { n: '01', title: 'Author', body: 'Edit a skill.yaml, workflow.yaml, or prompt.md in your editor.' },
  { n: '02', title: 'Apply', body: 'Reconcile authored context into the runtime and stamp a new context version.' },
  { n: '03', title: 'Run', body: 'Trigger from web, Slack, Teams, CLI, your app, or a scheduled workflow.' },
  { n: '04', title: 'Review', body: 'Drafts and paused workflows land in one queue. Approve, reject, revise, resume.' },
  { n: '05', title: 'Audit', body: 'Trace any output back to the exact context version, inputs, retrieval hits, and runtime path that produced it.' },
];

const sources = ['Gmail', 'HubSpot', 'Zoom', 'Slack', 'Postgres', 'Stripe', 'Zendesk', 'Google Drive', 'Notion', 'Salesforce', 'Custom REST', 'Webhooks'];

const interfaces = ['web', 'Slack', 'Teams', 'CLI', 'your own app', 'scheduled jobs', 'API triggers'];

const why = ['reproducibility', 'reviewability', 'typed boundaries', 'runtime consistency', 'interface independence', 'operational visibility', 'self-hosted deployment'];

const starters = [
  {
    icon: Mail,
    title: 'Sales follow-up with approval',
    body: 'Draft outbound follow-ups from CRM notes and call context, route them to review, keep a full trace of every message.',
    href: '/starters/sales-followup',
  },
  {
    icon: Inbox,
    title: 'Support reply drafting',
    body: 'Turn inbound tickets into draft responses with human approval on edge cases and a complete audit trail.',
    href: '/starters/support-reply',
  },
  {
    icon: LineChart,
    title: 'Weekly business reporting',
    body: 'Generate structured updates from raw metrics, review before distribution, keep one history of every run.',
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
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            One runtime for AI work that has to survive production.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Vocion is an open framework for building AI workflows with versioned context, typed plugins, human review, and full traceability across web, Slack, Teams, CLI, and your own app.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            Apache 2.0 · self-host anywhere
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Get started
              <ArrowRight className="ml-2 size-4" />
            </Link>
            <Link href="/docs" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Read the docs
            </Link>
            <a href="https://github.com/vocion/core" target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>
              <Github className="mr-2 size-4" />
              View source
            </a>
          </div>
          <p className="mx-auto mt-6 max-w-xl text-sm text-muted-foreground/80">
            Author once. Run from any interface. Review in one queue. Audit every output.
          </p>
        </section>

        {/* The real problem */}
        <section className="mt-28 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">AI breaks when it leaves the demo.</h2>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Most teams get their first AI workflow working by stitching prompts into app code, bots, cron jobs, and internal tools. Then things drift.
          </p>
          <ul className="mt-4 grid max-w-3xl gap-1.5 text-sm leading-relaxed text-muted-foreground">
            <li>— nobody knows what changed</li>
            <li>— outputs are hard to explain</li>
            <li>— approvals happen in DMs</li>
            <li>— every interface has its own copy of the logic</li>
            <li>— runs are hard to reproduce</li>
            <li>— "does this still work?" becomes guesswork</li>
          </ul>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-foreground">
            Vocion gives you one runtime for AI work that needs to hold up in production.
          </p>
        </section>

        {/* Core idea */}
        <section className="mt-28">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Five building blocks to author AI work.</h2>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">One runtime to operate it.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
              Vocion stays small on purpose. These five building blocks are the authoring surface. Everything else is runtime.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {blocks.map((b) => {
              const Icon = b.icon;
              return (
                <Link
                  key={b.name}
                  href={`/docs/docs/concepts/${b.name.toLowerCase()}s`}
                  className="rounded-xl border border-border bg-background p-5 transition hover:border-primary/30"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="mt-3 font-semibold">{b.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{b.body}</p>
                </Link>
              );
            })}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
            Agents are optional. The runtime works just as well for deterministic reviewed workflows.
          </p>
        </section>

        {/* Interfaces */}
        <section className="mt-28 grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">One runtime, every interface.</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Author once. Trigger and review from wherever your team already works.
            </p>
            <div className="mt-6 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Run from</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {interfaces.map(x => (
                <span key={x} className="rounded-full border border-border bg-background px-3 py-1 text-xs">{x}</span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">What stays the same underneath</div>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li>— context version</li>
              <li>— workflow logic</li>
              <li>— approvals</li>
              <li>— audit trail</li>
              <li>— trace spans</li>
              <li>— output history</li>
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">No more separate prompt stacks for each surface.</p>
          </div>
        </section>

        {/* Sources */}
        <section className="mt-28">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Connect the systems your workflows already depend on.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Vocion is built for real business systems, not toy demos.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {sources.map(s => (
              <span key={s} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">{s}</span>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Starter connectors and source patterns first. Typed source plugins when you need more control.
          </p>
        </section>

        {/* Production loop */}
        <section className="mt-28">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">What happens after a run matters.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Most AI stacks stop at generation. Vocion includes the operating loop that makes workflows usable in production.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {loop.map(item => (
              <div key={item.title} className="rounded-lg border border-border bg-background p-4">
                <div className="text-sm font-semibold">{item.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Context as code */}
        <section className="mt-28 grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Review changes in PRs, not screenshots.</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Every building block lives in git as YAML and markdown.
            </p>
            <ol className="mt-6 space-y-1.5 text-sm">
              <li>
                — edit
                {' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">skill.yaml</code>
                {' '}
                or
                {' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">prompt.md</code>
              </li>
              <li>— commit the change</li>
              <li>— review it in a PR</li>
              <li>— apply it to the runtime</li>
              <li>— run and review with a stamped context version</li>
            </ol>
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

        {/* Operating flow */}
        <section className="mt-28">
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
        <section className="mt-28">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Start with a real business workflow, not a blank canvas.</h2>
            <p className="mt-3 text-base text-muted-foreground">
              Vocion ships best when you begin with something your team already does every week.
            </p>
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

        {/* Build path for engineers */}
        <section className="mt-28 grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Start with prompts. Graduate to code when the logic gets real.</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Start fast with YAML and markdown. Move to typed plugins when the workflow needs stronger contracts, richer logic, or external actions.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              This is not a throwaway prototype path. It is the intended upgrade path.
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              YAML and markdown for fast iteration
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Typed plugins with Zod schemas via
              {' '}
              <code className="rounded bg-muted px-1 font-mono">@vocion/sdk</code>
            </li>
            <li className="flex items-start gap-2">
              <Code2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Swap providers per Skill without rewriting the whole workflow
            </li>
            <li className="flex items-start gap-2">
              <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Preserve slug and history as you evolve
            </li>
          </ul>
        </section>

        {/* Why developers */}
        <section className="mt-28 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for engineers who want leverage and control.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Vocion is for teams that care about:
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {why.map(w => (
              <span key={w} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs">{w}</span>
            ))}
          </div>
          <p className="mt-5 text-sm text-muted-foreground">Not just "agents."</p>
        </section>

        {/* Open source / deployment */}
        <section className="mt-28">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Open source by default.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Vocion is Apache 2.0 and designed to run on your infrastructure.
          </p>
          <ul className="mt-5 space-y-1.5 text-sm">
            <li>— self-host anywhere</li>
            <li>— use your own model providers</li>
            <li>— bring your own retrieval stack</li>
            <li>— run on your own Postgres</li>
            <li>— keep your own deployment topology</li>
          </ul>
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Managed services can sit on top later if you want them. The framework does not depend on them.
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

        {/* Commercial CTA */}
        <section className="mt-20 rounded-xl border border-border bg-background p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Need help shipping it in a real business?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                MetaCTO uses Vocion to design and deploy production AI workflows for revenue teams, support orgs, operating teams, and internal platforms. If you want help implementing, hosting, or customizing it, work with the team behind the framework.
              </p>
              <p className="mt-2 text-xs text-muted-foreground/80">Framework first. Services if you want them.</p>
            </div>
            <div className="flex gap-2">
              <a href="https://www.metacto.com" target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
                Talk to MetaCTO
              </a>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mt-20 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Build AI systems that hold up in production.</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Get started
              <ArrowRight className="ml-2 size-4" />
            </Link>
            <Link href="/docs" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Read the docs
            </Link>
            <a href="https://github.com/vocion/core" target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>
              <Github className="mr-2 size-4" />
              View source
            </a>
          </div>
        </section>

        {/* Eye icon reserved for future use */}
        <Eye className="sr-only" aria-hidden="true" />
      </div>

      <Footer />
    </>
  );
}
