'use client';

import { useTranslations } from 'next-intl';

/** One kind's counts from an apply's dry run (`ApplyResult.counts`). */
type KindCounts = { created: number; updated: number; unchanged: number; unknown?: number; kept?: number; retired?: number };

/** One resource's outcome from an apply's dry run (`ApplyResult.changes`). */
type Change = { resource: string; slug: string; outcome: string };

/** The outcomes a diff lists: what an apply would actually do. */
const SHOWN = ['created', 'updated', 'retired'] as const;

/**
 * What an apply would change, per kind — the one diff every "review, then
 * apply" in the app shows: the drift banner's (a workspace folder changed)
 * and an import's. Kinds with nothing to do are left out. Given the
 * per-resource outcomes too, each kind names what it would add, change and
 * retire, so "2 updated" says which two.
 * @param props - The dry run.
 * @param props.counts - Per kind (`ApplyResult.counts`).
 * @param props.changes - Per resource (`ApplyResult.changes`), when the names should show.
 */
export function ApplyDiff(props: { counts: Record<string, KindCounts>; changes?: readonly Change[] }) {
  const t = useTranslations('ApplyDiff');
  const rows = Object.entries(props.counts).filter(([, c]) => c.created + c.updated + (c.retired ?? 0) > 0);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('nothing')}</p>;
  }
  const kindLabel = (kind: string) => {
    const key = `kinds.${kind}` as 'kinds.agents';
    return t.has(key) ? t(key) : kind;
  };
  return (
    <ul className="divide-y divide-border rounded-md border border-border text-sm">
      {rows.map(([kind, c]) => {
        const named = (props.changes ?? []).filter(ch => ch.resource === kind && (SHOWN as readonly string[]).includes(ch.outcome));
        return (
          <li key={kind} className="px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{kindLabel(kind)}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {[
                  c.created > 0 && t('created', { count: c.created }),
                  c.updated > 0 && t('updated', { count: c.updated }),
                  (c.retired ?? 0) > 0 && t('retired', { count: c.retired ?? 0 }),
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
            {named.length > 0 && (
              <p className="mt-1 text-xs leading-relaxed break-words text-muted-foreground">
                {SHOWN.map(outcome => ({ outcome, slugs: named.filter(ch => ch.outcome === outcome).map(ch => ch.slug) }))
                  .filter(group => group.slugs.length > 0)
                  .map((group, i) => (
                    <span key={group.outcome}>
                      {i > 0 && ' · '}
                      {t(`outcome.${group.outcome}`)}
                      {': '}
                      <code className={`font-mono ${group.outcome === 'retired' ? 'line-through' : ''}`}>{group.slugs.join(', ')}</code>
                    </span>
                  ))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
