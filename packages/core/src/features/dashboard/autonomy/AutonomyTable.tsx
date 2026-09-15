'use client';

import type { AutonomyPolicyView } from '@/services/autonomy/AutonomyService';
import { ArrowDown, ArrowUp, Check, Loader2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { riskTone } from '@/features/dashboard/inbox/inboxMeta';
import { client } from '@/libs/Orpc';
import { RUNG_LABEL, rungAutomates, rungIndex, RUNGS } from '@/services/autonomy/rungs';

/**
 * The ladder as a table: kind, rung, risk, confidence floor, alignment,
 * eligibility, and the one or two verbs that apply. Dense and quiet — the
 * rung that automates is the only thing drawn in colour, a flag is the only
 * thing drawn in amber. Promote is rendered only when earned; the reason it
 * is not sits in the eligibility column, so nothing is hidden by its absence.
 * @param props
 * @param props.policies - One row per action kind, from `listPolicies`.
 * @param props.isAdmin - Whether the verbs render; moving a kind is admin-only.
 */
export function AutonomyTable({ policies, isAdmin }: { policies: AutonomyPolicyView[]; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(actionId: string, fn: () => Promise<unknown>) {
    setBusy(actionId);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (policies.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">No action kinds registered yet.</p>;
  }

  const automating = policies.filter(p => p.automates).length;
  const flagged = policies.filter(p => p.flagged).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {`${automating} of ${policies.length} kinds execute within bounds`}
        {flagged > 0 && (
          <span className="text-amber-700 dark:text-amber-400">{` · ${flagged} demoted automatically and waiting for a look`}</span>
        )}
        <span className="text-muted-foreground/70">{' · '}</span>
        <span className="text-muted-foreground/90">{RUNGS.map(r => RUNG_LABEL[r]).join(' → ')}</span>
      </p>
      {error && (
        <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              <th className="py-2 pr-3 font-medium">Kind</th>
              <th className="py-2 pr-3 font-medium">Rung</th>
              <th className="py-2 pr-3 font-medium">Risk</th>
              <th className="py-2 pr-3 text-right font-medium">Confidence floor</th>
              <th className="py-2 pr-3 font-medium">Alignment · 30d</th>
              <th className="py-2 pr-3 font-medium">Next rung</th>
              {isAdmin && <th className="py-2 text-right font-medium">Move</th>}
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => {
              const canPromote = isAdmin && p.eligibility.earned && p.eligibility.nextRung !== null;
              const canDemote = isAdmin && rungIndex(p.rung) > 0;
              const isBusy = busy === p.actionId;
              return (
                <tr key={p.actionId} className={`border-b border-border/60 last:border-0 ${p.flagged ? 'bg-amber-500/5' : ''}`}>
                  <td className="py-2.5 pr-3 align-top">
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{p.actionId}</div>
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <div className={rungAutomates(p.rung) && p.automates ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium'}>{RUNG_LABEL[p.rung]}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.neverAuto
                        ? 'held here by the platform'
                        : p.source === 'trust.yaml'
                          ? 'from trust.yaml'
                          : p.source === 'system'
                            ? 'demoted automatically'
                            : p.promotedAt
                              ? `set ${new Date(p.promotedAt).toLocaleDateString()}${p.promotedBy ? ` · ${p.promotedBy}` : ''}`
                              : 'default'}
                    </div>
                    {p.flagged && (
                      <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span>{p.flagReason}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ${riskTone(p.riskTier)}`}>{p.riskTier}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right align-top tabular-nums">
                    {p.automates ? `≥ ${Math.round(p.minConfidence * 100)}%` : <span className="text-muted-foreground">{`${Math.round(p.minConfidence * 100)}% once promoted`}</span>}
                  </td>
                  <td className="py-2.5 pr-3 align-top tabular-nums">
                    {p.alignment.n === 0
                      ? <span className="text-xs text-muted-foreground">{p.alignment.decided > 0 ? `${p.alignment.decided} decided, nothing recommended` : 'no decisions yet'}</span>
                      : (
                          <span title={`${p.alignment.agreed} of ${p.alignment.n} decisions chose what the agent recommended · ${p.alignment.rejected} rejected`}>
                            <span className="font-medium">{`${Math.round((p.alignment.agreementRate ?? 0) * 100)}%`}</span>
                            <span className="text-muted-foreground">{` agree · n=${p.alignment.n}`}</span>
                            {p.alignment.rejected > 0 && <span className="text-muted-foreground">{` · ${p.alignment.rejected} rejected`}</span>}
                          </span>
                        )}
                  </td>
                  <td className="py-2.5 pr-3 align-top text-xs">
                    <span className={p.eligibility.earned && p.eligibility.nextRung && rungAutomates(p.eligibility.nextRung) ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                      {p.eligibility.reason}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="py-2.5 text-right align-top">
                      <div className="inline-flex items-center gap-1.5">
                        {p.flagged && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(p.actionId, () => client.autonomy.acknowledgeFlag({ actionId: p.actionId }))}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                            title="Clear the flag — you have looked at this"
                          >
                            <Check className="size-3.5" aria-hidden />
                            Seen
                          </button>
                        )}
                        {canPromote && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(p.actionId, () => client.autonomy.promote({ actionId: p.actionId }))}
                            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {isBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
                            {`Promote to ${RUNG_LABEL[p.eligibility.nextRung!]}`}
                          </button>
                        )}
                        {canDemote && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(p.actionId, () => client.autonomy.demote({ actionId: p.actionId }))}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                            title={`Step down to ${RUNG_LABEL[RUNGS[rungIndex(p.rung) - 1]!]}`}
                          >
                            <ArrowDown className="size-3.5" aria-hidden />
                            Demote
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        A promotion to Execute within bounds writes an enabled trust rule at the confidence floor; a demotion disables it. Rules authored in
        {' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">trust.yaml</code>
        {' '}
        win on the next workspace apply — copy an in-app promotion into the file to keep it.
      </p>
    </div>
  );
}
