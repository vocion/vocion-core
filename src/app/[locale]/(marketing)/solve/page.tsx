import type { Metadata } from 'next';
import { ArrowRight, BookOpen, CheckCircle2, Eye, GitBranch, GitFork, Github, Globe, Layers, Puzzle, Server, ShieldCheck, Workflow } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'CoreContext — Solve real business problems with AI',
  description: 'The open context platform for AI operations. Context as code, plugins for everything, review queue built in. Talk to it from Claude Code, Slack, ChatGPT, or the web.',
};

type Block = {
  icon: React.ComponentType<{ className?: string }>;
  problem: string;
  benefit: string;
  detail: string;
};

const blocks: Block[] = [
  {
    icon: GitBranch,
    problem: 'Your AI prompts live in someone\'s codebase.',
    benefit: 'Context as code — git-versioned, PR-reviewable.',
    detail: 'Every prompt, skill, agent, and workflow is YAML + markdown in a repo. Change the email voice? That\'s a pull request, not a ticket. Every production output is stamped with the exact SHA that produced it.',
  },
  {
    icon: Globe,
    problem: 'Every AI tool has its own chat window.',
    benefit: 'Talk to it from wherever you already work.',
    detail: 'Claude Code, Slack, ChatGPT, Teams, or the built-in web app — same agents, same skills, same review queue. MCP, A2A, and platform-native adapters all hit the same core.',
  },
  {
    icon: Eye,
    problem: 'AI outputs are black boxes.',
    benefit: 'Full audit trail on every run.',
    detail: 'Every skill run records the input, output, context SHA, and trace id. Six months later you can still answer "why did the AI write this?" with a SQL query and a git diff.',
  },
  {
    icon: Puzzle,
    problem: 'Skills are locked inside vendor platforms.',
    benefit: 'Plugin SDK. Typed contracts. Partner-publishable.',
    detail: 'A skill is a typed TypeScript module with Zod-validated inputs + outputs. Ship it as an npm package. Swap the LLM provider (OpenAI, Anthropic, Vertex, Azure) with a one-line manifest change.',
  },
  {
    icon: Workflow,
    problem: 'Automations break in silence.',
    benefit: 'Workflows with explicit human-in-the-loop gates.',
    detail: 'Compose skills into triggered sequences. Pause at approval steps; resume from any channel. Every step result lands in the same review queue. No silent failures, no runaway loops.',
  },
  {
    icon: CheckCircle2,
    problem: 'Drafts pile up. Nobody knows what\'s pending.',
    benefit: 'One review queue for every pending decision.',
    detail: 'A skill run started in Slack, a workflow paused mid-execution, a draft email from your phone — all land in the same /review page. Approve, reject, or resume with one click.',
  },
  {
    icon: Layers,
    problem: 'One skill good, two skills conflicting.',
    benefit: 'Dual-path execution with clean upgrade paths.',
    detail: 'Prompt-only skills live in git. Code-backed plugins override by slug. Start with a prompt; promote to a plugin when the logic outgrows it. No migration, no breaking changes, no loss of history.',
  },
  {
    icon: ShieldCheck,
    problem: 'Enterprise AI means vendor lock-in.',
    benefit: 'Open core. Apache 2.0. Self-host anywhere.',
    detail: 'Runtime is Apache 2.0. Runs on Postgres + your preferred model host. No proprietary database, no managed-only features, no forced cloud. Bring your own retrieval (pgvector, Vertex, Azure Search) behind a pluggable backend.',
  },
];

export default async function SolvePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />

      <div className="mx-auto max-w-5xl px-6 py-20 lg:py-28">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            Open context platform for AI operations
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Solve real business problems
            {' '}
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              with AI
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Context as code. Plugins for everything. One review queue. Talk to it from Claude Code, Slack, or the web —
            same brain, same audit trail. Run it yourself on any cloud or get it managed.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              Get started
              <ArrowRight className="ml-2 size-4" />
            </Link>
            <Link href="/dashboard/docs" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              <BookOpen className="mr-2 size-4" />
              Read the docs
            </Link>
            <a href="https://github.com" target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>
              <Github className="mr-2 size-4" />
              Source
            </a>
          </div>
        </div>

        {/* Problem/benefit blocks */}
        <div className="mt-24 grid gap-6 sm:grid-cols-2">
          {blocks.map((block) => {
            const Icon = block.icon;
            return (
              <article key={block.benefit} className="rounded-xl border border-border bg-background p-6 transition hover:border-foreground/20 hover:shadow-sm">
                <div className="flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 text-lg leading-snug font-semibold">{block.benefit}</h3>
                <div className="mt-2 text-xs tracking-wide text-muted-foreground/80 uppercase">
                  Replaces:
                  {' '}
                  <span className="tracking-normal text-muted-foreground normal-case">{block.problem}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{block.detail}</p>
              </article>
            );
          })}
        </div>

        {/* How it fits */}
        <div className="mt-24 rounded-2xl border border-border bg-muted/30 p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">One brain. Every interface.</h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            CoreContext is the runtime underneath your AI work. Your context + skills + workflows live in one place.
            Pick any surface to interact with them — or build your own via the plugin SDK.
          </p>

          <dl className="mt-10 grid gap-8 sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <Server className="size-4" />
                {' '}
                Runtime
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground">Postgres + pluggable retrieval (pgvector, Vertex, Azure). Skills, agents, workflows, review queue, audit.</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <Puzzle className="size-4" />
                {' '}
                Plugins
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground">Typed Skill + Source contracts. npm-installable. Bring your own connectors and LLM providers.</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <Globe className="size-4" />
                {' '}
                Interfaces
              </dt>
              <dd className="mt-2 text-sm text-muted-foreground">MCP for Claude Code + Cursor + Zed. Slack/Teams/ChatGPT adapters. A2A for agent-to-agent handoff. Built-in web UI.</dd>
            </div>
          </dl>
        </div>

        {/* Final CTA */}
        <div className="mt-20 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Run it yourself. Or get it managed.</h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            Apache 2.0 runtime. Self-host on your infra, or let MetaCTO stand it up + run continuous ops.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dashboard/docs/docs/self-hosted" className={buttonVariants({ size: 'lg' })}>
              <GitFork className="mr-2 size-4" />
              Self-host guide
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              Get managed
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}
