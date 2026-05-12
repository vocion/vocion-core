'use client';

import type { ReactNode } from 'react';
import type { ConfidenceLevel, RunStatus } from '@/types/Status';
import { Check, ClipboardCopy, Edit3, X } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfidenceIndicator } from '@/components/ui/confidence-indicator';
import { StatusPill } from '@/components/ui/status-pill';

export type DraftCardStatus = Extract<RunStatus, 'pending' | 'approved' | 'rejected' | 'auto'>;

export type DraftCardProps = {
  /** Icon + label for the card type */
  icon: ReactNode;
  label: string;
  /** Skill metadata */
  skillName: string;
  runId: number;
  content: string;
  status: DraftCardStatus;
  /** Agent's self-assessed confidence (N.2). Rendered next to the status pill. */
  confidence?: ConfidenceLevel | null;
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

// Card border tone tracks the StatusPill tone — same design tokens
// as ApprovalCard so the visual language stays consistent.
const statusColors: Record<DraftCardStatus, string> = {
  pending: 'border-[var(--brand-borderline)]/30 bg-[var(--brand-borderline-bg)]/30',
  approved: 'border-[var(--brand-pass)]/30 bg-[var(--brand-pass-bg)]/30',
  rejected: 'border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30',
  // Soft-amber tint so `auto` reads visually distinct from a default card
  // (plan N.2: "auto looks identical to default — make it a soft-amber bar").
  auto: 'border-[var(--brand-amber)]/20 bg-[var(--brand-amber-tint)]/40',
};

export const DraftCard = ({
  icon,
  label,
  skillName,
  runId,
  content,
  status: initialStatus,
  confidence,
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
    <div className={`rounded-xl border ${statusColors[status]}`}>
      {/* Header */}
      <div className="border-b border-border/50 px-5 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-display text-sm font-semibold">{label}</span>
          <span className="text-xs text-muted-foreground">
            {skillName}
            {' '}
            &middot; Run #
            {runId}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {confidence && <ConfidenceIndicator level={confidence} />}
            <StatusPill status={status} />
          </span>
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
              <div className="prose prose-sm max-w-none text-sm leading-relaxed dark:prose-invert prose-p:my-2.5 prose-a:break-all prose-a:text-primary prose-strong:font-semibold prose-ul:my-2 prose-li:my-0.5">
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
