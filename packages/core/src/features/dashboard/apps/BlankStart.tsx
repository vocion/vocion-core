'use client';

import type { InstallOutcome } from './TemplatePicker';
import type { FunctionPlan } from '@/libs/workspace/functionPlan';
import type { BlankStartData } from '@/services/apps/AppTemplateService';
import { Loader2, PenLine } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { planBlockers } from '@/libs/workspace/functionPlanEdits';
import { PlanPreview } from './PlanPreview';
import { InstallReceipt } from './TemplatePicker';

/** What a draft came back with: the plan, or why not (with each field's problem). */
export type DraftOutcome = { ok: true; plan: FunctionPlan } | { ok: false; message: string; problems?: Record<string, string> };

export type DraftPlan = (description: string, answers: Record<string, string>) => Promise<DraftOutcome>;
export type CreatePlan = (plan: FunctionPlan) => Promise<InstallOutcome>;

/**
 * The card beside the templates that starts blank: the same anatomy, dashed —
 * the one that is not a template.
 * @param props - The card.
 * @param props.blank - The app's blank start.
 * @param props.action - The card's one action.
 */
export function BlankStartCard(props: { blank: BlankStartData; action: React.ReactNode }) {
  return (
    <div data-testid="template-blank" className="flex flex-col rounded-xl border border-dashed border-border p-5 transition-colors hover:bg-surface-hover">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <PenLine className="size-4" aria-hidden />
        </span>
        <h3 className="text-base leading-tight font-semibold">{props.blank.label}</h3>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{props.blank.description}</p>
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-border/50 pt-3">{props.action}</div>
    </div>
  );
}

type Step = { kind: 'describe' } | { kind: 'preview'; plan: FunctionPlan } | { kind: 'done'; outcome: Extract<InstallOutcome, { ok: true }> };

/**
 * DESCRIBE YOUR OWN — the blank start in three steps, one dialog. The person
 * describes the function in their own words and answers the same short
 * interview a template asks; a model drafts the plan; the PREVIEW shows it
 * (teams → agents → missions and automations), every name editable and every
 * item removable; one Create stands it up as the person's own action, with
 * Undo on the receipt. Nothing is created before Create.
 * @param props - The dialog.
 * @param props.blank - The app's blank start, or null when closed.
 * @param props.onClose - Close it.
 * @param props.draft - Draft a plan.
 * @param props.create - Create a plan.
 * @param props.onCreated - Called after a create.
 */
export function BlankStartDialog(props: { blank: BlankStartData | null; onClose: () => void; draft: DraftPlan; create: CreatePlan; onCreated?: () => void }) {
  const b = props.blank;
  const [step, setStep] = useState<Step>({ kind: 'describe' });
  const [description, setDescription] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems: Record<string, string> } | null>(null);

  const close = () => {
    setStep({ kind: 'describe' });
    setDescription('');
    setAnswers({});
    setError(null);
    props.onClose();
  };

  const draft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!b) {
      return;
    }
    setBusy(true);
    setError(null);
    const filled = Object.fromEntries(b.interview.map(q => [q.key, answers[q.key] ?? q.defaultValue ?? '']));
    const out = await props.draft(description, filled);
    setBusy(false);
    if (out.ok) {
      setStep({ kind: 'preview', plan: out.plan });
    } else {
      setError({ message: out.message, problems: out.problems ?? {} });
    }
  };

  const create = async () => {
    if (step.kind !== 'preview') {
      return;
    }
    setBusy(true);
    setError(null);
    const out = await props.create(step.plan);
    setBusy(false);
    if (out.ok) {
      setStep({ kind: 'done', outcome: out });
      props.onCreated?.();
    } else {
      setError({ message: out.message, problems: out.problems ?? {} });
    }
  };

  const blockers = step.kind === 'preview' ? planBlockers(step.plan) : [];
  const problems = error?.problems ?? {};

  return (
    <Dialog open={b !== null} onOpenChange={open => !open && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {b && (
          <>
            <DialogHeader>
              <DialogTitle>{step.kind === 'preview' ? step.plan.name : b.label}</DialogTitle>
              <DialogDescription>
                {step.kind === 'describe' && b.description}
                {step.kind === 'preview' && 'Nothing is created yet. Rename anything, remove what you do not want, then create it — you are accountable for it, and Undo puts it all back.'}
                {step.kind === 'done' && 'Created.'}
              </DialogDescription>
            </DialogHeader>

            {step.kind === 'describe' && (
              <form onSubmit={draft} className="space-y-4" data-testid="blank-describe">
                <div className="space-y-1.5">
                  <Label htmlFor="blank-description">{b.describe.question}</Label>
                  <textarea
                    id="blank-description"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
                    value={description}
                    rows={5}
                    maxLength={b.describe.maxLength}
                    placeholder={b.describe.placeholder ?? undefined}
                    aria-invalid={problems.description ? true : undefined}
                    onChange={e => setDescription(e.target.value)}
                  />
                  {problems.description
                    ? <p className="text-xs text-destructive">{problems.description}</p>
                    : b.describe.help && <p className="text-xs text-muted-foreground">{b.describe.help}</p>}
                </div>
                {b.interview.map(q => (
                  <div key={q.key} className="space-y-1.5">
                    <Label htmlFor={`blank-${q.key}`}>{q.question}</Label>
                    <Input
                      id={`blank-${q.key}`}
                      value={answers[q.key] ?? q.defaultValue ?? ''}
                      placeholder={q.placeholder ?? undefined}
                      maxLength={q.maxLength}
                      aria-invalid={problems[q.key] ? true : undefined}
                      onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                    />
                    {problems[q.key] && <p className="text-xs text-destructive">{problems[q.key]}</p>}
                  </div>
                ))}
                {error && Object.keys(problems).length === 0 && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                  <Button type="submit" disabled={busy} data-testid="blank-draft">
                    {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {busy ? 'Drafting…' : 'Draft it'}
                  </Button>
                </DialogFooter>
              </form>
            )}

            {step.kind === 'preview' && (
              <>
                <PlanPreview plan={step.plan} onChange={plan => setStep({ kind: 'preview', plan })} />
                {blockers.map(line => <p key={line} className="text-sm text-destructive">{line}</p>)}
                {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'describe' })} disabled={busy}>Back</Button>
                  <Button type="button" onClick={create} disabled={busy || blockers.length > 0} data-testid="blank-create">
                    {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {busy ? 'Creating…' : 'Create'}
                  </Button>
                </DialogFooter>
              </>
            )}

            {step.kind === 'done' && <InstallReceipt receipt={step.outcome.receipt} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
