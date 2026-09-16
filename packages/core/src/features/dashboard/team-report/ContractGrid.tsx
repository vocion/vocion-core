import type { OutcomeContract } from '@/services/TeamReportService';
import { ArrowUpRight } from 'lucide-react';
import { OwnerChip } from '@/features/dashboard/teams/OwnerChip';
import { Link } from '@/libs/I18nNavigation';
import { AutonomyReadings } from './AutonomyReadings';

/**
 * A member's contract as a flat definition grid — Mission · Accountable
 * owner · Control · Review queue — for the member detail page. Vocabulary per
 * the spec; a field the workspace has not authored says so in plain text,
 * with no file path in the copy.
 * @param props
 * @param props.contract - The resolved contract.
 * @param props.escalationHref - The inbox filtered to this member.
 * @param props.purposeFallback - Copy when no mission is authored.
 */
export function ContractGrid({ contract, escalationHref, purposeFallback }: {
  contract: OutcomeContract;
  escalationHref: string;
  purposeFallback: string;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Mission" wide>
        {contract.purpose
          ? <span className="text-foreground/90">{contract.purpose}</span>
          : <span className="text-muted-foreground">{purposeFallback}</span>}
      </Field>
      <Field label="Accountable owner">
        <OwnerChip accountable={contract.owner} />
      </Field>
      <Field label="Control">
        {contract.autonomy.length === 0
          ? (
              <span className="text-muted-foreground">
                {contract.permissions.length === 0 ? 'Every outward action waits for a person.' : `${contract.permissions.length} permitted action ${contract.permissions.length === 1 ? 'kind' : 'kinds'}; nothing decided yet.`}
                {' '}
                <Link href="/dashboard/autonomy" className="text-primary hover:underline">Policy</Link>
              </span>
            )
          : <AutonomyReadings readings={contract.autonomy} />}
      </Field>
      <Field label="Review queue">
        <Link href={escalationHref} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          Open this agent's inbox items
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
