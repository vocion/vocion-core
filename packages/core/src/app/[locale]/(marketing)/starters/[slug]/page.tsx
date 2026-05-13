import type { Metadata } from 'next';
import { ArrowRight, BookOpen, Github } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

type Starter = {
  slug: string;
  title: string;
  positioning: string;
  whoFor: string;
  whatItDoes: string[];
  whyItWorks: string;
  flow: string[];
  repoStructure: string;
  demoFlow: string[];
};

const STARTERS: Record<string, Starter> = {
  'sales-followup': {
    slug: 'sales-followup',
    title: 'Sales follow-up with approval',
    positioning: 'Replace manual SDR follow-up with AI + human approval',
    whoFor: 'RevOps, sales engineering, founders, ops-of-one teams',
    whatItDoes: [
      'Input: a CRM lead + recent activity notes',
      'AI drafts a tailored follow-up email',
      'Routed to the review queue',
      'Human approves or edits',
      'Sent + logged with a complete trace (input, output, prompt version)',
    ],
    whyItWorks: 'Every company understands sales follow-up. The ROI is obvious. The flow makes the human-in-the-loop loop tangible — drafts, review, send. Audit trail tells you exactly which prompt produced which message.',
    flow: [
      'Trigger from Slack, CLI, or scheduled cron',
      'Draft generated with the configured prompt',
      'Routed to /dashboard/review',
      'Approve → email sent + run logged',
      'Reject → run logged with reason, no message goes out',
    ],
    repoStructure: `vocion-sales-followup/
  context/
    skills/
      draft_email/
        skill.yaml
        prompt.md
    workflows/
      followup_sequence/
        workflow.yaml
  integrations/
    slack.ts            # /draft-followup slash command
    crm-source.ts       # plugin: pulls lead + notes
  README.md`,
    demoFlow: [
      '/draft-followup @lead in Slack',
      'Vocion drafts the email',
      'Posts a preview with Approve / Edit / Reject',
      'Approve → goes out via Gmail',
      'Audit trail visible at /dashboard/review',
    ],
  },
  'support-reply': {
    slug: 'support-reply',
    title: 'Support reply drafting with escalation',
    positioning: 'Draft support replies with AI; require human approval for edge cases',
    whoFor: 'Support, CX, operations',
    whatItDoes: [
      'Input: an inbound support ticket',
      'AI summarizes the issue',
      'AI drafts a reply',
      'Confidence check — low confidence or refund detected → require approval',
      'Approved reply sent; everything logged',
    ],
    whyItWorks: 'High-volume pain point, immediate workload reduction. Shows that Vocion is not just text generation — it handles control flow + human review. Bonus: "Know exactly why the AI responded this way" from the audit trail.',
    flow: [
      'Webhook from your help desk → workflow trigger',
      'summarize_ticket skill runs',
      'draft_reply skill runs with summary as context',
      'If confidence < threshold OR keywords match (refund, legal, escalation): pause for approval',
      'Else: auto-send, still logged',
    ],
    repoStructure: `vocion-support-reply/
  context/
    skills/
      summarize_ticket/
      draft_reply/
    workflows/
      support_triage/
        workflow.yaml
  integrations/
    zendesk-source.ts
    confidence-gate.ts  # plugin: routes high-risk to approval
  README.md`,
    demoFlow: [
      'New ticket arrives via webhook',
      'Workflow summarizes + drafts reply',
      'Low-risk → auto-sent + logged',
      'High-risk → review queue, human edits + approves',
      'Every reply traceable to its prompt version',
    ],
  },
  'weekly-report': {
    slug: 'weekly-report',
    title: 'Weekly business reporting',
    positioning: 'Turn raw data into consistent executive reports with optional approval before distribution',
    whoFor: 'Ops, finance, product, leadership',
    whatItDoes: [
      'Input: raw metrics from your data source (CSV, API, warehouse)',
      'AI generates a structured report following your template',
      'Optional approval step before distribution',
      'Output stored, versioned, and distributed via Slack or email',
    ],
    whyItWorks: 'Replaces recurring manual work. Repeatable, consistent, business-ready. Boring in a good way — it just runs every Monday morning. Each report is versioned so you can compare week-over-week, including which prompt produced it.',
    flow: [
      'Cron trigger (e.g. Sunday 6pm)',
      'Pull metrics from configured sources',
      'Generate report from your prompt template',
      'Optional: route to leadership for approval',
      'Distribute via Slack / email',
      'Archive versioned in object store',
    ],
    repoStructure: `vocion-weekly-report/
  context/
    skills/
      generate_summary/
        skill.yaml
        prompt.md
    workflows/
      weekly_report/
        workflow.yaml
  integrations/
    metrics-source.ts   # warehouse / API connector
    slack-publish.ts
  README.md`,
    demoFlow: [
      'Sunday 6pm cron fires',
      'Pulls last 7d of metrics',
      'Generates structured exec summary',
      'Posted to #leadership Slack channel',
      'Archived in object store; comparable week-over-week',
    ],
  },
};

export async function generateStaticParams() {
  return Object.keys(STARTERS).map(slug => ({ slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const s = STARTERS[slug];
  if (!s) {
    return { title: 'Starter — Vocion' };
  }
  return {
    title: `${s.title} — Vocion starter`,
    description: s.positioning,
  };
}

export default async function StarterDetailPage(props: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const s = STARTERS[slug];
  if (!s) {
    notFound();
  }

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <Link href="/starters" className="text-sm text-muted-foreground hover:text-foreground">
          ← All starter projects
        </Link>

        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{s.title}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{s.positioning}</p>
        <div className="mt-3 font-mono text-sm tracking-wide text-muted-foreground/80 uppercase">
          For:
          {' '}
          {s.whoFor}
        </div>

        <Section title="What it does">
          <ul className="space-y-1.5 text-sm">
            {s.whatItDoes.map(item => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-2 inline-block size-1.5 rounded-full bg-foreground/40" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Why it works">
          <p className="text-sm leading-relaxed text-muted-foreground">{s.whyItWorks}</p>
        </Section>

        <Section title="Flow">
          <ol className="space-y-2 text-sm">
            {s.flow.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/5 font-mono text-xs">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Repo structure">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
            <code>{s.repoStructure}</code>
          </pre>
        </Section>

        <Section title="Demo flow">
          <ol className="space-y-2 text-sm">
            {s.demoFlow.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/5 font-mono text-xs">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Section>

        <div className="mt-12 flex flex-wrap gap-3">
          <a href="https://github.com" target="_blank" rel="noreferrer" className={buttonVariants()}>
            <Github className="mr-2 size-4" />
            View repo
          </a>
          <Link href="/dashboard/docs" className={buttonVariants({ variant: 'outline' })}>
            <BookOpen className="mr-2 size-4" />
            Build your own
          </Link>
          <Link href="/sign-up" className={buttonVariants({ variant: 'ghost' })}>
            Get started
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </div>

        <div className="mt-12 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground">Status:</strong>
          {' '}
          spec only — repo coming soon.
          The structure here reflects how it'll be packaged.
        </div>
      </div>
      <Footer />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
