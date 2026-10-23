import type { RoutineSpec } from '@/libs/routines/types';
import { ArrowRight, Ban, CircleCheck, KeyRound, Lock, MousePointerClick } from 'lucide-react';
import { FactList } from '@/components/patterns';
import { minutesLong } from '@/libs/routines/display';
import { MomentLink } from './RoutineChips';
import { SubHead } from './RoutineParts';

/**
 * WHAT THE ROUTINE DOES, AS ITS EXPERT APPROVES IT — the spec the analyst
 * drafted from the recording: the summary, every step with the moment it was
 * taught at, the rules, where it stops and asks, what it must never do, what
 * it takes and owes (each output with the input it must read back as), what
 * must be true at the end, and the writes it may make unattended once approved.
 * Every claim one click from the second of the recording it came from
 * (principle 10).
 */

const TH = 'py-1.5 pr-3 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase';
const TD = 'py-1.5 pr-3 align-top';

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function RoutineSpecView({ spec, sourceUrl, expert }: { spec: RoutineSpec; sourceUrl: string | null; expert: string | null }) {
  return (
    <div className="text-sm" data-routine-spec>
      <p className="leading-relaxed text-foreground">{spec.summary}</p>
      {(spec.startUrl || spec.systems.length > 0 || spec.manualMinutes) && (
        <FactList
          layout="inline"
          className="mt-3 gap-x-6 gap-y-1"
          facts={[
            spec.startUrl && { label: 'Starts at', value: host(spec.startUrl), href: spec.startUrl },
            spec.systems.length > 0 && { label: 'Uses', value: spec.systems.join(', ') },
            spec.manualMinutes ? { label: 'By hand', value: `${minutesLong(spec.manualMinutes)} a run` } : null,
          ]}
        />
      )}

      {spec.preconditions.length > 0 && (
        <>
          <SubHead count={spec.preconditions.length}>Before it starts</SubHead>
          <ul className="space-y-1">
            {spec.preconditions.map(p => (
              <li key={p} className="flex gap-2 text-[13px] text-foreground">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </>
      )}

      <SubHead count={spec.steps.length}>Steps</SubHead>
      <ol className="divide-y divide-border/60" data-routine-steps>
        {spec.steps.map(s => (
          <li key={s.n} className="flex items-start gap-3 py-2">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[11px] font-medium text-muted-foreground tabular-nums">{s.n}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-snug text-foreground">{s.text}</span>
              {s.why && <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{s.why}</span>}
            </span>
            <MomentLink url={sourceUrl} at={s.at} />
          </li>
        ))}
      </ol>

      {spec.rules.length > 0 && (
        <>
          <SubHead count={spec.rules.length}>Rules</SubHead>
          <ul className="space-y-1.5" data-routine-rules>
            {spec.rules.map(r => (
              <li key={r.text} className="flex items-start gap-2 text-[13px] text-foreground">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                <span className="min-w-0 flex-1 leading-snug">{r.text}</span>
                <MomentLink url={sourceUrl} at={r.at} />
              </li>
            ))}
          </ul>
        </>
      )}

      {spec.escalations.length > 0 && (
        <>
          <SubHead count={spec.escalations.length}>When it stops and asks</SubHead>
          <ul className="space-y-2" data-routine-escalations>
            {spec.escalations.map(e => (
              <li key={e.when} className="flex items-start gap-2 rounded-lg bg-surface-soft px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="text-muted-foreground">When </span>
                  <span className="text-foreground">{e.when}</span>
                  <ArrowRight className="mx-1.5 inline size-3 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">{`asks ${expert ?? 'its expert'}: `}</span>
                  <span className="text-foreground">{e.ask}</span>
                </span>
                <MomentLink url={sourceUrl} at={e.at} />
              </li>
            ))}
          </ul>
        </>
      )}

      {spec.prohibited.length > 0 && (
        <>
          <SubHead count={spec.prohibited.length}>Never</SubHead>
          <ul className="space-y-1" data-routine-prohibited>
            {spec.prohibited.map(p => (
              <li key={p} className="flex items-start gap-2 text-[13px] text-foreground">
                <Ban className="mt-0.5 size-3.5 shrink-0 text-brand-fail" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </>
      )}

      <SubHead count={spec.inputs.length}>Inputs</SubHead>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" data-routine-inputs>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Name</th>
              <th className={TH}>What it is</th>
              <th className={TH}>Example</th>
            </tr>
          </thead>
          <tbody>
            {spec.inputs.map(i => (
              <tr key={i.name} className="border-b border-border/60 last:border-b-0">
                <td className={`${TD} font-mono whitespace-nowrap text-foreground`}>
                  {i.name}
                  {i.secret && <Lock className="ml-1 inline size-3 text-muted-foreground" aria-label="secret" />}
                  {i.key && <KeyRound className="ml-1 inline size-3 text-muted-foreground" aria-label="part of the dedupe key" />}
                </td>
                <td className={`${TD} text-foreground`}>{i.description}</td>
                <td className={`${TD} text-muted-foreground`}>{i.secret ? '••••' : (i.example ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {spec.outputs.length > 0 && (
        <>
          <SubHead count={spec.outputs.length}>Outputs</SubHead>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" data-routine-outputs>
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Name</th>
                  <th className={TH}>What it is</th>
                  <th className={TH}>Reads back as</th>
                </tr>
              </thead>
              <tbody>
                {spec.outputs.map(o => (
                  <tr key={o.name} className="border-b border-border/60 last:border-b-0">
                    <td className={`${TD} font-mono whitespace-nowrap text-foreground`}>{o.name}</td>
                    <td className={`${TD} text-foreground`}>{o.description}</td>
                    <td className={`${TD} text-muted-foreground`}>{o.checks ? <span className="font-mono text-foreground">{o.checks}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {spec.postconditions.length > 0 && (
        <>
          <SubHead count={spec.postconditions.length}>True when it is done</SubHead>
          <ul className="space-y-1" data-routine-postconditions>
            {spec.postconditions.map(p => (
              <li key={p} className="flex items-start gap-2 text-[13px] text-foreground">
                <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-brand-pass" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </>
      )}

      {spec.reconcile && (
        <>
          <SubHead>After a batch, it checks the list</SubHead>
          <p className="text-[13px] leading-snug text-foreground">{spec.reconcile.how}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {`Matched on `}
            <span className="font-mono text-foreground">{spec.reconcile.matchOn}</span>
            {spec.reconcile.listUrl && (
              <>
                {' · '}
                <a href={spec.reconcile.listUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground">{host(spec.reconcile.listUrl)}</a>
              </>
            )}
            {' · anything there that is not on the rows comes back as a finding for the expert.'}
          </p>
        </>
      )}

      {spec.writes.length > 0 && (
        <>
          <SubHead count={spec.writes.length}>Writes it may make</SubHead>
          <p className="mb-2 text-[12px] text-muted-foreground">At Approved trust these clicks run without waiting; any other consequential click still waits for a person.</p>
          <ul className="flex flex-wrap gap-1.5" data-routine-writes>
            {spec.writes.map(w => (
              <li key={`${w.button}|${w.host ?? ''}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] text-foreground">
                <MousePointerClick className="size-3 text-muted-foreground" aria-hidden />
                {w.button}
                {w.host && <span className="text-muted-foreground">{`on ${w.host}`}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
