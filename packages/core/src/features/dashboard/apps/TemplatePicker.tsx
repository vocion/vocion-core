'use client';

import type { CreatePlan, DraftPlan } from './BlankStart';
import type { AppTemplateCardData, BlankStartData, TemplateInstallReceipt } from '@/services/apps/AppTemplateService';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createElement, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/ui/status-pill';
import { iconByName } from '@/features/dashboard/iconByName';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { BlankStartCard, BlankStartDialog } from './BlankStart';

/** What an install came back with: the receipt (and the run whose Undo puts it back), or why not in words (with each question's problem). */
export type InstallOutcome = { ok: true; receipt: TemplateInstallReceipt & { runId?: number } } | { ok: false; message: string; problems?: Record<string, string> };

/** Install one template; the default calls the `apps.installTemplate` RPC. */
export type InstallTemplate = (template: string, answers: Record<string, string>) => Promise<InstallOutcome>;

/**
 * The default install — the RPC, with its typed refusal read back.
 * @param appId - The app.
 */
function rpcInstall(appId: string): InstallTemplate {
  return async (template, answers) => {
    try {
      return { ok: true, receipt: await client.apps.installTemplate({ appId, template, answers }) };
    } catch (error) {
      return refusal(error, 'The template could not be set up.');
    }
  };
}

function refusal(error: unknown, fallback: string): { ok: false; message: string; problems?: Record<string, string> } {
  const data = (error as { data?: { problems?: Record<string, string> } }).data;
  return { ok: false, message: error instanceof Error ? error.message : fallback, problems: data?.problems };
}

/**
 * The default draft and create — the RPCs.
 * @param appId - The app.
 */
function rpcBlank(appId: string): { draft: DraftPlan; create: CreatePlan } {
  return {
    draft: async (description, answers) => {
      try {
        const { plan } = await client.apps.draftPlan({ appId, description, answers });
        return { ok: true, plan };
      } catch (error) {
        return refusal(error, 'The draft could not be written.');
      }
    },
    create: async (plan) => {
      try {
        return { ok: true, receipt: await client.apps.createFromPlan({ appId, plan: plan as unknown as Record<string, unknown> }) };
      } catch (error) {
        return refusal(error, 'It could not be created.');
      }
    },
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What a template stands up, as one line of counts.
 * @param contents - The template's contents.
 */
function contentsLine(contents: AppTemplateCardData['contents']): string {
  return [
    contents.teams.length ? plural(contents.teams.length, 'team') : null,
    contents.agents.length ? plural(contents.agents.length, 'agent') : null,
    contents.missions.length ? plural(contents.missions.length, 'mission') : null,
    contents.automations.length ? plural(contents.automations.length, 'automation') : null,
    contents.trustRules.length ? plural(contents.trustRules.length, 'trust bar') : null,
  ].filter(Boolean).join(' · ');
}

/**
 * One template on an app's start page. The same anatomy as the marketplace's
 * catalog card next door — hairline border, icon, soft hover, one action at
 * the foot — rather than a second card style beside it.
 * @param props - The card.
 * @param props.template - What the template is and stands up.
 * @param props.action - The card's one action.
 */
export function TemplateCard(props: { template: AppTemplateCardData; action: React.ReactNode }) {
  const { template } = props;
  return (
    <div data-testid={`template-${template.slug}`} className="group relative flex flex-col rounded-xl border border-border/70 p-5 transition-colors hover:bg-surface-hover">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          {createElement(iconByName(template.icon), { 'className': 'size-4', 'aria-hidden': true })}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-tight font-semibold">{template.name}</h3>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{contentsLine(template.contents)}</div>
        </div>
        {template.installed && <StatusPill status="completed" label="Set up here" size="sm" />}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{template.description}</p>
      {template.includes.length > 0 && (
        <ul className="mt-3 flex-1 space-y-1 text-[13px] leading-snug">
          {template.includes.map(line => (
            <li key={line} className="flex gap-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {template.contents.plugins.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Turns on
          {' '}
          {template.contents.plugins.join(', ')}
          {' '}
          as it ships — nothing copied.
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-border/50 pt-3">{props.action}</div>
    </div>
  );
}

/**
 * What an install did, said in a person's words, with the two places to go next.
 * @param props - The receipt.
 * @param props.receipt - What the install did.
 * @param props.undo - Override the undo (stories); defaults to the review queue's undo.
 */
export function InstallReceipt(props: { receipt: TemplateInstallReceipt & { runId?: number }; undo?: (runId: number) => Promise<string | null> }) {
  const r = props.receipt;
  const [undone, setUndone] = useState<'idle' | 'busy' | 'done' | string>('idle');
  const undo = props.undo ?? (async (runId: number) => {
    try {
      await client.review.undoAction({ id: runId });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'It could not be put back.';
    }
  });
  const runUndo = async () => {
    if (!r.runId) {
      return;
    }
    setUndone('busy');
    const failed = await undo(r.runId);
    setUndone(failed ?? 'done');
  };
  if (undone === 'done') {
    return (
      <p data-testid="template-undone" className="text-sm">
        Put back:
        {' '}
        {r.name}
        {' '}
        is gone from this workspace — its files, teams and agents, as one unit.
      </p>
    );
  }
  const errors = r.applied.errors;
  const createdNothing = r.files.created.length === 0 && r.pluginsAdded.length === 0 && r.trustRulesAdded.length === 0;
  return (
    <div data-testid="template-receipt" className="space-y-3 text-sm">
      <p className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span>
          {createdNothing
            ? `${r.name} was already set up here — nothing needed changing.`
            : `${r.name} is set up: ${contentsLine(r.contents)}. You are accountable for it.`}
        </span>
      </p>
      {r.pluginsAdded.length > 0 && (
        <p className="text-muted-foreground">
          Turned on
          {' '}
          {r.pluginsAdded.join(', ')}
          .
        </p>
      )}
      {r.leadSet && (
        <p className="text-muted-foreground">
          {r.leadSet}
          {' '}
          now leads the workspace.
        </p>
      )}
      {r.files.kept.length > 0 && (
        <p className="text-muted-foreground">
          Kept
          {' '}
          {plural(r.files.kept.length, 'file')}
          {' '}
          you had changed, as you left them:
          {' '}
          {r.files.kept.join(', ')}
          .
        </p>
      )}
      {errors.length > 0 && (
        <p className="text-destructive">
          Applied with
          {' '}
          {plural(errors.length, 'error')}
          :
          {' '}
          {errors.slice(0, 3).map(e => `${e.resource} ${e.slug}: ${e.message}`).join('; ')}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild size="sm">
          <Link href={r.links.chat}>
            Talk to the lead
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={r.links.teamReport}>Open the team report</Link>
        </Button>
        {r.runId !== undefined && (
          <Button size="sm" variant="ghost" onClick={runUndo} disabled={undone === 'busy'} data-testid="template-undo">
            {undone === 'busy' ? 'Putting it back…' : 'Undo'}
          </Button>
        )}
      </div>
      {undone !== 'idle' && undone !== 'busy' && <p role="alert" className="text-xs text-destructive">{undone}</p>}
    </div>
  );
}

/**
 * The interview: two or three questions, each prefilled with its default,
 * then one press stands the function up. Answers that need work come back on
 * the question they belong to; anything else stays in the dialog in words.
 * @param props - The dialog.
 * @param props.template - The template being set up, or null when closed.
 * @param props.onClose - Close the dialog.
 * @param props.install - How to install.
 * @param props.onInstalled - Called with the receipt after a successful install.
 */
export function TemplateInterview(props: { template: AppTemplateCardData | null; onClose: () => void; install: InstallTemplate; onInstalled?: (receipt: TemplateInstallReceipt) => void }) {
  const t = props.template;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);

  const close = () => {
    setAnswers({});
    setOutcome(null);
    props.onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!t) {
      return;
    }
    setBusy(true);
    const filled = Object.fromEntries(t.interview.map(q => [q.key, answers[q.key] ?? q.defaultValue ?? '']));
    const result = await props.install(t.slug, filled);
    setOutcome(result);
    setBusy(false);
    if (result.ok) {
      props.onInstalled?.(result.receipt);
    }
  };

  const problems = outcome && !outcome.ok ? outcome.problems ?? {} : {};

  return (
    <Dialog open={t !== null} onOpenChange={open => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        {t && (
          <>
            <DialogHeader>
              <DialogTitle>{t.name}</DialogTitle>
              <DialogDescription>{t.description}</DialogDescription>
            </DialogHeader>
            {outcome?.ok
              ? <InstallReceipt receipt={outcome.receipt} />
              : (
                  <form onSubmit={submit} className="space-y-4" data-testid="template-interview">
                    {t.interview.map(q => (
                      <div key={q.key} className="space-y-1.5">
                        <Label htmlFor={`q-${q.key}`}>{q.question}</Label>
                        <Input
                          id={`q-${q.key}`}
                          name={q.key}
                          value={answers[q.key] ?? q.defaultValue ?? ''}
                          placeholder={q.placeholder ?? undefined}
                          maxLength={q.maxLength}
                          aria-invalid={problems[q.key] ? true : undefined}
                          onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                        />
                        {problems[q.key]
                          ? <p className="text-xs text-destructive">{problems[q.key]}</p>
                          : q.help && <p className="text-xs text-muted-foreground">{q.help}</p>}
                      </div>
                    ))}
                    {outcome && !outcome.ok && Object.keys(problems).length === 0 && (
                      <p role="alert" className="text-sm text-destructive">{outcome.message}</p>
                    )}
                    <DialogFooter>
                      <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                      <Button type="submit" disabled={busy} data-testid="template-install">
                        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                        {busy ? 'Setting it up…' : t.installed ? 'Set it up again' : 'Set it up'}
                      </Button>
                    </DialogFooter>
                  </form>
                )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * An app's templates and the one move that stands one up. An admin picks a
 * card, answers its questions and presses once; a member sees what each one
 * stands up and who can set it up. On a host where this workspace is applied
 * from git the reason (and the repo path) replaces the action.
 * @param props - The picker.
 * @param props.appId - The app the templates belong to.
 * @param props.templates - Its templates for this workspace.
 * @param props.writable - Whether a template can be written here, or why not.
 * @param props.canInstall - Whether this viewer may set one up (admins).
 * @param props.install - Override the install (stories); defaults to the RPC.
 * @param props.blank - The app's blank start, when it has one.
 * @param props.startBlank - Open Describe your own at once (`?start=blank`).
 * @param props.draft - Override the draft (stories).
 * @param props.create - Override the create (stories).
 */
export function TemplatePicker(props: { appId: string; templates: AppTemplateCardData[]; blank?: BlankStartData | null; startBlank?: boolean; writable: { ok: true } | { ok: false; reason: string }; canInstall: boolean; install?: InstallTemplate; draft?: DraftPlan; create?: CreatePlan }) {
  const router = useRouter();
  const [open, setOpen] = useState<AppTemplateCardData | null>(null);
  const [blankOpen, setBlankOpen] = useState(Boolean(props.startBlank && props.blank && props.canInstall && props.writable.ok));
  const install = props.install ?? rpcInstall(props.appId);
  const rpc = rpcBlank(props.appId);
  const blocked = !props.writable.ok ? props.writable.reason : null;

  return (
    <>
      {blocked && (
        <p role="note" data-testid="template-blocked" className="mb-4 max-w-prose text-sm text-muted-foreground">{blocked}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {props.templates.map(t => (
          <TemplateCard
            key={t.slug}
            template={t}
            action={props.canInstall && !blocked
              ? (
                  <Button size="sm" variant={t.installed ? 'outline' : 'default'} onClick={() => setOpen(t)} data-testid={`template-open-${t.slug}`}>
                    {t.installed ? 'Set up again' : 'Use this template'}
                  </Button>
                )
              : <span className="text-xs text-muted-foreground">{blocked ? 'Set up from the workspace repo' : 'An admin sets this up'}</span>}
          />
        ))}
        {props.blank && (
          <BlankStartCard
            blank={props.blank}
            action={props.canInstall && !blocked
              ? <Button size="sm" variant="outline" onClick={() => setBlankOpen(true)} data-testid="template-open-blank">Describe your own</Button>
              : <span className="text-xs text-muted-foreground">{blocked ? 'Set up from the workspace repo' : 'An admin sets this up'}</span>}
          />
        )}
      </div>
      <TemplateInterview template={open} onClose={() => setOpen(null)} install={install} onInstalled={() => router.refresh()} />
      <BlankStartDialog blank={blankOpen ? props.blank ?? null : null} onClose={() => setBlankOpen(false)} draft={props.draft ?? rpc.draft} create={props.create ?? rpc.create} onCreated={() => router.refresh()} />
    </>
  );
}
