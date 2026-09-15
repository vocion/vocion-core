import type { OutcomeContract } from '@/services/TeamReportService';
import { ArrowUpRight } from 'lucide-react';
import { OwnerChip } from '@/features/dashboard/teams/OwnerChip';
import { Link } from '@/libs/I18nNavigation';
import { AutonomyReadings } from './AutonomyReadings';
import { pct } from './format';

/**
 * The manifesto's outcome contract as a flat definition grid — Purpose ·
 * Owner · Current performance · Autonomy · Permissions · Escalation. KPIs
 * render separately (KpiMeter) because they need width. A field the
 * workspace has not authored says "not set" in plain text; nothing is
 * invented to fill a cell.
 * @param props
 * @param props.contract - The resolved contract.
 * @param props.escalationHref - Where a human goes when something needs them (the inbox).
 * @param props.purposeFallback - Copy when no purpose is authored, pointing at the YAML key to set.
 */
export function ContractGrid({ contract, escalationHref, purposeFallback }: {
  contract: OutcomeContract;
  escalationHref: string;
  purposeFallback: string;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Purpose" wide>
        {contract.purpose
          ? <span className="text-foreground/90">{contract.purpose}</span>
          : <span className="text-muted-foreground">{purposeFallback}</span>}
      </Field>
      <Field label="Owner">
        <OwnerChip accountable={contract.owner} />
      </Field>
      <Field label="Current performance">
        {contract.attainment === null
          ? <span className="text-muted-foreground">Not measured — no KPIs authored</span>
          : (
              <span className="tabular-nums">
                <span className="text-lg font-semibold">{pct(contract.attainment)}</span>
                <span className="text-muted-foreground">
                  {' of target · '}
                  {contract.kpis.filter(k => k.met).length}
                  /
                  {contract.kpis.length}
                  {' met'}
                </span>
              </span>
            )}
      </Field>
      <Field label="Autonomy">
        {contract.autonomy.length === 0
          ? (
              <span className="text-muted-foreground">
                Nothing decided yet — every kind starts at Execute with approval.
                {' '}
                <Link href="/dashboard/autonomy" className="text-primary hover:underline">Ladder</Link>
              </span>
            )
          : <AutonomyReadings readings={contract.autonomy} />}
      </Field>
      <Field label="Permissions">
        {contract.permissions.length === 0
          ? <span className="text-foreground/80">Every outward action waits for a person</span>
          : (
              <span className="flex flex-wrap gap-1">
                {contract.permissions.map(p => <code key={p} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{p}</code>)}
              </span>
            )}
      </Field>
      <Field label="Escalation">
        <Link href={escalationHref} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          Anything needing a person is in the inbox
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </Field>
    </dl>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
