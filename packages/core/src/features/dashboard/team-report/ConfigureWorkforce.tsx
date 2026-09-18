'use client';

import type { MeasureSource, MeasureWindow } from '@/libs/workspace/schemas';
import type { PlannedFile } from '@/services/team-report';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { client } from '@/libs/Orpc';

export type ConfigureTeamSeed = { slug: string; name: string; mission: string | null; hasMeasure: boolean };

/**
 * What the "Measured by" select offers. Flatter than `MeasureSource['kind']`
 * because `verified` is a choice of CONNECTOR as much as of kind: reading
 * HubSpot and reading web analytics are the same strength of evidence and two
 * entirely different forms, so the select names the system rather than making
 * a person pick "verified" and then pick again.
 */
type SourceChoice = 'verified-hubspot' | 'verified-web-analytics' | 'observed' | 'observed-members' | 'human-confirmed' | 'agent-reported';

type TeamDraft = {
  slug: string;
  name: string;
  mission: string;
  configure: boolean;
  label: string;
  target: string;
  unit: string;
  window: MeasureWindow;
  kind: SourceChoice;
  /** agent-reported / observed(counts): the counts key. */
  counts: string;
  /** observed / human-confirmed: action ids, comma-separated. */
  actions: string;
  /** verified-hubspot: object + stage filter + aggregate. */
  object: 'deals' | 'contacts' | 'companies';
  stages: string;
  aggregate: 'count' | 'sum(amount)';
  /** verified-web-analytics: which figure, and the predicates narrowing it. */
  metric: 'sessions' | 'users' | 'conversions' | 'signups';
  pathPrefix: string;
  channel: string;
  event: string;
};

const SOURCE_HELP: Record<SourceChoice, string> = {
  'verified-hubspot': 'Read from HubSpot — the strongest evidence. Counts (or sums) synced records created in the window.',
  'verified-web-analytics': 'Read from Google Analytics. Needs an analytics credential on this workspace; without one the measure reads "not connected" rather than zero.',
  'observed': 'Vocion saw the action execute — count of executed actions, or of completed runs carrying a counts key.',
  'observed-members': 'People who joined this workspace in the window, as the account records it. No connector and nothing to configure.',
  'human-confirmed': 'A person approved it — approve/edit decisions on the named action kinds.',
  'agent-reported': 'The worker reports a count. Weakest — nothing independent confirms it.',
};

function draftFor(t: ConfigureTeamSeed): TeamDraft {
  return { slug: t.slug, name: t.name, mission: t.mission ?? '', configure: !t.hasMeasure, label: '', target: '', unit: '', window: '7d', kind: 'human-confirmed', counts: '', actions: '', object: 'deals', stages: '', aggregate: 'count', metric: 'sessions', pathPrefix: '', channel: '', event: '' };
}

function sourceOf(d: TeamDraft): MeasureSource {
  const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  switch (d.kind) {
    case 'agent-reported':
      return { kind: 'agent-reported', counts: d.counts.trim() };
    case 'observed':
      return d.counts.trim() ? { kind: 'observed', counts: d.counts.trim() } : { kind: 'observed', actions: list(d.actions) };
    case 'observed-members':
      return { kind: 'observed', rows: 'workspace-members' };
    case 'human-confirmed':
      return { kind: 'human-confirmed', actions: list(d.actions) };
    case 'verified-hubspot': {
      const stages = list(d.stages);
      const filter = d.object === 'deals' ? { dealStages: stages.length ? stages : undefined } : d.object === 'contacts' ? { lifecycleStages: stages.length ? stages : undefined } : { industries: stages.length ? stages : undefined };
      return { kind: 'verified', connector: 'hubspot', query: { object: d.object, filter, aggregate: d.aggregate } };
    }
    case 'verified-web-analytics': {
      const text = (s: string) => (s.trim() === '' ? undefined : s.trim());
      return { kind: 'verified', connector: 'web-analytics', query: { metric: d.metric, filter: { pathPrefix: text(d.pathPrefix), channel: text(d.channel), event: text(d.event) } } };
    }
  }
}

/**
 * The guided form behind "Configure workforce" (spec §10–§11): the workspace
 * outcome, then per team a mission and one primary outcome measure with a
 * target and a source kind. Step two shows the YAML the workspace-as-code
 * path will hold; it applies when this host has the workspace folder,
 * otherwise it hands over the YAML to copy. No file paths in the form
 * itself — those are behind Advanced.
 * @param props
 * @param props.goal
 * @param props.teams
 * @param props.isAdmin
 */
export function ConfigureWorkforce({ goal, teams, isAdmin }: { goal: string | null; teams: ConfigureTeamSeed[]; isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'review' | 'done'>('form');
  const [goalDraft, setGoalDraft] = useState(goal ?? '');
  const [drafts, setDrafts] = useState<TeamDraft[]>(teams.map(draftFor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ files: PlannedFile[]; canApply: boolean } | null>(null);
  const [written, setWritten] = useState<string[]>([]);

  const update = (slug: string, patch: Partial<TeamDraft>) => setDrafts(ds => ds.map(d => (d.slug === slug ? { ...d, ...patch } : d)));

  const input = () => ({
    goal: goalDraft.trim() || undefined,
    teams: drafts.map(d => ({
      slug: d.slug,
      mission: d.mission.trim() || undefined,
      measure: d.configure && d.label.trim()
        ? { label: d.label.trim(), target: Number(d.target), unit: d.unit.trim() || undefined, window: d.window, source: sourceOf(d) }
        : undefined,
    })),
  });

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await client.teamReport.planConfig(input()));
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not plan the change.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    // One toast for the write, the app's one notification surface (#351):
    // pending while the workspace applies, the outcome in its place.
    const id = toast.pending('Applying to the workspace…');
    try {
      const r = await client.teamReport.applyConfig(input());
      setWritten(r.written);
      if (r.applied.errors.length > 0) {
        const detail = r.applied.errors.map(e => `${e.resource} ${e.slug}: ${e.message}`).join('; ');
        setError(detail);
        toast.update(id, 'error', 'Applied with errors', { description: detail });
      } else {
        toast.update(id, 'success', r.written.length === 0 ? 'Nothing needed to change' : `Workforce configured · ${r.written.length} file${r.written.length === 1 ? '' : 's'} written`);
      }
      setStep('done');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not apply the change.';
      setError(message);
      toast.update(id, 'error', 'Could not apply the change', { description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Configure workforce</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configure workforce</DialogTitle>
          <DialogDescription>
            {step === 'form' && 'What this workspace exists to cause, and what each team is measured on.'}
            {step === 'review' && (plan?.canApply ? 'Review the change. Applying writes it to the workspace and refreshes the report.' : 'Write-back is not available on this host — copy the YAML into the workspace repo and apply it there.')}
            {step === 'done' && 'Applied. The report reads the new measures on the next load.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void review();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cw-goal">Workspace outcome</Label>
              <Input id="cw-goal" value={goalDraft} onChange={e => setGoalDraft(e.target.value)} placeholder="Create $1.5M of qualified pipeline this quarter." />
              <p className="text-xs text-muted-foreground">One sentence. Every team's outcome rolls up to this.</p>
            </div>

            {drafts.map(d => (
              <fieldset key={d.slug} className="space-y-3 border-t border-border pt-4">
                <legend className="text-sm font-semibold">{d.name}</legend>
                <div className="space-y-1.5">
                  <Label htmlFor={`cw-${d.slug}-mission`}>Mission</Label>
                  <Input id={`cw-${d.slug}-mission`} value={d.mission} onChange={e => update(d.slug, { mission: e.target.value })} placeholder="Turn the founder network into qualified introductions." />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={d.configure} onChange={e => update(d.slug, { configure: e.target.checked })} className="size-3.5" />
                  Set a primary outcome measure
                </label>
                {d.configure && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`cw-${d.slug}-label`}>Primary outcome</Label>
                      <Input id={`cw-${d.slug}-label`} required value={d.label} onChange={e => update(d.slug, { label: e.target.value })} placeholder="Qualified referrals" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`cw-${d.slug}-target`}>Target</Label>
                      <Input id={`cw-${d.slug}-target`} required type="number" min="0" step="any" value={d.target} onChange={e => update(d.slug, { target: e.target.value })} placeholder="10" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`cw-${d.slug}-unit`}>Unit</Label>
                        <Input id={`cw-${d.slug}-unit`} value={d.unit} onChange={e => update(d.slug, { unit: e.target.value })} placeholder="referrals" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`cw-${d.slug}-window`}>Window</Label>
                        <select id={`cw-${d.slug}-window`} value={d.window} onChange={e => update(d.slug, { window: e.target.value as MeasureWindow })} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
                          <option value="24h">Daily</option>
                          <option value="7d">Weekly</option>
                          <option value="30d">30 days</option>
                          <option value="quarter">Quarter</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`cw-${d.slug}-kind`}>Measured by</Label>
                      <select id={`cw-${d.slug}-kind`} value={d.kind} onChange={e => update(d.slug, { kind: e.target.value as SourceChoice })} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
                        <option value="verified-hubspot">Verified — HubSpot</option>
                        <option value="verified-web-analytics">Verified — Google Analytics</option>
                        <option value="observed">Observed — Vocion saw it happen</option>
                        <option value="observed-members">Observed — people who joined this workspace</option>
                        <option value="human-confirmed">Human-confirmed — a person approved it</option>
                        <option value="agent-reported">Agent-reported — the worker's own count</option>
                      </select>
                      <p className="text-xs text-muted-foreground">{SOURCE_HELP[d.kind]}</p>
                    </div>
                    {d.kind === 'verified-hubspot' && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor={`cw-${d.slug}-object`}>Object</Label>
                          <select id={`cw-${d.slug}-object`} value={d.object} onChange={e => update(d.slug, { object: e.target.value as TeamDraft['object'] })} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
                            <option value="deals">Deals</option>
                            <option value="contacts">Contacts</option>
                            <option value="companies">Companies</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`cw-${d.slug}-agg`}>Aggregate</Label>
                          <select id={`cw-${d.slug}-agg`} value={d.aggregate} onChange={e => update(d.slug, { aggregate: e.target.value as TeamDraft['aggregate'] })} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
                            <option value="count">Count</option>
                            {d.object === 'deals' && <option value="sum(amount)">Sum of amount</option>}
                          </select>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`cw-${d.slug}-stages`}>{d.object === 'deals' ? 'Deal stages' : d.object === 'contacts' ? 'Lifecycle stages' : 'Industries'}</Label>
                          <Input id={`cw-${d.slug}-stages`} value={d.stages} onChange={e => update(d.slug, { stages: e.target.value })} placeholder={d.object === 'deals' ? 'Qualified, Proposal' : d.object === 'contacts' ? 'marketingqualifiedlead' : 'Software'} />
                          <p className="text-xs text-muted-foreground">Comma-separated, as HubSpot names them. Leave empty for all.</p>
                        </div>
                      </>
                    )}
                    {d.kind === 'verified-web-analytics' && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor={`cw-${d.slug}-metric`}>Figure</Label>
                          <select id={`cw-${d.slug}-metric`} value={d.metric} onChange={e => update(d.slug, { metric: e.target.value as TeamDraft['metric'] })} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
                            <option value="sessions">Sessions</option>
                            <option value="users">Users</option>
                            <option value="conversions">Conversions (key events)</option>
                            <option value="signups">Signups (one named event)</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`cw-${d.slug}-channel`}>Channel</Label>
                          <Input id={`cw-${d.slug}-channel`} value={d.channel} onChange={e => update(d.slug, { channel: e.target.value })} placeholder="Organic Search" />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`cw-${d.slug}-path`}>Landing path starts with</Label>
                          <Input id={`cw-${d.slug}-path`} value={d.pathPrefix} onChange={e => update(d.slug, { pathPrefix: e.target.value })} placeholder="/docs" />
                          <p className="text-xs text-muted-foreground">Leave both empty to count every session on the property.</p>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`cw-${d.slug}-event`}>Event name</Label>
                          {/* Required for signups: there is no universal signup event, and guessing one would count the wrong thing without saying so. */}
                          <Input id={`cw-${d.slug}-event`} required={d.metric === 'signups'} value={d.event} onChange={e => update(d.slug, { event: e.target.value })} placeholder="sign_up" />
                        </div>
                      </>
                    )}
                    {(d.kind === 'observed' || d.kind === 'human-confirmed') && (
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor={`cw-${d.slug}-actions`}>Action kinds</Label>
                        <Input id={`cw-${d.slug}-actions`} required={d.kind === 'human-confirmed' || !d.counts} value={d.actions} onChange={e => update(d.slug, { actions: e.target.value })} placeholder="gmail.send, hubspot.update" />
                      </div>
                    )}
                    {(d.kind === 'agent-reported' || d.kind === 'observed') && (
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor={`cw-${d.slug}-counts`}>{d.kind === 'observed' ? 'Or: runs that report this count' : 'Count the worker reports'}</Label>
                        <Input id={`cw-${d.slug}-counts`} required={d.kind === 'agent-reported'} value={d.counts} onChange={e => update(d.slug, { counts: e.target.value })} placeholder="pitches" />
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
            ))}

            {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Review change
              </Button>
            </div>
          </form>
        )}

        {step === 'review' && plan && (
          <div className="space-y-4">
            {plan.files.map(f => <FileDiff key={f.path} file={f} />)}
            {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => setStep('form')}>Back</Button>
              {plan.canApply && isAdmin && (
                <Button type="button" onClick={() => void apply()} disabled={busy || plan.files.every(f => f.unchanged)}>
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Apply to workspace
                </Button>
              )}
              {plan.canApply && !isAdmin && <p className="self-center text-xs text-muted-foreground">Applying needs an admin.</p>}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-sm">
              <Check className="size-4 text-emerald-600" aria-hidden />
              {written.length === 0 ? 'Nothing needed to change.' : `Wrote ${written.length} file${written.length === 1 ? '' : 's'} and applied the workspace.`}
            </p>
            {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
            <div className="flex justify-end">
              <Button type="button" onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileDiff({ file }: { file: PlannedFile }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.after);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable in an insecure context; the text stays selectable.
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-xs text-muted-foreground">{file.path}</code>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {file.unchanged ? 'unchanged' : file.before === null ? 'new file' : 'edited'}
          <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} aria-label={`Copy ${file.path}`}>
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </span>
      </div>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-soft p-3 font-mono text-[12px] leading-relaxed whitespace-pre">{file.after}</pre>
    </div>
  );
}
