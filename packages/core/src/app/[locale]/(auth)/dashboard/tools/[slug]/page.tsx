import { ArrowLeft, FileCode2, Wrench } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { liveCredentialName, memberKeyExplanation } from '@/features/tools/keyExplanations';
import { ReadinessBadge } from '@/features/tools/ReadinessBadge';
import { HoldingAgents, ToolDetailView } from '@/features/tools/ToolDetailView';
import { ToolInputFields } from '@/features/tools/ToolInputFields';
import { ToolProviderKeyCard } from '@/features/tools/ToolProviderKeyCard';
import { Link } from '@/libs/I18nNavigation';
import { platformForToolProvider } from '@/libs/platforms/registry';
import { BUILTIN_TOOLS, capabilityStatus } from '@/libs/tools/catalog';
import { catalogToolByName, toolCatalogForOrg } from '@/libs/tools/orgCatalog';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

const CATEGORY_LABELS: Record<string, string> = {
  research: 'Research the web',
  create: 'Create & deliver',
  compute: 'Compute',
};

/**
 * Tool detail — what the tool does, the exact parameters an agent passes
 * when calling it, which agents hold it, and where it comes from.
 *
 * Two kinds of page from one catalog. A built-in also carries its provider
 * and key readiness and, for an admin, the card that stores the workspace's
 * own key. Every other tool an agent holds — a typed filing tool, a source
 * family's read, a REST source's endpoint — resolves through
 * `toolCatalogForOrg`, which used to be a 404.
 * @param props
 * @param props.params
 */
export default async function ToolDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);

  const { orgId, has } = await requireOrganization();
  // Without the paid built-ins' status: resolving one decrypts the org's key
  // for it, and this page asks about one capability at most, below.
  const catalog = await toolCatalogForOrg(orgId, { withStatuses: false });
  const entry = catalogToolByName(catalog, slug);
  const tool = BUILTIN_TOOLS.find(t => t.name === slug);
  if (!tool) {
    if (!entry) {
      notFound();
    }
    return <ToolDetailView tool={entry.tool} family={entry.family} agents={catalog.agents} />;
  }
  // Only this tool's capability: resolving a status decrypts the org's key
  // for it, and the other four are not on this page.
  const status = await capabilityStatus(tool.capability, orgId);
  const isReady = status?.ready ?? true;

  // A provider that bills someone has a credential platform behind it; the
  // builtin extractor and the calculator do not, and get no key card.
  const platform = status ? platformForToolProvider(status.provider) : null;
  // The status already looked the credential up to decide readiness, and it
  // carries the mask back, so the page does not query a second time. The
  // secret itself never reaches the page either way.
  const storedKeyHint = status?.storedKeyHint ?? null;
  const canManageKeys = has({ role: ORG_ROLE.ADMIN });
  // The credential store would not answer, so we do not know whether this
  // workspace holds a key. Everything below that offers to store one is
  // suppressed in that state — see `keyStateUnknown` where it is used.
  const keyStateUnknown = status?.keySource === 'unknown';
  // Only when there is a key to replace, and only for the admin who can
  // replace it — nobody else's view depends on what it is called.
  const storedKeyName = platform && canManageKeys && storedKeyHint !== null
    ? await liveCredentialName(orgId, platform.id)
    : null;
  // A provider that bills someone but has no platform yet — E2B, whose
  // integration is not built — would otherwise sit on "Needs key" with
  // nothing to click and no reason given.
  const perOrgKeysUnsupported = !platform && !isReady;
  // Who holds it, from the same catalog every other tool's page reads.
  const held = entry?.tool ?? { name: tool.name, title: tool.title, description: tool.description, familyId: 'builtin', agents: [], inputSchema: {} };

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
                <ReadinessBadge ready={isReady} keyStateUnknown={keyStateUnknown} />
                {status?.keySource === 'workspace' && (
                  <span className="text-xs text-muted-foreground">On this workspace's key</span>
                )}
                {status?.keySource === 'server' && (
                  <span className="text-xs text-muted-foreground">On the Vocion server key</span>
                )}
                <span className="font-mono text-xs text-muted-foreground">{tool.name}</span>
                <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[tool.category] ?? tool.category}</Badge>
              </div>
            </div>
          </div>
        )}
        description={tool.description}
      />

      {platform && keyStateUnknown && (
        <p className="mb-6 rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
          This workspace's
          {' '}
          {platform.label}
          {' '}
          key could not be read just now, so there is nothing reliable to show
          about it — and saving a new one is held back on purpose. Replacing a
          key revokes whatever is on file, and doing that without being able to
          see what is there is how a working credential disappears. Try again
          in a moment.
        </p>
      )}

      {platform && canManageKeys && !keyStateUnknown && (
        <div className="mb-6">
          <ToolProviderKeyCard
            platformId={platform.id}
            platformLabel={platform.label}
            helpText={platform.helpText}
            fields={platform.fields.map(field => ({
              name: field.name,
              label: field.label,
              shapeHint: field.shapeHint,
              secret: field.secret,
            }))}
            storedKeyHint={storedKeyHint}
            storedKeyName={storedKeyName}
            serverHasKey={status?.keySource === 'server'}
            sharedWithModelCalls={platform.llmProvider !== null}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            This key is spent by
            {' '}
            <code className="font-mono">{status?.provider}</code>
            , the provider this deployment runs for
            {' '}
            <code className="font-mono">{tool.capability}</code>
            . A key for a different provider has no effect until the deployment switches to it.
          </p>
        </div>
      )}

      {platform && !canManageKeys && !keyStateUnknown && (
        <p className="mb-6 rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
          {memberKeyExplanation(platform.label, storedKeyHint !== null, status?.keySource === 'server')}
        </p>
      )}

      {perOrgKeysUnsupported && (
        <p className="mb-6 rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
          This provider cannot take a per-workspace key yet — its integration is not built.
          {(status?.missingEnv.length ?? 0) > 0 && (
            <>
              {' '}
              Until it is, the capability runs only when the server sets
              {' '}
              <code className="font-mono">{status?.missingEnv.join(', ')}</code>
              .
            </>
          )}
        </p>
      )}

      <section className="mb-6 rounded-md border border-border p-5">
        <h2 className="mb-3 text-base font-semibold">Parameters</h2>
        <ToolInputFields fields={tool.params} />
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <HoldingAgents tool={held} agents={catalog.agents} />

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
