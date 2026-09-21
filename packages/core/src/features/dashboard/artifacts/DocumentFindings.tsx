'use client';

/**
 * What the last render-verify and the last read-as-the-buyer found, on a tab
 * of their own.
 *
 * They used to be two amber `<details>` blocks stacked ABOVE the document.
 * Chris, 2026-09-18: *"11 findings — i don't like that location. can we hide
 * this in a tab icon like HTML."* They pushed the document down the pane and
 * shouted at a person who had come to read the document, which is the wrong
 * order: the findings are evidence about the document, so they live one click
 * away with a count on the tab (design principle 12 — hide complexity, never
 * hide truth).
 *
 * Amber only where something BLOCKS. An issue from the renderer and a `fix`
 * from the buyer's read are things to do, not alarms.
 */

import type { DocumentRedTeam, DocumentVerification } from '@/libs/cards/specs';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/utils/Helpers';

/**
 * `consider` is a judgement the agent already weighed; listing it would bury the blocks.
 * @param redTeam
 */
export function actionableFindings(redTeam: DocumentRedTeam | undefined) {
  return (redTeam?.findings ?? []).filter(f => f.severity !== 'consider');
}

export function DocumentFindings(props: { verification?: DocumentVerification; redTeam?: DocumentRedTeam; className?: string }) {
  const issues = props.verification?.issues ?? [];
  const findings = actionableFindings(props.redTeam);

  if (issues.length === 0 && findings.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', props.className)} data-document-findings-empty>
        <CheckCircle2 className="size-5 text-brand-pass" aria-hidden />
        <p className="text-sm text-foreground">Nothing to answer.</p>
        <p className="max-w-sm text-[12px] text-muted-foreground">
          {props.verification
            ? props.redTeam
              ? 'The last render-verify passed and the last read as the buyer came back clean.'
              : 'The last render-verify passed. Nobody has read this version as the buyer yet.'
            : 'This version has not been verified yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-5 text-[12px]', props.className)}>
      {issues.length > 0 && (
        <section data-document-issues>
          <h3 className={cn('text-[11px] font-medium tracking-wide uppercase', 'text-brand-amber')}>
            {`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} from the last render-verify`}
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5 border-t border-rule pt-2 text-foreground/85">
            {issues.map(i => <li key={i} className="leading-5">{i}</li>)}
          </ul>
        </section>
      )}
      {findings.length > 0 && (
        <section data-document-findings>
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {`${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} a sceptical buyer would stop on`}
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-rule border-t border-rule">
            {findings.map(f => (
              <li key={`${f.sheet}-${f.rule}`} className="flex flex-col gap-0.5 py-2">
                <span className="flex items-center gap-2">
                  <span className={cn('rounded px-1.5 py-px text-[10px] tracking-wide uppercase', f.severity === 'block' ? 'bg-brand-amber/15 text-brand-amber' : 'bg-muted text-muted-foreground')}>
                    {f.severity}
                  </span>
                  <span className="text-muted-foreground">{`Sheet ${f.sheet} · ${f.rule}`}</span>
                </span>
                <span className="leading-5 text-foreground">{f.finding}</span>
                <span className="leading-5 text-muted-foreground">{`Fix: ${f.fix}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
