import type { SeoReadiness } from '@/services/seo/readiness';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';

/**
 * The prerequisites and evidence gaps that affect client delivery.
 * @param root0
 * @param root0.readiness
 */
export function SeoReadinessPanel({ readiness }: { readiness: SeoReadiness }) {
  const gaps = readiness.checks.filter(c => c.state !== 'ready');
  return (
    <section className="rounded-xl border border-border p-5" aria-label="Client readiness">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Client readiness</h2>
        <span className="text-xs text-muted-foreground">{gaps.length ? `${gaps.length} gaps to address` : 'Recorded prerequisites in place'}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Plan with the evidence available. Missing access or a baseline stays visible until resolved.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {readiness.checks.map(c => (
          <div key={c.id} className="flex gap-3">
            {c.state === 'ready' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <div>
              <h3 className="text-sm font-medium">{c.label}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.detail}</p>
              {c.href && (
                <Link href={c.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium">
                  Review setup
                  <ExternalLink className="size-3" />
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
      {readiness.publication && (
        <section className="mt-5 border-t border-border pt-4" aria-label="Published delivery evidence">
          <h3 className="text-sm font-medium">Published delivery evidence</h3>
          <dl className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">Provider-recorded published</dt>
              <dd className="mt-1 text-2xl font-semibold">{readiness.publication.recordedPublished}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Public HTML verified</dt>
              <dd className="mt-1 text-2xl font-semibold">{readiness.publication.verified}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{`${readiness.publication.failed} failed checks · ${readiness.publication.unverified} unverified · ${readiness.publication.notChecked} without a current check`}</p>
          <p className="mt-2 text-xs text-muted-foreground">Public checks are dated evidence for the current URL. They do not establish indexing, search impact, or continuous monitoring.</p>
        </section>
      )}
      {readiness.cadence && <p className="mt-5 border-t border-border pt-4 text-sm">{readiness.cadence.line}</p>}
    </section>
  );
}
