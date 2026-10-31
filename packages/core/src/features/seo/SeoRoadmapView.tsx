'use client';

import type { SeoRoadmap } from '@/services/seo/roadmap';
import { ArrowRight, CheckCircle2, Flag, Plus, Target } from 'lucide-react';
import { useState, useTransition } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Link, useRouter } from '@/libs/I18nNavigation';

type Initiative = SeoRoadmap['initiatives'][number];
type Outcome = SeoRoadmap['outcomes'][number];
type RecordOption = { id: number; title: string; status: string | null; href: string };
const inputStyle = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const lanes = ['now', 'next', 'later'] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/**
 * Editable execution plan; completion and outcome evidence remain distinct.
 * @param root0
 * @param root0.projectId
 * @param root0.initial
 * @param root0.canEdit
 * @param root0.records
 * @param root0.tasks
 * @param root0.owners
 * @param root0.suggestion
 * @param root0.suggestion.label
 * @param root0.suggestion.rationale
 * @param root0.suggestion.evidence
 */
export function SeoRoadmapView({ projectId, initial, canEdit, records, tasks = [], owners, suggestion }: {
  projectId: number;
  initial: SeoRoadmap;
  canEdit: boolean;
  records: RecordOption[];
  tasks?: RecordOption[];
  owners: Array<{ id: string; name: string }>;
  suggestion?: { label: string; rationale: string; evidence: Array<{ label: string; url: string }> };
}) {
  const router = useRouter();
  const [roadmap, setRoadmap] = useState(initial);
  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const done = roadmap.initiatives.filter(i => i.status === 'done').length;
  const blocked = roadmap.initiatives.filter(i => i.status === 'blocked' || i.blockedReason).length;
  const save = (next: SeoRoadmap) => start(async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/seo/projects/${projectId}/roadmap`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: roadmap.revision, roadmap: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || 'Roadmap could not be saved.');
      }
      setRoadmap(body.roadmap);
      setInitiative(null);
      setOutcome(null);
      setNotice('Roadmap saved. Publishing and strategy approval keep their existing review steps.');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  const addInitiative = (fromSuggestion = false) => {
    setOutcome(null);
    setInitiative({ id: crypto.randomUUID(), label: fromSuggestion ? suggestion?.label ?? '' : '', lane: 'now', status: 'planned', dependsOn: [], recordIds: [], taskIds: [], evidence: fromSuggestion ? suggestion?.evidence ?? [] : [], acceptanceCriteria: '', ...(fromSuggestion ? { rationale: suggestion?.rationale } : {}) });
  };
  const setI = <K extends keyof Initiative>(key: K, value: Initiative[K]) => setInitiative(i => i ? { ...i, [key]: value } : i);
  const setO = <K extends keyof Outcome>(key: K, value: Outcome[K]) => setOutcome(o => o ? { ...o, [key]: value } : o);
  return (
    <div className="space-y-8" data-testid="seo-roadmap">
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Execution roadmap</p>
            <h2 className="mt-2 text-2xl font-semibold">What moves this client forward</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Prioritize the work, resolve dependencies, and verify delivery. Track the client’s results separately below.</p>
          </div>
          {canEdit && (
            <button type="button" className={buttonVariants({ variant: 'outline' })} onClick={() => addInitiative()}>
              <Plus className="mr-2 size-4" />
              Add initiative
            </button>
          )}
        </div>
        <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
          <div>
            <dt className="text-xs text-muted-foreground">Delivery complete</dt>
            <dd className="mt-1 text-2xl font-semibold">
              {done}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}
                /
                {roadmap.initiatives.length}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Blocked initiatives</dt>
            <dd className="mt-1 text-2xl font-semibold">{blocked}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Outcome measures</dt>
            <dd className="mt-1 text-2xl font-semibold">{roadmap.outcomes.length}</dd>
          </div>
        </dl>
      </section>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          {error}
          {' '}
          Your edits are still here.
        </p>
      )}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {suggestion && canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
          <div>
            <p className="text-xs text-muted-foreground">From the audit</p>
            <p className="mt-1 font-medium">{suggestion.label}</p>
          </div>
          <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => addInitiative(true)}>Plan this finding</button>
        </div>
      )}
      {!canEdit && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">The approved strategy owner manages this roadmap. If no strategy is approved yet, set the client’s goal first.</p>}
      {initiative && (
        <form
          className="space-y-4 rounded-xl border border-primary/30 bg-card p-5"
          aria-label="Edit initiative"
          onSubmit={(e) => {
            e.preventDefault();
            save({ ...roadmap, initiatives: [...roadmap.initiatives.filter(i => i.id !== initiative.id), initiative] });
          }}
        >
          <h3 className="text-lg font-semibold">Plan an executable initiative</h3>
          <Field label="Initiative"><input required value={initiative.label} onChange={e => setI('label', e.target.value)} className={inputStyle} /></Field>
          <Field label="Why this matters"><textarea value={initiative.rationale ?? ''} onChange={e => setI('rationale', e.target.value)} className={inputStyle} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="When"><select value={initiative.lane} onChange={e => setI('lane', e.target.value as Initiative['lane'])} className={inputStyle}>{lanes.map(l => <option key={l} value={l}>{l}</option>)}</select></Field>
            <Field label="Owner">
              <select aria-label="Owner" value={initiative.ownerUserId ?? ''} onChange={e => setI('ownerUserId', e.target.value || undefined)} className={inputStyle}>
                <option value="">Unassigned</option>
                {owners.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input type="date" value={initiative.due ?? ''} onChange={e => setI('due', e.target.value || undefined)} className={inputStyle} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status"><select value={initiative.status} onChange={e => setI('status', e.target.value as Initiative['status'])} className={inputStyle}>{['planned', 'in_progress', 'blocked', 'done'].map(s => <option value={s} key={s}>{s.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Estimated effort"><input value={initiative.effort ?? ''} onChange={e => setI('effort', e.target.value)} placeholder="Unknown until scoped" className={inputStyle} /></Field>
          </div>
          <Field label="Acceptance criteria"><textarea required value={initiative.acceptanceCriteria ?? ''} onChange={e => setI('acceptanceCriteria', e.target.value)} placeholder="What evidence will show this work is complete?" className={inputStyle} /></Field>
          <Field label="Next action"><input value={initiative.nextAction ?? ''} onChange={e => setI('nextAction', e.target.value)} className={inputStyle} /></Field>
          <Field label="Blocker"><input value={initiative.blockedReason ?? ''} onChange={e => setI('blockedReason', e.target.value || undefined)} className={inputStyle} /></Field>
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Depends on</legend>
            <div className="space-y-2">
              {roadmap.initiatives.filter(i => i.id !== initiative.id).map(i => (
                <label key={i.id} className="flex gap-2 text-sm">
                  <input type="checkbox" checked={initiative.dependsOn.includes(i.id)} onChange={e => setI('dependsOn', e.target.checked ? [...initiative.dependsOn, i.id] : initiative.dependsOn.filter(id => id !== i.id))} />
                  {i.label}
                </label>
              ))}
              {roadmap.initiatives.length < 2 && <p className="text-xs text-muted-foreground">No other initiatives to depend on yet.</p>}
            </div>
          </fieldset>
          <fieldset className="max-h-64 overflow-y-auto rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Linked execution work</legend>
            <div className="space-y-2">
              {records.map(r => (
                <label key={r.id} className="flex gap-2 text-sm">
                  <input type="checkbox" checked={initiative.recordIds.includes(r.id)} onChange={e => setI('recordIds', e.target.checked ? [...initiative.recordIds, r.id] : initiative.recordIds.filter(id => id !== r.id))} />
                  {r.title}
                  <span className="text-muted-foreground">{r.status?.replace('_', ' ')}</span>
                </label>
              ))}
              {tasks.map(t => (
                <label key={`task-${t.id}`} className="flex gap-2 text-sm">
                  <input type="checkbox" checked={initiative.taskIds.includes(t.id)} onChange={e => setI('taskIds', e.target.checked ? [...initiative.taskIds, t.id] : initiative.taskIds.filter(id => id !== t.id))} />
                  {t.title}
                  <span className="text-muted-foreground">{t.status?.replace('_', ' ')}</span>
                </label>
              ))}
              {!records.length && !tasks.length && <p className="text-xs text-muted-foreground">No execution records yet. Save the initiative, then ask the strategist to start its work.</p>}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button disabled={busy} className={buttonVariants()}>{busy ? 'Saving…' : 'Save initiative'}</button>
            <button disabled={busy} type="button" className={buttonVariants({ variant: 'ghost' })} onClick={() => setInitiative(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="space-y-7">
        {lanes.map(lane => (
          <section key={lane} aria-label={`${lane} initiatives`}>
            <div className="mb-3 flex items-center gap-2">
              <Flag className="size-4 text-muted-foreground" />
              <h3 className="text-base font-semibold capitalize">{lane}</h3>
              <span className="text-xs text-muted-foreground">{roadmap.initiatives.filter(i => i.lane === lane).length}</span>
            </div>
            <div className="space-y-3">
              {roadmap.initiatives.filter(i => i.lane === lane).map((i) => {
                const dependencies = i.dependsOn.map(id => roadmap.initiatives.find(d => d.id === id)).filter(d => d && d.status !== 'done');
                return (
                  <article key={i.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          {i.status.replace('_', ' ')}
                          {i.due ? ` · Due ${i.due}` : ' · No due date'}
                          {' '}
                          ·
                          {owners.find(o => o.id === i.ownerUserId)?.name ?? 'Unassigned'}
                        </p>
                        <h4 className="mt-2 text-lg font-semibold">{i.label}</h4>
                      </div>
                      {i.status === 'done' && <CheckCircle2 className="size-5 shrink-0 text-primary" />}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            setOutcome(null);
                            setInitiative(i);
                          }}
                          className="text-sm font-medium underline underline-offset-4"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {i.rationale && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{i.rationale}</p>}
                    {(i.blockedReason || dependencies.length > 0) && <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm">{i.blockedReason || `Waiting for: ${dependencies.map(d => d!.label).join(', ')}`}</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {i.recordIds.map((id) => {
                        const record = records.find(r => r.id === id);
                        return record
                          ? (
                              <Link key={id} href={record.href} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                                {record.title}
                                <span className="ml-2 text-xs text-muted-foreground">{record.status?.replace('_', ' ')}</span>
                              </Link>
                            )
                          : <span key={id} className="text-xs text-muted-foreground">Linked work unavailable</span>;
                      })}
                    </div>
                    {i.taskIds.map((id) => {
                      const task = tasks.find(t => t.id === id);
                      return task
                        ? (
                            <Link key={`task-${id}`} href={task.href} className="inline-flex rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                              {task.title}
                              <span className="ml-2 text-xs text-muted-foreground">{task.status}</span>
                            </Link>
                          )
                        : <span key={`task-${id}`} className="text-xs text-muted-foreground">Linked task unavailable</span>;
                    })}
                    {!i.recordIds.length && !i.taskIds.length && <p className="mt-3 text-xs text-muted-foreground">Execution work not linked yet.</p>}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Next: </span>
                        {i.nextAction || (i.status === 'done' ? 'Review outcome evidence' : 'Define or continue the linked work')}
                      </p>
                      <Link href={`/dashboard/chat?app=seo&ask=${encodeURIComponent(`Read the SEO roadmap for project ${projectId}. Work on initiative ${i.id}: ${i.label}. Check its dependencies and existing linked work first; link any created work back to this initiative. Preserve publishing and approval gates.`)}`} className="inline-flex items-center gap-1 text-sm font-medium">
                        {i.recordIds.length + i.taskIds.length ? 'Continue with strategist' : 'Start with strategist'}
                        <ArrowRight className="size-4" />
                      </Link>
                    </div>
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-muted-foreground">Success criteria & evidence</summary>
                      <p className="mt-2">{i.acceptanceCriteria || 'Acceptance criteria not defined yet.'}</p>
                      {i.effort && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Estimated effort:
                          {i.effort}
                        </p>
                      )}
                      <ul className="mt-2 space-y-1">{i.evidence.map(e => <li key={e.url}><Link href={e.url} className="underline underline-offset-4">{e.label}</Link></li>)}</ul>
                    </details>
                  </article>
                );
              })}
              {!roadmap.initiatives.some(i => i.lane === lane) && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{lane === 'now' ? 'Choose the next initiative from the audit or your client’s priorities.' : 'Nothing scheduled here yet.'}</p>}
            </div>
          </section>
        ))}
      </div>
      <section className="space-y-4 border-t border-border pt-7" aria-label="Client outcomes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <Target className="size-5" />
              Client outcomes
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Completed work does not prove impact. Record the baseline, target, source, and observation window.</p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setInitiative(null);
                setOutcome({ id: crypto.randomUUID(), label: '', unit: '' });
              }}
              className={buttonVariants({ variant: 'outline' })}
            >
              Add measure
            </button>
          )}
        </div>
        {roadmap.outcomes.map(o => (
          <article key={o.id} className="rounded-xl border border-border p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{o.label}</h3>
              {canEdit && (
                <button
                  type="button"
                  className="text-sm underline underline-offset-4"
                  onClick={() => {
                    setInitiative(null);
                    setOutcome(o);
                  }}
                >
                  Update evidence
                </button>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-4">
              {[{ label: 'Baseline', value: o.source && o.baselineWindowStart && o.baselineWindowEnd && o.baselineObservedAt ? o.baseline : undefined }, { label: 'Current', value: o.source && o.observedAt && o.windowStart && o.windowEnd ? o.current : undefined }, { label: 'Target', value: o.target }].map(m => (
                <div key={m.label}>
                  <dt className="text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="mt-1 text-lg font-semibold">{m.value === undefined ? 'Not measured' : `${m.value} ${o.unit}`}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {o.source || 'Source not recorded'}
              {' '}
              ·
              {' '}
              {o.observedAt ? `Observed ${o.observedAt.slice(0, 10)}` : 'No observation date'}
              {o.windowStart && o.windowEnd ? ` · ${o.windowStart} to ${o.windowEnd}` : ' · Comparison window not set'}
            </p>
            {o.baselineWindowStart && o.baselineWindowEnd && <p className="mt-1 text-xs text-muted-foreground">{`Baseline window: ${o.baselineWindowStart} to ${o.baselineWindowEnd}`}</p>}
          </article>
        ))}
        {!roadmap.outcomes.length && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No outcome baseline yet. Define what success means before interpreting completed tasks as client results.</p>}
        {outcome && (
          <form
            aria-label="Edit outcome measure"
            className="space-y-4 rounded-xl border border-primary/30 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              save({ ...roadmap, outcomes: [...roadmap.outcomes.filter(o => o.id !== outcome.id), outcome] });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Measure"><input required className={inputStyle} value={outcome.label} onChange={e => setO('label', e.target.value)} /></Field>
              <Field label="Unit"><input required className={inputStyle} value={outcome.unit} onChange={e => setO('unit', e.target.value)} placeholder="Qualified leads, clicks, percent…" /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">{(['baseline', 'current', 'target'] as const).map(k => <Field key={k} label={k}><input type="number" step="any" className={inputStyle} value={outcome[k] ?? ''} onChange={e => setO(k, e.target.value === '' ? undefined : Number(e.target.value))} /></Field>)}</div>
            <Field label="Evidence source"><input className={inputStyle} value={outcome.source ?? ''} onChange={e => setO('source', e.target.value)} placeholder="Source report or connected property" /></Field>
            <div className="grid gap-4 sm:grid-cols-3">{(['windowStart', 'windowEnd', 'observedAt'] as const).map(k => <Field key={k} label={k === 'windowStart' ? 'Window starts' : k === 'windowEnd' ? 'Window ends' : 'Observed on'}><input type="date" className={inputStyle} value={outcome[k]?.slice(0, 10) ?? ''} onChange={e => setO(k, e.target.value ? (k === 'observedAt' ? `${e.target.value}T00:00:00.000Z` : e.target.value) : undefined)} /></Field>)}</div>
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium">Original baseline evidence</legend>
              <div className="grid gap-4 sm:grid-cols-3">{(['baselineWindowStart', 'baselineWindowEnd', 'baselineObservedAt'] as const).map(k => <Field key={k} label={k === 'baselineWindowStart' ? 'Baseline starts' : k === 'baselineWindowEnd' ? 'Baseline ends' : 'Baseline observed on'}><input type="date" className={inputStyle} value={outcome[k]?.slice(0, 10) ?? ''} onChange={e => setO(k, e.target.value ? (k === 'baselineObservedAt' ? `${e.target.value}T00:00:00.000Z` : e.target.value) : undefined)} /></Field>)}</div>
            </fieldset>
            <div className="flex gap-2">
              <button disabled={busy} className={buttonVariants()}>{busy ? 'Saving…' : 'Save measure'}</button>
              <button type="button" disabled={busy} className={buttonVariants({ variant: 'ghost' })} onClick={() => setOutcome(null)}>Cancel</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
