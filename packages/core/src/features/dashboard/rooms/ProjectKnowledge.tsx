'use client';

/**
 * The project's own knowledge, editable in place: its Instructions (`rules`)
 * and its Wiki (`notes`, the client wiki). The agent maintains both through
 * `update_project`; a person edits them here without a chat turn. Two
 * sections, one editor: the page puts Brand & guidelines between them. Plain
 * textareas on purpose (the same call `MarkdownArtifactEditor` made): prose,
 * not code. Saving PATCHes the project and refreshes the page, so what the
 * agent reads next is what is on screen.
 */

import { Pencil } from 'lucide-react';
import { useState, useTransition } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Section } from '@/components/patterns';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { useRouter } from '@/libs/I18nNavigation';
import { PUBLISH_TARGET_EXAMPLE, publishTargetProblems } from './publishTargetEdit';

async function patchProject(projectId: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/v1/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    // The server's own sentence, where the person is editing (a target's schema problem names the field).
    const said = await res.json().then((b: { error?: { message?: string } }) => b.error?.message, () => undefined);
    throw new Error(said ? `Not saved: ${said}` : `save failed (${res.status})`);
  }
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground" aria-label={label}>
      <Pencil className="size-3" aria-hidden />
      Edit
    </button>
  );
}

function Editor({ value, onChange, onSave, onCancel, busy, placeholder, mono }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; busy: boolean; placeholder: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        disabled={busy}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        spellCheck
        className={`min-h-40 w-full resize-y rounded-lg border border-border bg-background p-3 text-[13px] leading-6 text-foreground focus:border-foreground/30 focus:outline-none ${mono ? 'font-mono' : ''}`}
      />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <button type="button" onClick={onSave} disabled={busy} className={buttonVariants({ size: 'sm' })}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex h-7 items-center rounded-md px-2 text-xs hover:bg-surface-hover">Cancel</button>
        <span>⌘S saves · Esc discards</span>
      </div>
    </div>
  );
}

/**
 * Edit state for one field of the project: open or not, saving or not, the
 * last error. Saving refreshes the page so the agent reads what is shown.
 * @param projectId - The project.
 */
function useProjectField(projectId: number) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (body: Record<string, unknown>) => start(async () => {
    try {
      await patchProject(projectId, body);
      setEditing(false);
      setError(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return { busy, editing, setEditing, error, save };
}

/**
 * The project's Instructions: one line each, read by the agent before
 * anything else in the project (`rules`).
 * @param props
 * @param props.projectId - The project.
 * @param props.rules - Its instructions.
 */
export function ProjectInstructions({ projectId, rules }: { projectId: number; rules: string[] }) {
  const field = useProjectField(projectId);
  const [draft, setDraft] = useState(rules.join('\n'));
  const cancel = () => {
    setDraft(rules.join('\n'));
    field.setEditing(false);
  };
  return (
    <Section eyebrow="Instructions" action={field.editing ? null : <EditButton label="Edit instructions" onClick={() => field.setEditing(true)} />} data-testid="room-rules">
      {field.editing
        ? (
            <Editor
              value={draft}
              onChange={setDraft}
              busy={field.busy}
              placeholder="One instruction per line: how things are called, the voice to write in, what files here, what never leaves the project."
              onSave={() => field.save({ rules: draft.split('\n').map(s => s.trim()).filter(Boolean) })}
              onCancel={cancel}
            />
          )
        : rules.length === 0
          ? <p className="text-sm text-muted-foreground">No instructions yet. Terminology, voice, what files here, conventions the client stated. The agent reads them before anything else in the project.</p>
          : (
              <ul className="space-y-1 text-sm text-foreground">
                {rules.map(r => (
                  <li key={r} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
      {field.error && <p className="mt-2 text-xs text-destructive">{field.error}</p>}
    </Section>
  );
}

/**
 * The project's Wiki: the client wiki in markdown (`notes`).
 * @param props
 * @param props.projectId - The project.
 * @param props.notes - Its wiki.
 */
export function ProjectWiki({ projectId, notes }: { projectId: number; notes: string }) {
  const field = useProjectField(projectId);
  const [draft, setDraft] = useState(notes);
  const cancel = () => {
    setDraft(notes);
    field.setEditing(false);
  };
  return (
    <Section eyebrow="Wiki" action={field.editing ? null : <EditButton label="Edit wiki" onClick={() => field.setEditing(true)} />} data-testid="room-notes">
      {field.editing
        ? (
            <Editor
              value={draft}
              onChange={setDraft}
              busy={field.busy}
              mono
              placeholder="The client wiki, in markdown: where things are, who owns what, what the client calls things."
              onSave={() => field.save({ notes: draft })}
              onCancel={cancel}
            />
          )
        : notes.trim()
          ? (
              <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
              </div>
            )
          : <p className="text-sm text-muted-foreground">No wiki yet. The agent writes it as it learns the client; you can start it here.</p>}
      {field.error && <p className="mt-2 text-xs text-destructive">{field.error}</p>}
    </Section>
  );
}

type Target = { id: string; kind: 'github' | 'squarespace' | 'wordpress'; label?: string; config?: Record<string, unknown> };

/** A target learned from the site's own posts, waiting on a person (`publishTargetSuggestion`). */
export type TargetSuggestion = { target: Target; replaces: string | null; repo: string; read: string[]; notes: string[] };

/**
 * Where the project's pages ship, how the SEO app releases them, and how many
 * new pages a month it proposes on its own: a person's settings, set here and
 * nowhere else — an agent's write to any of them is refused
 * (`PERSON_ONLY_FIELDS`). The same edit-in-place as Instructions and Wiki.
 * The gate and the cadence show only where the SEO app is on. A target
 * learned from the site's own posts waits here for the person to apply or
 * dismiss.
 * @param props
 * @param props.projectId - The project.
 * @param props.gate - Its `seoGate`, when set.
 * @param props.cadence - Its `seoCadence`, when set.
 * @param props.targets - Its publish targets.
 * @param props.lines - Each target in words, by id (`publishTargetLine`).
 * @param props.showGate - The SEO app is on in this workspace.
 * @param props.suggestion - A target learned from the site's posts, waiting on a person.
 */
export function ProjectPublishing({ projectId, gate, cadence, targets, lines, showGate, suggestion = null }: { projectId: number; gate: { sample?: number; tranche?: number } | null; cadence?: { pagesPerMonth: number; focus?: string } | null; targets: Target[]; lines: Record<string, string>; showGate: boolean; suggestion?: TargetSuggestion | null }) {
  const field = useProjectField(projectId);
  const [sample, setSample] = useState(String(gate?.sample ?? 3));
  const [tranche, setTranche] = useState(String(gate?.tranche ?? 10));
  const [perMonth, setPerMonth] = useState(cadence ? String(cadence.pagesPerMonth) : '');
  const [focus, setFocus] = useState(cadence?.focus ?? '');
  const [json, setJson] = useState(targets.length > 0 ? JSON.stringify(targets, null, 2) : '');
  const [problem, setProblem] = useState<string | null>(null);
  if (!showGate && targets.length === 0 && !field.editing && !suggestion) {
    return null;
  }
  // Read as it is typed: what the server would refuse, said under the editor before Save.
  const problems = field.editing ? publishTargetProblems(json) : [];
  const cancel = () => {
    setSample(String(gate?.sample ?? 3));
    setTranche(String(gate?.tranche ?? 10));
    setPerMonth(cadence ? String(cadence.pagesPerMonth) : '');
    setFocus(cadence?.focus ?? '');
    setJson(targets.length > 0 ? JSON.stringify(targets, null, 2) : '');
    setProblem(null);
    field.setEditing(false);
  };
  const save = () => {
    const s = Number(sample);
    const t = Number(tranche);
    if (showGate && (![s, t].every(n => Number.isInteger(n) && n >= 1 && n <= 100))) {
      setProblem('Sample and tranche are whole numbers from 1 to 100.');
      return;
    }
    // Empty pages a month is no cadence: nothing is proposed on its own.
    const monthly = perMonth.trim() === '' ? 0 : Number(perMonth);
    if (showGate && !(Number.isInteger(monthly) && monthly >= 0 && monthly <= 200)) {
      setProblem('Pages a month is a whole number from 1 to 200, or empty for none.');
      return;
    }
    if (problems.length > 0) {
      setProblem(null);
      return;
    }
    setProblem(null);
    field.save({
      ...(showGate
        ? {
            seoGate: { sample: s, tranche: t },
            seoCadence: monthly > 0 ? { pagesPerMonth: monthly, ...(focus.trim() ? { focus: focus.trim() } : {}) } : null,
          }
        : {}),
      publishTargets: json.trim() ? JSON.parse(json) : [],
    });
  };
  const apply = () => {
    if (!suggestion) {
      return;
    }
    const next = suggestion.replaces ? targets.map(t => (t.id === suggestion.replaces ? suggestion.target : t)) : [...targets, suggestion.target];
    field.save({ publishTargets: next, publishTargetSuggestion: null });
  };
  const input = 'h-7 w-16 rounded-md border border-border bg-background px-2 text-sm tabular-nums focus:border-foreground/30 focus:outline-none';
  return (
    <Section eyebrow="Publishing" tone="quiet" action={field.editing ? null : <EditButton label="Edit publishing" onClick={() => field.setEditing(true)} />} data-testid="project-publishes-to">
      {field.editing
        ? (
            <div className="flex flex-col gap-3 text-sm">
              {showGate && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    Sample
                    <input type="number" min={1} max={100} value={sample} onChange={e => setSample(e.target.value)} className={input} aria-label="Sample size" />
                  </label>
                  <label className="flex items-center gap-1.5">
                    then
                    <input type="number" min={1} max={100} value={tranche} onChange={e => setTranche(e.target.value)} className={input} aria-label="Tranche size" />
                    pages
                  </label>
                </div>
              )}
              {showGate && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    New pages a month
                    <input type="number" min={0} max={200} value={perMonth} placeholder="none" onChange={e => setPerMonth(e.target.value)} className={input} aria-label="New pages a month" />
                  </label>
                  <label className="flex min-w-0 flex-1 items-center gap-1.5">
                    on
                    <input type="text" maxLength={200} value={focus} placeholder="any topic" onChange={e => setFocus(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm focus:border-foreground/30 focus:outline-none" aria-label="Topic focus" />
                  </label>
                </div>
              )}
              <Editor value={json} onChange={setJson} onSave={save} onCancel={cancel} busy={field.busy} mono placeholder={PUBLISH_TARGET_EXAMPLE} />
              {problems.length > 0 && (
                <ul className="space-y-0.5 text-xs text-destructive" data-testid="publish-target-problems">
                  {problems.map(p => <li key={p}>{p}</li>)}
                </ul>
              )}
            </div>
          )
        : (
            <div className="space-y-1 text-sm">
              {showGate && (
                <p className="text-foreground">
                  {`SEO pages: a sample of ${gate?.sample ?? 3} for your sign-off, then ${gate?.tranche ?? 10} at a time`}
                  {gate ? null : <span className="text-muted-foreground"> (the default)</span>}
                </p>
              )}
              {showGate && (
                <p className={cadence ? 'text-foreground' : 'text-muted-foreground'} data-testid="project-seo-cadence">
                  {cadence
                    ? `New page opportunities: ${cadence.pagesPerMonth} a month${cadence.focus ? ` on ${cadence.focus}` : ''}, proposed weekly for your sign-off`
                    : 'No pages a month set: none are proposed on their own'}
                </p>
              )}
              {targets.length === 0
                ? <p className="text-muted-foreground">Publishes nowhere yet.</p>
                // The line already carries the label: said once.
                : targets.map(t => <p key={t.id}>{lines[t.id] ?? t.label ?? t.kind}</p>)}
            </div>
          )}
      {suggestion && !field.editing && (
        <div className="mt-3 border-t border-rule pt-3 text-sm" data-testid="publish-target-suggestion">
          <p className="text-foreground">{`Learned from ${suggestion.read.length} ${suggestion.read.length === 1 ? 'post' : 'posts'} in ${suggestion.repo}: ${Object.keys((suggestion.target.config?.frontmatter ?? {}) as Record<string, unknown>).length} frontmatter keys, path ${String(suggestion.target.config?.path ?? '')}.`}</p>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-surface-soft p-2 font-mono text-[12px]">{JSON.stringify(suggestion.target.config?.frontmatter ?? {}, null, 2)}</pre>
          {suggestion.notes.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{`To check: ${suggestion.notes.join(' ')}`}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={apply} disabled={field.busy} className={buttonVariants({ size: 'sm' })}>{suggestion.replaces ? `Apply to ${suggestion.replaces}` : 'Add this target'}</button>
            <button type="button" onClick={() => field.save({ publishTargetSuggestion: null })} disabled={field.busy} className="inline-flex h-7 items-center rounded-md px-2 text-xs hover:bg-surface-hover">Dismiss</button>
          </div>
        </div>
      )}
      {(problem ?? field.error) && <p className="mt-2 text-xs text-destructive">{problem ?? field.error}</p>}
    </Section>
  );
}
