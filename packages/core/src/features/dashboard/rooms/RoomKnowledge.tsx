'use client';

/**
 * The room's own knowledge, editable in place: the notes (the wiki) and the
 * rules. The agent maintains both through `update_data_room`; a person edits
 * them here without a chat turn. Plain textareas on purpose (the same call
 * `MarkdownArtifactEditor` made): prose, not code. Saving PATCHes the room
 * and refreshes the page, so what the agent reads next is what is on screen.
 */

import { Pencil } from 'lucide-react';
import { useState, useTransition } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Section } from '@/components/patterns';
import { useRouter } from '@/libs/I18nNavigation';

type Props = { roomId: number; notes: string; rules: string[] };

async function patchRoom(roomId: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/v1/rooms/${roomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
        <button type="button" onClick={onSave} disabled={busy} className="inline-flex h-7 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex h-7 items-center rounded-md px-2 text-xs hover:bg-surface-hover">Cancel</button>
        <span>⌘S saves · Esc discards</span>
      </div>
    </div>
  );
}

export function RoomKnowledge({ roomId, notes, rules }: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState<'notes' | 'rules' | null>(null);
  const [draftNotes, setDraftNotes] = useState(notes);
  const [draftRules, setDraftRules] = useState(rules.join('\n'));
  const [error, setError] = useState<string | null>(null);

  const cancel = (which: 'notes' | 'rules') => {
    if (which === 'rules') {
      setDraftRules(rules.join('\n'));
    } else {
      setDraftNotes(notes);
    }
    setEditing(null);
  };

  const save = (body: Record<string, unknown>) => start(async () => {
    try {
      await patchRoom(roomId, body);
      setEditing(null);
      setError(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <>
      <Section eyebrow="Rules" action={editing === 'rules' ? null : <EditButton label="Edit rules" onClick={() => setEditing('rules')} />} data-testid="room-rules">
        {editing === 'rules'
          ? (
              <Editor
                value={draftRules}
                onChange={setDraftRules}
                busy={busy}
                placeholder="One rule per line — how things are called, what files here, what never leaves the room."
                onSave={() => save({ rules: draftRules.split('\n').map(s => s.trim()).filter(Boolean) })}
                onCancel={() => cancel('rules')}
              />
            )
          : rules.length === 0
            ? <p className="text-sm text-muted-foreground">No rules yet. Terminology, what files here, conventions the client stated — the agent reads them before anything else in the room.</p>
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
      </Section>
      <Section eyebrow="Notes" action={editing === 'notes' ? null : <EditButton label="Edit notes" onClick={() => setEditing('notes')} />} data-testid="room-notes">
        {editing === 'notes'
          ? (
              <Editor
                value={draftNotes}
                onChange={setDraftNotes}
                busy={busy}
                mono
                placeholder={'The room\'s wiki, in markdown: where things are, who owns what, what the client calls things.'}
                onSave={() => save({ notes: draftNotes })}
                onCancel={() => cancel('notes')}
              />
            )
          : notes.trim()
            ? (
                <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
                </div>
              )
            : <p className="text-sm text-muted-foreground">No notes yet. The agent writes the room&apos;s wiki as it learns the engagement; you can start it here.</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </Section>
    </>
  );
}
