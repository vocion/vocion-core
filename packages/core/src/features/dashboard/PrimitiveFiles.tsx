'use client';

import { FileText, GitBranch } from 'lucide-react';
import { useState } from 'react';

type PrimitiveFile = {
  path: string;
  content: string;
  language: 'yaml' | 'markdown';
};

type Props = {
  files: PrimitiveFile[];
  editInGitPath: string;
};

/**
 * Read-only viewer for the files that back a primitive (skill/workflow/
 * agent/object/source). Renders tabs when there's more than one file;
 * collapses to a single pane otherwise. Edit-in-place via CodeMirror
 * is a follow-up.
 * @param root0
 * @param root0.files
 * @param root0.editInGitPath
 */
export function PrimitiveFiles({ files, editInGitPath }: Props) {
  const [active, setActive] = useState(0);
  const current = files[active];
  if (!current) {
    return null;
  }
  const fileName = current.path.split('/').pop() ?? current.path;

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex gap-1">
          {files.map((f, i) => {
            const name = f.path.split('/').pop() ?? f.path;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded px-2.5 py-1 text-xs transition ${
                  i === active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
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
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <GitBranch className="size-3" />
          <span className="font-mono">{editInGitPath}</span>
        </div>
      </div>
      <pre className="max-h-[600px] overflow-auto rounded-b-lg p-4 font-mono text-xs leading-relaxed text-foreground">
        <code>{current.content}</code>
      </pre>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Read-only · Edit in
        {' '}
        <code className="rounded bg-muted px-1 font-mono">{fileName}</code>
        {' '}
        then run
        {' '}
        <code className="rounded bg-muted px-1 font-mono">npm run context:apply</code>
        {' '}
        to sync.
      </div>
    </div>
  );
}
