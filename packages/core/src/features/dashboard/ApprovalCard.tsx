'use client';

import type { RunStatus } from '@/types/Status';
import { Check, Edit3, X } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StatusPill } from '@/components/ui/status-pill';

type ApprovalCardProps = {
  title: string;
  skillName: string;
  runId: number;
  content: string;
  status: Extract<RunStatus, 'pending' | 'approved' | 'rejected' | 'auto'>;
  onApprove?: (editedContent: string) => void;
  onReject?: () => void;
};

export const ApprovalCard = ({
  title,
  skillName,
  runId,
  content,
  status: initialStatus,
  onApprove,
  onReject,
}: ApprovalCardProps) => {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);

  const handleApprove = () => {
    setStatus('approved');
    onApprove?.(editedContent);
  };

  const handleReject = () => {
    setStatus('rejected');
    onReject?.();
  };

  // Card border tone tracks the StatusPill tone — uses the same
  // design tokens so the visual language stays consistent.
  const cardBorder: Record<typeof status, string> = {
    pending: 'border-[var(--brand-borderline)]/30 bg-[var(--brand-borderline-bg)]/30',
    approved: 'border-[var(--brand-pass)]/30 bg-[var(--brand-pass-bg)]/30',
    rejected: 'border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30',
    auto: 'border-border bg-background',
  };

  return (
    <div className={`rounded-xl border p-5 ${cardBorder[status]}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-sm font-semibold">{title}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Skill:
              {skillName}
            </span>
            <span>
              Run #
              {runId}
            </span>
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      {/* Content */}
      <div className="mt-4">
        {editing
          ? (
              <textarea
                value={editedContent}
                onChange={e => setEditedContent(e.target.value)}
                className="min-h-48 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"

              />
            )
          : (
              <div className="prose max-w-none rounded-md bg-background/80 p-4 text-sm dark:prose-invert" style={{ overflowWrap: 'anywhere' }}>
                <Markdown remarkPlugins={[remarkGfm]}>{editedContent}</Markdown>
              </div>
            )}
      </div>

      {/* Actions */}
      {status === 'pending' && (
        <div className="mt-4 flex items-center gap-2">
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
        </div>
      )}

      {status === 'approved' && (
        <div className="mt-3 text-xs text-[var(--brand-pass)]">Approved — ready to send</div>
      )}
      {status === 'rejected' && (
        <div className="mt-3 text-xs text-[var(--brand-fail)]">Rejected — draft discarded</div>
      )}
    </div>
  );
};
