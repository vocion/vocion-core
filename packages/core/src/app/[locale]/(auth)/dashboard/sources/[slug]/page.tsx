import { and, count, eq } from 'drizzle-orm';
import { ArrowLeft, CalendarClock, Database, FileText, Plug, RefreshCw } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { PrimitiveFiles } from '@/features/dashboard/PrimitiveFiles';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { getConnector } from '@/libs/sources/registry';
import { getWorkspaceDirtyState } from '@/libs/workspace/dirty';
import { readPrimitiveFiles } from '@/libs/workspace/reader';
import {
  knowledgeDocumentSchema,
  knowledgeSourceSchema,
  sourceSyncCheckpointSchema,
} from '@/models/Schema';

/** Config keys that smell like credentials never render in the clear. */
const SECRET_KEY_RE = /token|secret|password|key|credential|auth/i;

/**
 * Deep-redact a config blob: any leaf whose key looks secret renders as
 * bullets. Objects/arrays are walked; non-secret leaves pass through.
 * @param value
 */
function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(v => redactConfig(v));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        SECRET_KEY_RE.test(k) && (typeof v === 'string' || typeof v === 'number')
          ? [k, '•••']
          : [k, redactConfig(v)],
      ),
    );
  }
  return value;
}

/**
 * Source detail — the connector behind a knowledge source: kind + config
 * (secrets redacted), sync state (last sync, checkpoint, schedule), and
 * how many documents it has fed into retrieval. Backing workspace files
 * render at the bottom when present.
 * @param props
 * @param props.params
 */
export default async function SourceDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const [source] = await db
    .select()
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, slug)));
  if (!source) {
    notFound();
  }

  const [[docCount], [checkpoint]] = await Promise.all([
    db
      .select({ value: count() })
      .from(knowledgeDocumentSchema)
      .where(and(eq(knowledgeDocumentSchema.orgId, orgId), eq(knowledgeDocumentSchema.sourceId, source.id))),
    db
      .select()
      .from(sourceSyncCheckpointSchema)
      .where(and(eq(sourceSyncCheckpointSchema.orgId, orgId), eq(sourceSyncCheckpointSchema.sourceId, source.id))),
  ]);

  const config = source.configJson ?? {};
  const connectorSlug = (config._connector as string | undefined) ?? source.slug;
  const connector = getConnector(connectorSlug);
  const schedule = typeof config.schedule === 'string' ? config.schedule : null;
  const redacted = redactConfig(config);
  const sourceFiles = readPrimitiveFiles('source', slug);
  const dirtyState = getWorkspaceDirtyState();
  const documents = docCount?.value ?? 0;

  const fmt = (d: Date | null | undefined) =>
    d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/sources"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Sources
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="size-5" aria-hidden />
            </div>
            <div>
              <div>{source.slug}</div>
              <div className="mt-0.5 flex items-center gap-2 text-sm font-normal">
                <StatusPill status={source.enabled === 'true' ? 'active' : 'inactive'} size="sm" />
                <Badge variant="outline" className="font-mono text-[10px]">{source.kind}</Badge>
                {connector && <Badge variant="outline" className="text-[10px]">{connector.name}</Badge>}
              </div>
            </div>
          </div>
        )}
        description={connector?.description ?? `${source.kind} source`}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Plug className="size-4 text-primary" />
            Connector
          </h2>
          <dl className="space-y-1.5 text-sm">
            <div>
              <dt className="inline text-muted-foreground">Kind: </dt>
              <dd className="inline font-mono text-xs">{connectorSlug}</dd>
            </div>
            {connector && (
              <div>
                <dt className="inline text-muted-foreground">Auth: </dt>
                <dd className="inline">{connector.authKind === 'none' ? 'None required' : connector.authKind === 'oauth' ? 'OAuth' : 'API key'}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-muted-foreground">Documents ingested: </dt>
              <dd className="inline font-medium">{documents.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Added: </dt>
              <dd className="inline">{fmt(source.createdAt) ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-border p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <RefreshCw className="size-4 text-primary" />
            Sync
          </h2>
          <dl className="space-y-1.5 text-sm">
            <div>
              <dt className="inline text-muted-foreground">Last synced: </dt>
              <dd className="inline">{fmt(source.lastSyncedAt) ?? 'never'}</dd>
            </div>
            {schedule && (
              <div>
                <dt className="inline text-muted-foreground">Schedule: </dt>
                <dd className="inline">
                  <span className="inline-flex items-center gap-1" title={schedule}>
                    <CalendarClock className="size-3.5 text-muted-foreground" />
                    {cronToText(schedule)}
                  </span>
                </dd>
              </div>
            )}
            {checkpoint
              ? (
                  <>
                    <div>
                      <dt className="inline text-muted-foreground">Checkpoint: </dt>
                      <dd className="inline">
                        <Badge variant="outline" className="text-[10px]">{checkpoint.status}</Badge>
                        {' '}
                        started
                        {' '}
                        {fmt(checkpoint.startedAt)}
                        {checkpoint.completedAt ? ` · completed ${fmt(checkpoint.completedAt)}` : ''}
                      </dd>
                    </div>
                    {checkpoint.since && (
                      <div>
                        <dt className="inline text-muted-foreground">Incremental watermark: </dt>
                        <dd className="inline">{fmt(checkpoint.since)}</dd>
                      </div>
                    )}
                    {Object.keys(checkpoint.counts ?? {}).length > 0 && (
                      <div>
                        <dt className="inline text-muted-foreground">Counts: </dt>
                        <dd className="inline font-mono text-xs">
                          {Object.entries(checkpoint.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </dd>
                      </div>
                    )}
                    {checkpoint.error && (
                      <div className="text-destructive">
                        <dt className="inline">Error: </dt>
                        <dd className="inline">{checkpoint.error}</dd>
                      </div>
                    )}
                  </>
                )
              : (
                  <p className="text-xs text-muted-foreground">No sync checkpoint yet — the first sync writes one.</p>
                )}
          </dl>
        </section>
      </div>

      <section className="mb-6 rounded-md border border-border p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <FileText className="size-4 text-primary" />
          Configuration
        </h2>
        <pre className="overflow-x-auto rounded-md bg-muted/40 p-4 font-mono text-xs leading-relaxed">{JSON.stringify(redacted, null, 2)}</pre>
        <p className="mt-2 text-[11px] text-muted-foreground">Values under credential-looking keys are redacted. Stored credentials never leave the server.</p>
      </section>

      {sourceFiles && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Source files</h2>
          <PrimitiveFiles
            files={sourceFiles.files}
            editInGitPath={sourceFiles.editInGitPath}
            dirty={dirtyState.dirty}
            dirtyFiles={dirtyState.changedFiles}
          />
        </section>
      )}
    </>
  );
}
