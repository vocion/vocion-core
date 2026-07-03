import { ArrowLeft, Bot, Check, FileCode2, TriangleAlert, Wrench } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { BUILTIN_TOOLS, capabilityStatuses } from '@/libs/tools/catalog';

const CATEGORY_LABELS: Record<string, string> = {
  research: 'Research the web',
  create: 'Create & deliver',
  compute: 'Compute',
};

/**
 * Tool detail — what the tool does, the exact parameters an agent passes
 * when calling it, provider/key readiness, and where the implementation
 * lives. Tools are built in: every agent can call every one of them,
 * no wiring required.
 * @param props
 * @param props.params
 */
export default async function ToolDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);

  const tool = BUILTIN_TOOLS.find(t => t.name === slug);
  if (!tool) {
    notFound();
  }
  const status = capabilityStatuses().find(s => s.capability === tool.capability);
  const isReady = status?.ready ?? true;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/tools"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Tools
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wrench className="size-5" aria-hidden />
            </div>
            <div>
              <div>{tool.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-sm font-normal">
                {isReady
                  ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="size-3" />
                        Ready
                      </span>
                    )
                  : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        <TriangleAlert className="size-3" />
                        Needs key
                      </span>
                    )}
                <span className="font-mono text-xs text-muted-foreground">{tool.name}</span>
                <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[tool.category] ?? tool.category}</Badge>
              </div>
            </div>
          </div>
        )}
        description={tool.description}
      />

      <section className="mb-6 rounded-md border border-border p-5">
        <h2 className="mb-3 text-base font-semibold">Parameters</h2>
        {tool.params.length === 0
          ? <p className="text-sm text-muted-foreground">This tool takes no parameters.</p>
          : (
              <div className="flex flex-col">
                {tool.params.map(p => (
                  <div key={p.name} className="flex items-start gap-3 border-b border-border py-2.5 last:border-0">
                    <code className="shrink-0 rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">{p.name}</code>
                    <div className="min-w-0 flex-1 text-xs">
                      <div>{p.description}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {p.type}
                        {p.required && <span className="ml-1.5 font-sans">· required</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Bot className="size-4 text-primary" />
            Available to
          </h2>
          <p className="text-sm text-muted-foreground">
            All agents — built-in tools ship with the runtime, so every agent can call
            {' '}
            <code className="font-mono text-xs">{tool.name}</code>
            {' '}
            out of the box. No per-agent wiring required.
          </p>
          <Link href="/dashboard/agents" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            View agents →
          </Link>
        </section>

        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <FileCode2 className="size-4 text-primary" />
            Implementation
          </h2>
          <div className="space-y-1.5 text-sm">
            <div>
              <span className="text-muted-foreground">Source: </span>
              <code className="font-mono text-xs">{tool.sourceFile}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Provider: </span>
              <code className="font-mono text-xs">{status?.provider ?? 'builtin'}</code>
            </div>
            {!isReady && status?.missingEnv.length
              ? (
                  <div className="text-amber-600 dark:text-amber-400">
                    <span>Set </span>
                    <code className="font-mono text-xs">{status.missingEnv.join(', ')}</code>
                    <span> to enable this capability.</span>
                  </div>
                )
              : null}
          </div>
        </section>
      </div>
    </>
  );
}
