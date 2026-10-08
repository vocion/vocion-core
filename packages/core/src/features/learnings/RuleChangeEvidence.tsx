import type { RuleChangeEvidence as Evidence, RetiredRuleSnapshot, RuleChangeKind } from '@/libs/learning/ruleChange';
import { Link } from '@/libs/I18nNavigation';
import { retireLine } from '@/libs/learning/ruleChange';

/**
 * A date the evidence carries, as a day — or a word, never "Invalid Date".
 * @param iso - An ISO timestamp, or nothing.
 */
function dayOf(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Where a rule came from, for a person: a feedback job links to nothing yet, so it is named.
 * @param source - The rule's provenance string.
 */
function sourceLabel(source: string | null): string | null {
  if (!source) {
    return null;
  }
  if (source.startsWith('feedback:')) {
    return `from feedback #${source.slice('feedback:'.length)}`;
  }
  if (source.startsWith('merge:')) {
    return `merged by suggestion #${source.slice('merge:'.length)}`;
  }
  return source === 'learning-candidate' ? 'from a suggested rule' : source;
}

function RuleLine({ rule, stepName }: { rule: RetiredRuleSnapshot; stepName: string }) {
  const read = dayOf(rule.lastUsedAt);
  const restated = dayOf(rule.lastReinforcedAt);
  const facts = [
    rule.occurrenceCount > 1 ? `asked ${rule.occurrenceCount} times` : 'asked once',
    sourceLabel(rule.source),
    dayOf(rule.adoptedAt) ? `adopted ${dayOf(rule.adoptedAt)}` : null,
    read ? `last read ${read}` : 'never read by an agent',
    restated ? `last restated ${restated}` : 'never restated',
  ].filter((f): f is string => Boolean(f));
  return (
    <li className="py-2.5" data-testid="rule-change-rule">
      <p className="text-sm leading-relaxed">{rule.text}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {facts.join(' · ')}
        {' · '}
        <Link href={`/dashboard/learnings/${encodeURIComponent(stepName)}`} className="underline decoration-border underline-offset-2 hover:decoration-foreground">
          in
          {' '}
          {stepName}
        </Link>
      </p>
    </li>
  );
}

/**
 * What a merge or a retirement changes in a rulebook, and the evidence it was
 * proposed on — one block for the learnings page and the Needs-you screen, so
 * both say the same thing about the same suggestion (principle 6).
 *
 * The reason comes first in one plain line ("4 rules no agent has read and
 * nobody has restated in 60 days"); each rule that goes is listed under it
 * with what it had earned and when it was last read and restated, so a person
 * decides on what the system saw (principle 10). A merge shows the total its
 * originals carry onto the merged rule. Hairlines, not boxes.
 * @param props - The suggestion.
 * @param props.kind - `merge` or `expire`; an `adopt` renders nothing.
 * @param props.evidence - The candidate's evidence; null for a merge filed before evidence was kept.
 * @param props.replacedCount - How many rules the change retires, for a row with no evidence.
 * @param props.stepName - The namespace the rules live in.
 */
export function RuleChangeEvidence(props: { kind: RuleChangeKind; evidence: Evidence | null; replacedCount: number; stepName: string }) {
  if (props.kind === 'adopt') {
    return null;
  }
  const evidence = props.evidence;
  const rules = evidence?.rules ?? [];
  const total = rules.reduce((n, r) => n + Math.max(1, r.occurrenceCount), 0);
  const headline = evidence
    ? retireLine(evidence)
    : `${props.replacedCount} rule${props.replacedCount === 1 ? '' : 's'} merged into one`;
  const asOf = dayOf(evidence?.asOf);
  return (
    <div className="text-[13px]" data-testid="rule-change-evidence">
      <p className="font-medium text-foreground">{headline}</p>
      {evidence?.why && <p className="mt-1 text-muted-foreground">{evidence.why}</p>}
      {props.kind === 'merge' && rules.length > 0 && (
        <p className="mt-1 text-muted-foreground" title="The merged rule keeps the occurrence count of every rule it replaces">
          {`The merged rule keeps all ${total} times these were asked for, and each original as its provenance.`}
        </p>
      )}
      {rules.length > 0 && (
        <>
          <div className="mt-4 text-[11px] font-medium text-muted-foreground">
            {props.kind === 'merge' ? 'Rules it replaces' : `Rule${rules.length === 1 ? '' : 's'} it retires`}
          </div>
          <ul className="divide-y divide-border/70 border-y border-border/70">
            {rules.map(rule => <RuleLine key={rule.key} rule={rule} stepName={props.stepName} />)}
          </ul>
        </>
      )}
      {evidence?.supersededBy && (
        <div className="mt-4">
          <div className="text-[11px] font-medium text-muted-foreground">The newer rule that stays</div>
          <p className="mt-1 text-sm leading-relaxed">{evidence.supersededBy.text}</p>
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">
        {props.kind === 'merge' ? 'Merging retires the originals, never deletes them' : 'Retiring hides the rule from every agent, never deletes it'}
        {' — Undo brings them back as they were.'}
        {asOf && ` Evidence as of ${asOf}.`}
      </p>
    </div>
  );
}
