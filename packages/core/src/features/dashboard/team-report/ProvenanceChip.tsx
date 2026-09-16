import type { MeasureReading, ProvenanceKind } from '@/services/team-report';
import { CheckCircle2, Eye, PlugZap, ShieldCheck, TriangleAlert, UserCheck } from 'lucide-react';
import { PROVENANCE_LABEL, PROVENANCE_MEANING, UNAVAILABLE_LABEL } from '@/services/team-report';
import { ago } from './format';

const ICON: Record<ProvenanceKind, typeof ShieldCheck> = {
  'verified': ShieldCheck,
  'observed': Eye,
  'human-confirmed': UserCheck,
  'agent-reported': CheckCircle2,
};

/**
 * The small provenance chip beside every reading (spec §2): "verified ·
 * HubSpot", "human-confirmed", "agent-reported". Agent-reported is visibly
 * the weakest — muted, dashed, and its tooltip says the worker reported it.
 * A verified reading from a synced mirror says how old the sync is.
 *
 * When there is no reading at all the chip stops describing provenance and
 * describes the GAP instead: "Google Analytics · not connected", "HubSpot ·
 * read failed". The figure beside it already shows an em dash; the chip is
 * what stops a reader inferring that the dash means nothing happened. It is
 * never green — an unread source has verified nothing.
 * @param props
 * @param props.reading - The reading the chip is about.
 * @param props.now - The clock, for the sync age.
 */
export function ProvenanceChip({ reading, now = new Date() }: { reading: MeasureReading; now?: Date }) {
  const kind = reading.provenance;
  if (reading.unavailableKind !== null) {
    const Gap = reading.unavailableKind === 'unconfigured' ? PlugZap : TriangleAlert;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-px text-[11px] font-medium whitespace-nowrap text-muted-foreground"
        title={reading.unavailableReason ?? undefined}
        aria-label={`${reading.sourceLabel} · ${UNAVAILABLE_LABEL[reading.unavailableKind]}. ${reading.unavailableReason ?? ''}`}
      >
        <Gap className="size-3" aria-hidden />
        {reading.sourceLabel}
        {' · '}
        {UNAVAILABLE_LABEL[reading.unavailableKind]}
      </span>
    );
  }
  const Icon = ICON[kind];
  const weakest = kind === 'agent-reported';
  const synced = kind === 'verified' && reading.freshness.asOf ? ` (synced ${ago(reading.freshness.asOf, now)})` : '';
  const label = kind === 'verified' ? `${PROVENANCE_LABEL[kind]} · ${reading.sourceLabel}${synced}` : PROVENANCE_LABEL[kind];
  const tone = weakest
    ? 'border-dashed border-border text-muted-foreground'
    : kind === 'verified'
      ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400'
      : 'border-border text-foreground/80';
  const tip = [PROVENANCE_MEANING[kind], reading.freshness.note ?? undefined, reading.unavailableReason ?? undefined].filter(Boolean).join(' ');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium whitespace-nowrap ${tone}`}
      title={tip}
      aria-label={`${label}. ${tip}`}
    >
      <Icon className="size-3" aria-hidden />
      {label}
      {reading.freshness.stale && <span className="text-amber-700 dark:text-amber-400">· stale</span>}
    </span>
  );
}
