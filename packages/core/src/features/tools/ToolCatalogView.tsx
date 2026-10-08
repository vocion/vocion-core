import type { CatalogTool, OrgToolCatalog, RestActionEntry, ToolFamily } from '@/libs/tools/orgCatalog';
import { Bot, Wrench } from 'lucide-react';
import { IntegrationLogo } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/libs/I18nNavigation';
import { ReadinessBadge } from './ReadinessBadge';

/**
 * Whose key each capability spends, in the words a workspace admin would use.
 * `none` covers both "needs no key" and "nobody has one", which the readiness
 * badge on the same card tells apart, so it says nothing rather than guessing.
 */
const KEY_SOURCE_LABELS: Record<string, string> = {
  workspace: 'On this workspace\'s key',
  server: 'On the Vocion server key',
  unknown: 'Could not check this workspace\'s key',
  none: '',
};

/**
 * How many agents hold a tool, as a short phrase, or nothing when none does.
 * @param agents
 */
function holders(agents: readonly string[]): string {
  if (agents.length === 0) {
    return 'no agent yet';
  }
  return agents.length === 1 ? `1 agent` : `${agents.length} agents`;
}

/**
 * One tool as a card — the one shape every family uses. A built-in carries
 * its provider/key readiness; a REST read carries its method and path;
 * everything shows its name, who holds it and what it does.
 * @param props
 * @param props.tool
 */
function ToolCard({ tool }: { tool: CatalogTool }) {
  const status = tool.status;
  const keySourceLabel = status ? KEY_SOURCE_LABELS[status.keySource] ?? '' : '';
  return (
    <Link
      href={`/dashboard/tools/${tool.name}`}
      className="block rounded-lg border border-border bg-background p-4 transition hover:border-primary/30 hover:bg-muted/40"
      data-testid={`tool-card-${tool.name}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Wrench className="size-4 text-primary" />
        <span className="text-sm font-medium">{tool.title}</span>
        {status && (
          <span className="ml-auto">
            <ReadinessBadge ready={status.ready} keyStateUnknown={status.keySource === 'unknown'} />
          </span>
        )}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{tool.name}</span>
        <span>
          ·
          {' '}
          {holders(tool.agents)}
        </span>
        {keySourceLabel !== '' && (
          <span>
            ·
            {' '}
            {keySourceLabel}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{tool.description || 'No description declared.'}</p>
      {(status || tool.rest) && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          {tool.rest && (
            <span className="font-mono">
              {tool.rest.method}
              {' '}
              {tool.rest.path}
            </span>
          )}
          {status && (
            <span className="inline-flex items-center gap-1">
              provider:
              <IntegrationLogo brand={tool.providerBrand} name={status.provider} size="xs" markOnly />
              <span className="font-mono">{status.provider}</span>
            </span>
          )}
          {status && !status.ready && status.missingEnv.length > 0 && (
            <>
              <span>·</span>
              <span className="font-mono text-amber-600 dark:text-amber-400">
                set
                {' '}
                {status.missingEnv.join(', ')}
              </span>
            </>
          )}
        </div>
      )}
    </Link>
  );
}

/**
 * The writes a REST source's agents may propose through `rest.request` —
 * the second block under a source, after its reads. Not tools: an agent
 * reaches them only through a proposal, so they are rows, not cards.
 * @param props
 * @param props.actions
 */
function RestActions({ actions }: { actions: RestActionEntry[] }) {
  return (
    <div className="mt-4" data-testid="rest-actions">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">
        Writes, through
        {' '}
        <code className="font-mono">rest.request</code>
      </h3>
      <p className="mb-2 text-[11px] text-muted-foreground">
        An agent proposes one; it lands on the review queue and the trust ladder decides whether a person approves it.
      </p>
      <div className="divide-y divide-border/70 rounded-lg border border-border">
        {actions.map(action => (
          <div key={action.name} className="flex items-start gap-3 px-3 py-2.5 text-xs">
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
    </div>
  );
}

/**
 * What a family says when its tools would refuse every call, or when no
 * agent can reach them yet. Each names the fix and links to it.
 * @param props
 * @param props.family
 */
function FamilyNotice({ family }: { family: ToolFamily }) {
  const noCredential = family.readiness !== null && !family.readiness.ready && !family.readiness.keyStateUnknown && family.sources.length > 0;
  const unheld = family.kind !== 'builtin' && family.tools.length > 0 && family.tools.every(t => t.agents.length === 0);
  if (!noCredential && !unheld) {
    return null;
  }
  return (
    <div className="mb-3 flex flex-col gap-2">
      {noCredential && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground" data-testid="family-needs-credential">
          {family.label}
          {' '}
          is set up as a source but has no credential connected, so these tools would refuse every call.
          {' '}
          <Link href="/dashboard/connectors" className="font-medium text-primary hover:underline">Connect it on the Connectors page →</Link>
        </p>
      )}
      {unheld && (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground" data-testid="family-unheld">
          No agent holds
          {' '}
          {family.sources.length > 0 ? family.sources.map(s => <code key={s.slug} className="font-mono">{s.slug}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), []) : 'this source'}
          {' '}
          yet. Name it under an agent's
          {' '}
          <code className="font-mono">connectorSources</code>
          {' '}
          and apply the workspace.
          {' '}
          <Link href="/dashboard/agents" className="font-medium text-primary hover:underline">See the agents →</Link>
        </p>
      )}
    </div>
  );
}

/**
 * One family of tools: a heading with its readiness, what it is, its cards,
 * and for a REST source the writes beneath the reads.
 * @param props
 * @param props.family
 */
function FamilySection({ family }: { family: ToolFamily }) {
  return (
    <section data-testid={`tool-family-${family.id}`}>
      <div className="mb-1 flex items-center gap-2">
        <IntegrationLogo brand={family.brand} name={family.label} size="xs" markOnly />
        <h2 className="text-xs font-medium text-muted-foreground">{family.label}</h2>
        {family.readiness && <ReadinessBadge ready={family.readiness.ready} keyStateUnknown={family.readiness.keyStateUnknown} />}
        {family.sources.length > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {family.sources.map(s => s.slug).join(', ')}
          </span>
        )}
      </div>
      <p className="mb-3 max-w-2xl text-xs text-muted-foreground">{family.description}</p>
      <FamilyNotice family={family} />
      {family.tools.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {family.tools.map(tool => <ToolCard key={tool.name} tool={tool} />)}
        </div>
      )}
      {family.actions.length > 0 && <RestActions actions={family.actions} />}
    </section>
  );
}

/**
 * The workspace's own tools — search, records, artifacts, asks, learning —
 * which every agent has and nobody configures. Folded by default: sixty
 * names a person never wires are the truth, not the daily path.
 * @param props
 * @param props.family
 */
function WorkspaceSection({ family }: { family: ToolFamily }) {
  return (
    <details className="group" data-testid="tool-family-workspace">
      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
        <span className="mr-1 inline-block transition group-open:rotate-90">▸</span>
        {family.label}
        {' '}
        tools every agent has (
        {family.tools.length}
        )
      </summary>
      <p className="mt-1 mb-3 max-w-2xl text-xs text-muted-foreground">{family.description}</p>
      <div className="divide-y divide-border/70 rounded-lg border border-border">
        {family.tools.map(tool => (
          <Link key={tool.name} href={`/dashboard/tools/${tool.name}`} className="flex items-start gap-3 px-3 py-2 text-xs hover:bg-muted/40">
            <code className="w-56 shrink-0 truncate font-mono text-primary">{tool.name}</code>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{tool.description}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{holders(tool.agents)}</span>
          </Link>
        ))}
      </div>
    </details>
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

/**
 * The Tools page's body: the workspace's tool catalog grouped by family —
 * built-ins first, then the records tools, then each connected source (a
 * REST source shows its reads and, beneath them, its writes), the
 * workspace's own tools folded at the end.
 * @param props
 * @param props.catalog - From `toolCatalogForOrg`.
 */
export function ToolCatalogView({ catalog }: { catalog: OrgToolCatalog }) {
  const families = catalog.families.filter(f => f.kind !== 'workspace');
  const workspace = catalog.families.find(f => f.kind === 'workspace');
  const toolCount = catalog.families.reduce((n, f) => n + f.tools.length, 0);
  const ready = catalog.statuses.filter(s => s.ready).length + families.filter(f => f.readiness?.ready).length;
  const needKey = catalog.statuses.filter(s => !s.ready && s.keySource !== 'unknown').length + families.filter(f => f.readiness && !f.readiness.ready && !f.readiness.keyStateUnknown).length;
  return (
    <>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Tools agents can reach" value={toolCount} />
        <Stat label="Ready" value={ready} />
        <Stat label="Need a key" value={needKey} />
      </div>

      <div className="flex flex-col gap-8">
        {families.map(family => <FamilySection key={family.id} family={family} />)}
        {workspace && <WorkspaceSection family={workspace} />}
        {catalog.agents.length === 0 && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="no-agents">
            <Bot className="size-3.5" />
            This workspace has no agents yet, so nothing holds these tools. Apply a workspace with an agent to see who gets what.
          </p>
        )}
      </div>
    </>
  );
}
