import type { AuditFinding } from '@/services/seo/audit';
import type { SeoAuditRecord } from '@/services/seo/audits';
import type { SeoProfile } from '@/services/seo/profile';
import { ArrowUpRight, CheckCircle2, FileText, ListChecks } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { auditCounts, CATEGORY_LABEL, fixHref, workOrder } from '@/services/seo/audit';

export type AuditLinkedWork = { kind: 'task' | 'page'; id: number; title: string; status: string | null; href: string };

function urlsOf(f: AuditFinding): string[] {
  return [...new Set([...(f.url ? [f.url] : []), ...(f.urls ?? [])])];
}

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function safeUrl(url: string): string | undefined {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function scopeOf(f: AuditFinding): string {
  const urls = urlsOf(f);
  return urls.length === 1 ? pageLabel(urls[0]!) : urls.length > 1 ? `${pageLabel(urls[0]!)} + ${urls.length - 1} other recorded URLs` : 'Site or project check';
}

/**
 * Work status is loaded from the linked record; a link alone never means fixed.
 * @param root0
 * @param root0.audit
 * @param root0.profile
 * @param root0.linkedWork
 */
export function SeoAuditWorkView({ audit, profile, linkedWork }: { audit: SeoAuditRecord; profile?: SeoProfile; linkedWork: AuditLinkedWork[] }) {
  const m = audit.meta;
  const counts = auditCounts(m.findings);
  const ranked = workOrder(m.findings, profile);
  const ordered = [...ranked, ...m.findings.filter(f => f.status !== 'open')];
  const tasks = linkedWork.filter(w => w.kind === 'task');
  const pages = linkedWork.filter(w => w.kind === 'page');
  const workFor = (f: AuditFinding) => f.fix ? linkedWork.find(w => w.kind === f.fix!.kind && w.id === f.fix!.id) : undefined;
  const stats = [
    { label: 'Open finding groups', value: counts.open },
    { label: 'High-priority groups', value: counts.high },
    { label: 'Linked tasks', value: tasks.length },
    { label: 'Pages read', value: m.pagesRead },
  ];
  return (
    <div className="space-y-7" data-testid="seo-audit-workspace">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {`Checked ${m.checkedAt.slice(0, 16).replace('T', ' ')} UTC · ${m.site}`}
          </p>
          <div className="flex flex-wrap gap-3 text-sm font-medium">
            {m.reportArtifactId && (
              <Link href={`/dashboard/artifacts/${m.reportArtifactId}`} className="inline-flex items-center gap-1">
                Report snapshot
                <FileText className="size-4" aria-hidden />
              </Link>
            )}
            {m.inventoryArtifactId && <Link href={`/dashboard/artifacts/${m.inventoryArtifactId}`}>Site inventory</Link>}
            <Link href={`/dashboard/projects/${m.projectId}`}>
              Client project
              <ArrowUpRight className="inline size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map(stat => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="mt-1 text-3xl font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          A finding group is one check and its recorded affected scope, not a task or a count of affected pages. Creating a task or page does not resolve the finding.
          {' '}
          {m.listed && m.listed > m.pagesRead ? `${m.listed} pages were listed; ${m.pagesRead} were read. ` : ''}
          The report is the saved snapshot; finding status below reflects the current audit record.
        </p>
      </section>

      {ranked.length > 0 && (
        <section aria-label="Recommended next steps">
          <h2 className="text-lg font-semibold">Work on these next</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open groups ranked by severity
            {profile ? ' and the client’s current SEO priorities' : ''}
            . Follow linked work before creating another task.
          </p>
          <ol className="mt-3 divide-y divide-border rounded-xl border border-border">
            {ranked.slice(0, 5).map((f, i) => (
              <li key={f.key} className="flex gap-3 p-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <a href={`#finding-${encodeURIComponent(f.key)}`} className="font-medium hover:underline">{f.title}</a>
                  <p className="mt-1 text-xs break-words text-muted-foreground">
                    {scopeOf(f)}
                    {' '}
                    ·
                    {' '}
                    {CATEGORY_LABEL[f.category]}
                    {' '}
                    ·
                    {' '}
                    {f.severity}
                    {' '}
                    priority
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{f.evidence}</p>
                  {workFor(f) && (
                    <Link className="mt-2 inline-block text-sm font-medium" href={workFor(f)!.href}>
                      {`Continue ${workFor(f)!.kind}: ${workFor(f)!.title}`}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-label="Audit findings">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Findings and evidence</h2>
          <span className="text-xs text-muted-foreground">
            {counts.fixed}
            {' '}
            fixed ·
            {' '}
            {counts.dismissed}
            {' '}
            dismissed
          </span>
        </div>
        {ordered.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No findings were recorded for the checks this audit ran.</p>}
        <div className="mt-3 space-y-3">
          {ordered.map((f) => {
            const work = workFor(f);
            const urls = urlsOf(f);
            return (
              <article key={f.key} id={`finding-${encodeURIComponent(f.key)}`} className="scroll-mt-24 rounded-xl border border-border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABEL[f.category]}
                      {' '}
                      ·
                      {' '}
                      {f.severity}
                      {' '}
                      priority
                    </p>
                    <h3 className="mt-1 font-semibold">{f.title}</h3>
                    <p className="mt-1 text-xs break-words text-muted-foreground">{scopeOf(f)}</p>
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize">{f.status}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{f.evidence}</p>
                {urls.length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      {`Affected scope · ${urls.length} recorded ${urls.length === 1 ? 'URL' : 'URLs'}`}
                    </summary>
                    <ul className="mt-2 space-y-1">{urls.map(url => <li key={url} className="break-all">{safeUrl(url) ? <a className="underline underline-offset-2" href={safeUrl(url)} target="_blank" rel="noopener noreferrer">{pageLabel(url)}</a> : pageLabel(url)}</li>)}</ul>
                    <p className="mt-2 text-xs text-muted-foreground">Recorded URL samples may be capped; the evidence describes the check’s full reported scope.</p>
                  </details>
                )}
                {f.statusNote && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {`Status note: ${f.statusNote}`}
                    {f.statusAt ? ` · ${f.statusAt.slice(0, 10)}` : ''}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
                  {work
                    ? (
                        <>
                          <Link href={work.href} className="inline-flex items-center gap-1.5 font-medium">
                            <ListChecks className="size-4" aria-hidden />
                            {`${work.kind === 'task' ? 'Open task' : 'Open planned page'}: ${work.title}`}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {`Recorded ${work.kind} status: ${work.status ?? 'not recorded'}`}
                          </span>
                        </>
                      )
                    : f.fix
                      ? (
                          <span className="text-muted-foreground">
                            {`Linked ${f.fix.kind} is unavailable in this workspace.`}
                          </span>
                        )
                      : f.status === 'open'
                        ? (
                            <Link href={fixHref(audit.id, f)} className="inline-flex items-center gap-1.5 font-medium">
                              Plan a fix
                              <ArrowUpRight className="size-4" aria-hidden />
                            </Link>
                          )
                        : (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <CheckCircle2 className="size-4" aria-hidden />
                              {f.status === 'fixed' ? 'Recorded as fixed' : 'Dismissed with the recorded decision'}
                            </span>
                          )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {pages.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {pages.length}
          {' '}
          linked planned
          {' '}
          {pages.length === 1 ? 'page' : 'pages'}
          . Page progress and finding resolution are tracked separately.
        </p>
      )}
    </div>
  );
}
