import { Check, TriangleAlert, Wrench } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { BUILTIN_TOOLS, capabilityStatuses } from '@/libs/tools/catalog';

const CATEGORY_LABELS: Record<string, string> = {
  research: 'Research the web',
  create: 'Create & deliver',
  compute: 'Compute',
};

export default async function ToolsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  const statuses = capabilityStatuses();
  const statusByCapability = new Map(statuses.map(s => [s.capability, s]));
  const ready = statuses.filter(s => s.ready).length;

  const categories = ['research', 'create', 'compute'] as const;

  return (
    <>
      <TitleBar
        title="Tools"
        description="Built-in capabilities every agent can use out of the box — live web search, browsing, image generation, calculation, and artifacts. Providers are pluggable via env."
      />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Built-in tools" value={BUILTIN_TOOLS.length} />
        <Stat label="Capabilities ready" value={ready} />
        <Stat label="Need a key" value={statuses.length - ready} />
      </div>

      <div className="flex flex-col gap-8">
        {categories.map((cat) => {
          const tools = BUILTIN_TOOLS.filter(t => t.category === cat);
          if (tools.length === 0) {
            return null;
          }
          return (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {CATEGORY_LABELS[cat]}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => {
                  const status = statusByCapability.get(tool.capability);
                  const isReady = status?.ready ?? true;
                  return (
                    <div key={tool.name} className="rounded-lg border border-border bg-background p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Wrench className="size-4 text-primary" />
                        <span className="text-sm font-medium">{tool.title}</span>
                        <span className="ml-auto">
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
                        </span>
                      </div>
                      <div className="mb-2 font-mono text-[11px] text-muted-foreground">{tool.name}</div>
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>
                          provider:
                          {' '}
                          <span className="font-mono">{status?.provider ?? 'builtin'}</span>
                        </span>
                        {!isReady && status?.missingEnv.length
                          ? (
                              <>
                                <span>·</span>
                                <span className="font-mono text-amber-600 dark:text-amber-400">
                                  set
                                  {status.missingEnv.join(', ')}
                                </span>
                              </>
                            )
                          : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
