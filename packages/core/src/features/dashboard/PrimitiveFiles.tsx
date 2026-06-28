'use client';

import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import CodeMirror from '@uiw/react-codemirror';
import { AlertCircle, Check, FileText, GitBranch, Pencil, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { client } from '@/libs/Orpc';

type PrimitiveFile = {
  path: string;
  fullPath?: string;
  content: string;
  language: 'yaml' | 'markdown' | 'javascript';
};

type Props = {
  files: PrimitiveFile[];
  editInGitPath: string;
  dirty?: boolean;
  dirtyFiles?: string[];
};

const langExtension = {
  yaml: yaml(),
  markdown: markdown(),
  javascript: javascript(),
};

/**
 * Read + edit surface for the files backing a primitive. Tabs per file;
 * Edit toggles the current tab into a CodeMirror editor for that file's
 * language. Save writes to disk via the context.writeFile oRPC route,
 * which also reapplies the context to the DB.
 * @param root0
 * @param root0.files
 * @param root0.editInGitPath
 * @param root0.dirty
 * @param root0.dirtyFiles
 */
export function PrimitiveFiles({ files, editInGitPath, dirty = false, dirtyFiles = [] }: Props) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = files[active];
  if (!current) {
    return null;
  }
  const fileName = current.path.split('/').pop() ?? current.path;
  const canEdit = !!current.fullPath;

  function startEdit() {
    setDraft(current!.content);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft('');
    setError(null);
  }

  function save() {
    if (!current?.fullPath) {
      return;
    }
    const path = current.fullPath;
    const content = draft;
    startTransition(async () => {
      try {
        setError(null);
        await client.context.writeFile({ path, content });
        setEditing(false);
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    });
  }

  const unchanged = editing && draft === current.content;

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex gap-1 overflow-x-auto">
          {files.map((f, i) => {
            const name = f.path.split('/').pop() ?? f.path;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => {
                  if (editing) {
                    return;
                  }
                  setActive(i);
                }}
                disabled={editing && i !== active}
                className={`rounded px-2.5 py-1 text-xs whitespace-nowrap transition ${
                  i === active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="size-3" />
                  {name}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {dirty && !editing && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400"
              title={dirtyFiles.length > 0 ? `Uncommitted changes in ${dirtyFiles.length} file${dirtyFiles.length === 1 ? '' : 's'}:\n${dirtyFiles.slice(0, 10).join('\n')}` : 'Uncommitted changes in workspace repo'}
            >
              <AlertCircle className="size-3" />
              dirty
            </span>
          )}
          {!editing && (
            <span className="hidden items-center gap-1 sm:inline-flex">
              <GitBranch className="size-3" />
              <span className="font-mono">{editInGitPath}</span>
            </span>
          )}
          {!editing && canEdit && (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:border-primary/40 hover:text-foreground"
            >
              <Pencil className="size-3" />
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:border-foreground/30 disabled:opacity-40"
              >
                <X className="size-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || unchanged}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {pending
                  ? <RotateCcw className="size-3 animate-spin" />
                  : <Check className="size-3" />}
                {pending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {editing
        ? (
            <div className="overflow-hidden rounded-b-lg">
              <CodeMirror
                value={draft}
                height="500px"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  tabSize: 2,
                }}
                extensions={[langExtension[current.language]]}
                onChange={setDraft}
              />
            </div>
          )
        : (
            <pre className="max-h-[600px] overflow-auto rounded-b-lg p-4 font-mono text-xs leading-relaxed text-foreground">
              <code>{current.content}</code>
            </pre>
          )}

      {error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Save failed:
          {' '}
          {error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          {files.length}
          {' '}
          file
          {files.length === 1 ? '' : 's'}
          {' · '}
          <span className="font-mono">{fileName}</span>
        </span>
        {editing
          ? <span className="text-muted-foreground/80">Saving will apply changes to the DB. Git commit + push is your call.</span>
          : canEdit
            ? <span className="text-muted-foreground/60">Click Edit to modify this file.</span>
            : <span className="text-muted-foreground/60">Read-only.</span>}
      </div>
    </div>
  );
}
