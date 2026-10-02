import type { CatalogAgent, CatalogTool, RestActionEntry, ToolFamily } from '@/libs/tools/orgCatalog';
import { ArrowLeft, Bot, Globe, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { fieldsFromInputSchema } from './inputFields';
import { ReadinessBadge } from './ReadinessBadge';
import { ToolInputFields } from './ToolInputFields';

/**
 * Which agents hold a tool, each a link to its page — the same block on a
 * built-in's page and on every other tool's.
 * @param props
 * @param props.tool
 * @param props.agents - The workspace's agents, for their names.
 */
export function HoldingAgents({ tool, agents }: { tool: CatalogTool; agents: CatalogAgent[] }) {
  const nameOf = new Map(agents.map(a => [a.slug, a.name]));
  return (
    <section className="rounded-md border border-border p-5" data-testid="holding-agents">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
        <Bot className="size-4 text-primary" />
        Available to
      </h2>
      {tool.agents.length === 0
        ? (
            <p className="text-sm text-muted-foreground">
              No agent holds
              {' '}
              <code className="font-mono text-xs">{tool.name}</code>
              {' '}
              yet.
              {tool.rest
                ? (
                    <>
                      {' '}
                      Name
                      {' '}
                      <code className="font-mono text-xs">{tool.rest.sourceSlug}</code>
                      {' '}
                      under an agent's
                      {' '}
                      <code className="font-mono text-xs">connectorSources</code>
                      {' '}
                      and apply the workspace.
                    </>
                  )
                : ' It is excluded, or gated by a source or a grant no agent has.'}
            </p>
          )
        : (
            <ul className="flex flex-wrap gap-2">
              {tool.agents.map(slug => (
                <li key={slug}>
                  <Link href={`/dashboard/agents/${slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted/40">
                    <Bot className="size-3 text-muted-foreground" />
                    {nameOf.get(slug) ?? slug}
                  </Link>
                </li>
              ))}
            </ul>
          )}
      <Link href="/dashboard/agents" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
        View agents →
      </Link>
    </section>
  );
}

/**
 * The endpoint behind a REST read: method and path, the query template,
 * and what is picked out of the answer.
 * @param props
 * @param props.tool
 */
function RestEndpoint({ tool }: { tool: CatalogTool }) {
  const rest = tool.rest!;
  const query = Object.entries(rest.query);
  return (
    <section className="mb-6 rounded-md border border-border p-5" data-testid="rest-endpoint">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Globe className="size-4 text-primary" />
        Endpoint
      </h2>
      <div className="mb-3 font-mono text-sm">
        <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{rest.method}</span>
        {' '}
        {rest.path}
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">Source</dt>
        <dd>
          {rest.sourceName}
          {' '}
          <code className="font-mono text-[11px] text-muted-foreground">{rest.sourceSlug}</code>
        </dd>
        <dt className="text-muted-foreground">Query</dt>
        <dd>
          {query.length === 0
            ? <span className="text-muted-foreground">none</span>
            : (
                <div className="flex flex-col gap-1 font-mono text-[11px]">
                  {query.map(([name, template]) => (
                    <div key={name}>
                      {name}
                      <span className="text-muted-foreground"> = </span>
                      {template}
                    </div>
                  ))}
                </div>
              )}
        </dd>
        {rest.pick && (
          <>
            <dt className="text-muted-foreground">Returns</dt>
            <dd>
              <code className="font-mono text-[11px]">{rest.pick}</code>
              {' '}
              out of the answer
            </dd>
          </>
        )}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Path segments in braces come from the arguments; a query parameter whose template resolves to nothing is left out. Built-in dates such as
        {' '}
        <code className="font-mono">{'{$today}'}</code>
        {' '}
        resolve on the server in the workspace's zone.
      </p>
    </section>
  );
}

/**
 * The writes a `list_actions` tool reports — the source's action catalog.
 * @param props
 * @param props.actions
 */
function RestActionCatalog({ actions }: { actions: RestActionEntry[] }) {
  return (
    <section className="mb-6 rounded-md border border-border p-5" data-testid="rest-action-catalog">
      <h2 className="mb-3 text-base font-semibold">Actions this tool lists</h2>
      {actions.length === 0
        ? <p className="text-sm text-muted-foreground">The source declares no writes yet.</p>
        : (
            <div className="flex flex-col">
              {actions.map(action => (
                <div key={action.name} className="flex items-start gap-3 border-b border-border py-2.5 text-xs last:border-0">
                  <code className="shrink-0 rounded bg-primary/10 px-2 py-0.5 font-mono text-primary">{action.name}</code>
                  <div className="min-w-0 flex-1">
                    <div>{action.description}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {action.method}
                      {' '}
                      {action.path}
                    </div>
                  </div>
                  {!action.reversible && <Badge variant="outline" className="shrink-0 text-[10px]">Irreversible</Badge>}
                </div>
              ))}
            </div>
          )}
    </section>
  );
}

/**
 * A tool's own page for everything that is not one of the six built-ins:
 * what it does, which family it comes from, who holds it, and — for a REST
 * read — the endpoint behind it and its arguments as a field table.
 * @param props
 * @param props.tool
 * @param props.family
 * @param props.agents - The workspace's agents, for their names.
 */
export function ToolDetailView({ tool, family, agents }: { tool: CatalogTool; family: ToolFamily; agents: CatalogAgent[] }) {
  const fields = fieldsFromInputSchema(tool.rest?.input ?? tool.inputSchema);
  const isListActions = family.kind === 'rest' && !tool.rest;
  return (
    <>
      <div className="mb-4">
        <Link href="/dashboard/tools" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-normal">
                {family.readiness && <ReadinessBadge ready={family.readiness.ready} keyStateUnknown={family.readiness.keyStateUnknown} />}
                <span className="font-mono text-xs text-muted-foreground">{tool.name}</span>
                <Badge variant="outline" className="text-[10px]">{family.label}</Badge>
              </div>
            </div>
          </div>
        )}
        description={tool.description || 'No description declared.'}
      />

      {family.readiness && !family.readiness.ready && !family.readiness.keyStateUnknown && (
        <p className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-muted-foreground" data-testid="needs-credential">
          {family.label}
          {' '}
          has no credential connected, so this tool would refuse every call.
          {' '}
          <Link href="/dashboard/connectors" className="font-medium text-primary hover:underline">Connect it on the Connectors page →</Link>
        </p>
      )}

      {tool.rest && <RestEndpoint tool={tool} />}
      {isListActions && <RestActionCatalog actions={family.actions} />}

      <section className="mb-6 rounded-md border border-border p-5">
        <h2 className="mb-3 text-base font-semibold">Parameters</h2>
        <ToolInputFields fields={fields} />
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <HoldingAgents tool={tool} agents={agents} />
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 text-base font-semibold">Where it comes from</h2>
          <p className="text-sm text-muted-foreground">{family.description}</p>
          {family.sources.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Source
              {family.sources.length === 1 ? '' : 's'}
              :
              {' '}
              {family.sources.map(s => s.name).join(', ')}
              {' '}
              ·
              {' '}
              <Link href="/dashboard/connectors" className="font-medium text-primary hover:underline">Connectors →</Link>
            </p>
          )}
        </section>
      </div>
    </>
  );
}
