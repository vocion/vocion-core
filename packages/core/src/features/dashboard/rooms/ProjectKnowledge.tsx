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

async function patchProject(projectId: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/v1/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`save failed (${res.status})`);
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
