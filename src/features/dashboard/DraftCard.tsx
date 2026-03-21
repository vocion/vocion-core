'use client';

import type { ReactNode } from 'react';
import { Check, ClipboardCopy, Edit3, X } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type DraftCardStatus = 'pending' | 'approved' | 'rejected' | 'auto';

export type DraftCardProps = {
  /** Icon + label for the card type */
  icon: ReactNode;
  label: string;
  /** Skill metadata */
  skillName: string;
  runId: number;
  content: string;
  status: DraftCardStatus;
  prospectName?: string;
  prospectCompany?: string;
  /** Extra header rows rendered below the title bar */
  headerExtra?: ReactNode;
  /** Extra action buttons rendered after Copy (before approve/reject) */
  actions?: (editedContent: string) => ReactNode;
  /** Max height for body area (with scroll). Undefined = no limit. */
  maxBodyHeight?: string;
  /** Callbacks */
  onApprove?: (editedContent: string) => void;
  onReject?: () => void;
};

/**
 * Strip markdown for plain-text copy
 * @param md
 */
export function toPlainText(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)')
    .replace(/^[-*] /gm, '• ')
    .trim();
}

/**
 * Pre-process body text into proper markdown
 * @param text
 */
export function toMarkdown(text: string): string {
  return text
    .replace(/^[•·]\s*/gm, '- ')
    .replace(/^\* (?!\*)/gm, '- ')
    .replace(/([^\n])\n(- )/g, '$1\n\n$2')
    .replace(/(^- .+)\n([^-\n])/gm, '$1\n\n$2')
    .replace(/([.!?])\n([A-Z])/g, '$1\n\n$2');
}

const statusColors: Record<string, string> = {
  pending: 'border-blue-200 bg-blue-50/20 dark:border-blue-900 dark:bg-blue-950/10',
  approved: 'border-green-200 bg-green-50/30 dark:border-green-900 dark:bg-green-950/10',
  rejected: 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/10',
  auto: 'border-border bg-background',
};

export const DraftCard = ({
  icon,
  label,
  skillName,
  runId,
  content,
  status: initialStatus,
  prospectName,
  prospectCompany,
  headerExtra,
  actions,
  maxBodyHeight,
  onApprove,
  onReject,
}: DraftCardProps) => {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [copied, setCopied] = useState(false);

  const handleApprove = () => {
    setStatus('approved');
    onApprove?.(editedContent);
  };

  const handleReject = () => {
    setStatus('rejected');
    onReject?.();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(toPlainText(editedContent));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`rounded-lg border-2 ${statusColors[status] ?? ''}`}>
      {/* Header */}
      <div className="border-b border-border/50 px-5 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs text-muted-foreground">
            {skillName}
            {' '}
            &middot; Run #
            {runId}
          </span>
          {status === 'pending' && (
            <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Pending Approval
            </span>
          )}
          {status === 'approved' && (
            <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
              Approved
            </span>
          )}
          {status === 'rejected' && (
            <span className="ml-auto rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
              Rejected
            </span>
          )}
        </div>
        {prospectName && (
          <div className="mt-1 text-xs text-muted-foreground">
            To:
            {' '}
            {prospectName}
            {prospectCompany ? ` (${prospectCompany})` : ''}
          </div>
        )}
        {headerExtra}
      </div>

      {/* Body — rendered as rich HTML via react-markdown */}
      <div
        className="overflow-y-auto px-5 py-4"
        style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
      >
        {editing
          ? (
              <textarea
                value={editedContent}
                onChange={e => setEditedContent(e.target.value)}
                className="min-h-48 w-full rounded-md border border-border bg-background p-3 font-sans text-sm leading-relaxed outline-none focus:ring-2 focus:ring-primary/50"
              />
            )
          : (
              <div className="prose prose-sm dark:prose-invert prose-p:my-2.5 prose-ul:my-2 prose-li:my-0.5 prose-a:text-primary prose-a:break-all prose-strong:font-semibold max-w-none text-sm leading-relaxed">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ children, href, ...props }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                    ),
                  }}
                >
                  {toMarkdown(editedContent)}
                </Markdown>
              </div>
            )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-5 py-3">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          {copied ? <Check className="size-3.5 text-green-600" /> : <ClipboardCopy className="size-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>

        {actions?.(editedContent)}

        {status === 'pending' && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={handleApprove}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              <Check className="size-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Edit3 className="size-3.5" />
              {editing ? 'Preview' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={handleReject}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <X className="size-3.5" />
              Reject
            </button>
          </>
        )}
      </div>

      {status === 'approved' && (
        <div className="border-t border-green-200/50 px-5 py-2 text-xs text-green-600">
          Approved — ready to send
        </div>
      )}
      {status === 'rejected' && (
        <div className="border-t border-red-200/50 px-5 py-2 text-xs text-red-600">
          Rejected — draft discarded
        </div>
      )}
    </div>
  );
};
