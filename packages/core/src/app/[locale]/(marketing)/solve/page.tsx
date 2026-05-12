import type { Metadata } from 'next';
import { ArrowRight, Bot, Code2, Database, Eye, GitBranch, Github, Inbox, LineChart, Mail, Plug, ScrollText, ShieldCheck, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Vocion — the open framework for production-ready agents and agentic workflows',
  description: 'Build, ship, and observe AI work in your own infra. Git-backed context, typed plugins, MCP-native, full observability. Open source. No vendor lock-in.',
};

const blocks = [
  {
    icon: Plug,
    name: 'Source',
    href: '/docs/docs/concepts/sources',
    body: 'Connected systems that feed raw data in. Zoom, Gmail, HubSpot, Postgres, your own APIs. Typed and authored per tenant.',
  },
  {
    icon: Database,
    name: 'Object',
    href: '/docs/docs/concepts/objects',
    body: 'The business entities you care about. Account, Deal, Ticket, Incident. Canonical grounded records every run reads from.',
  },
  {
    icon: Zap,
    name: 'Operation',
    href: '/docs/docs/concepts/skills',
    body: 'Typed LLM call. Zod schemas in, Zod schemas out. Approval-gated when it matters. Authored as prompt today, swapped to plugin tomorrow under the same slug.',
  },
  {
    icon: GitBranch,
    name: 'Workflow',
    href: '/docs/docs/concepts/workflows',
    body: 'A sequence of Operations with human approval gates where it matters. Durable on Postgres. Resumable from any interface.',
  },
  {
    icon: Bot,
    name: 'Agent',
    href: '/docs/docs/concepts/agents',
    body: 'A named identity with a system prompt, tool surface, subagents, and budget. Runs on the deepagents runtime — virtual FS, write_todos, subagent dispatch, full observability.',
  },
];

const loop = [
  { title: 'Human-in-the-loop', body: 'The request_human_review tool pauses a run for approval. Comments on Drive decks and Slack reactions flow into the same queue.' },
  { title: 'Full observability', body: 'Every LLM call, tool span, and subagent dispatch lands in Langfuse — joined to the context SHA that produced it.' },
  { title: 'Eval-driven development', body: 'npm run eval:run scores datasets via LLM judge. Stamp every run with its context SHA. Pass-rate < 0.8 fails CI.' },
  { title: 'Self-improving', body: 'The self-improver subagent watches feedback, proposes rules, and (after your explicit approval) commits them as learning rows the agent reads on every relevant turn.' },
  { title: 'Compute budgets', body: 'Token and dollar caps per agent, per period. Hard cap refuses new runs. Soft cap warns. Cache reads billed at 10% per the model card.' },
];

const flow = [
  { n: '01', title: 'Author', body: 'Edit an operation.yaml, workflow.yaml, SKILL.md playbook, or prompt.md in your editor.' },
  { n: '02', title: 'Apply', body: 'Reconcile authored context into the runtime and stamp a new context version.' },
  { n: '03', title: 'Run', body: 'Trigger from web, Slack, Teams, CLI, your app, or a scheduled workflow.' },
  { n: '04', title: 'Review', body: 'Drafts and paused workflows land in one queue. Approve, reject, revise, resume.' },
  { n: '05', title: 'Log', body: 'Trace any output back to the exact context version, inputs, retrieval hits, and runtime path that produced it.' },
];

const sources = ['Gmail', 'HubSpot', 'Zoom', 'Slack', 'Postgres', 'Stripe', 'Zendesk', 'Google Drive', 'Notion', 'Salesforce', 'Custom REST', 'Webhooks'];

const interfaces = ['web', 'MCP server', 'Slack', 'Teams', 'CLI', 'your own app', 'scheduled jobs', 'API triggers'];

const why = ['reproducibility', 'reviewability', 'typed boundaries', 'runtime consistency', 'MCP-native', 'operational visibility', 'self-hosted deployment'];

const proof = [
  'deepagents runtime + subagents',
  'Playbooks, learnings, evals, budgets',
  'MCP-native + 12 connectors',
  'Self-host · Apache 2.0',
];

const primitives = [
  {
    name: 'Playbook',
    body: 'Markdown + YAML the agent reads on demand. Procedural guides for "how we draft a proposal", "how we triage a meeting." Resources (REFERENCE.html, COMPONENTS.md) ride along. Per-agent playbookTags decide what mounts where. Lazy-loaded — no bloat to the per-turn prompt.',
  },
  {
    name: 'Learning',
    body: 'Whitelisted rule buckets ("global", "meeting_triage", "proposal_drafting"…). Rules are added at runtime by the self-improver subagent after the user explicitly approves a candidate. Trigram dedup at 0.72 keeps the store clean. The agent reads its applicable rules as /learnings/<step>.md on every turn.',
  },
];

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
          <Link
            href="/docs/docs/upgrades/v0.2-langchain"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-primary uppercase">v0.2</span>
            deepagents runtime · playbooks · learnings · evals
            <ArrowRight className="size-3" />
          </Link>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            The open framework for production-ready agents and agentic workflows.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            Build, ship, and observe AI work in your own infra. Git-backed context. Typed plugins. MCP-native. Full observability — without the hosted-SaaS lock-in.
          </p>
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
          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2">
            {proof.map(p => (
              <span key={p} className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">{p}</span>
            ))}
          </div>
        </section>

        {/* The real problem */}
        <section className="mt-28 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">AI breaks when it leaves the demo.</h2>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Most teams get their first agentic workflow working by stitching prompts into app code, bots, cron jobs, and internal tools. Then things drift.
          </p>
          <ul className="mt-4 grid max-w-3xl gap-1.5 text-sm leading-relaxed text-muted-foreground">
            <li>— prompts drift, outputs change, nobody knows why</li>
            <li>— no evals — you ship and hope</li>
            <li>— compute runs away with no per-agent budgets, no alerts</li>
            <li>— approvals scattered across Slack threads and Notion docs</li>
            <li>— every interface re-implements the same logic</li>
            <li>— "does this still work?" becomes guesswork</li>
          </ul>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-foreground">
            Vocion gives you one runtime for AI work that has to hold up in production.
          </p>
        </section>

        {/* Core idea */}
        <section className="mt-28">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Five resources to author AI work.</h2>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">One runtime to operate it.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
              Vocion stays small on purpose. These five resources are the authoring surface. Everything else is runtime.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {blocks.map((b) => {
              const Icon = b.icon;
              return (
                <Link
                  key={b.name}
                  href={b.href}
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

        {/* Compositional primitives — v0.2 */}
        <section className="mt-28">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Two compositional primitives.</h2>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Authored once. Mounted into every relevant agent.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
              v0.2 added two primitives that compose on top of the five resources — for the procedural knowledge and continuous improvement that agentic systems need to stay accurate.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {primitives.map(p => (
              <div key={p.name} className="rounded-xl border border-border bg-background p-6">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary uppercase">v0.2</span>
                  <div className="text-base font-semibold">{p.name}</div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Interfaces */}
        <section className="mt-28 grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">One runtime, every interface.</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Author once. Trigger and review from wherever your team already works. Speak MCP, and every Claude-side client can call your agents as tools.
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
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Connect what you already run.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Built for real business systems, not toy demos. Twelve first-class connectors today; typed source plugins when you need more control.
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
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">The operating loop that makes agentic systems usable.</h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Most AI stacks stop at generation. Vocion ships the five primitives every production agentic system needs — human review, observability, evals, self-improvement, and compute budgets.
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
              Every resource lives in git as YAML and markdown.
            </p>
            <ol className="mt-6 space-y-1.5 text-sm">
              <li>
                — edit
                {' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">operation.yaml</code>
                ,
                {' '}
                <code className="rounded bg-muted px-1 font-mono text-xs">SKILL.md</code>
                , or
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
  agents/
    sales-assistant/
      agent.yaml          # slug, prompt, subagents, suggestions
      system-prompt.md
  operations/             # v0.2: typed LLM calls (was skills/)
    draft_followup/
      operation.yaml
      prompt.md
      evals.yaml
  playbooks/              # v0.2: markdown the agent reads on demand
    ece-proposal/
      SKILL.md            # YAML frontmatter + procedural guide
      REFERENCE.html      # sibling resources ride along
  learnings/              # v0.2: whitelisted rule-step buckets
    global.yaml
    meeting_triage.yaml
  evals/                  # v0.2: agent eval datasets
    sales-assistant-baseline.yaml
  workflows/
    discovery_followup/
      workflow.yaml
  objects/
    deal/
      type.yaml`}
            </code>
          </pre>
          <p className="col-span-full mt-4 text-center text-xs text-muted-foreground/80 lg:col-start-2">
            Same folder pattern across every resource: structured definition · LLM-facing content · evals · notes. Easy to author, easy to diff, easy to test.
          </p>
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
              <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Dispatch subagents — author once, mount as tools, run in parallel via
              {' '}
              <code className="rounded bg-muted px-1 font-mono">{`task("name", "...")`}</code>
            </li>
            <li className="flex items-start gap-2">
              <Code2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Swap providers per Operation without rewriting the whole workflow
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
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Build agents that survive production.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            Subagents, playbooks, learnings, evals, budgets, HITL — out of the box. Your code, your infra, your data.
          </p>
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
