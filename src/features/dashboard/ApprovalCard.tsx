'use client';

import { Check, Edit3, X } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ApprovalCardProps = {
  title: string;
  skillName: string;
  runId: number;
  content: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto';
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

  const statusColors: Record<string, string> = {
    pending: 'border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/10',
    approved: 'border-green-200 bg-green-50/30 dark:border-green-900 dark:bg-green-950/10',
    rejected: 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/10',
    auto: 'border-border bg-background',
  };

  const statusBadges: Record<string, { label: string; style: string }> = {
    pending: { label: 'Pending Approval', style: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Approved', style: 'bg-green-100 text-green-800' },
    rejected: { label: 'Rejected', style: 'bg-red-100 text-red-800' },
    auto: { label: 'Auto-Run', style: 'bg-muted text-muted-foreground' },
  };

  const badge = statusBadges[status] ?? statusBadges.pending!;

  return (
    <div className={`rounded-lg border-2 p-5 ${statusColors[status] ?? ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{title}</div>
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
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.style}`}>
          {badge.label}
        </span>
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
              <div className="prose dark:prose-invert max-w-none rounded-md bg-background/80 p-4 text-sm" style={{ overflowWrap: 'anywhere' }}>
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
        <div className="mt-3 text-xs text-green-600">Approved — ready to send</div>
      )}
      {status === 'rejected' && (
        <div className="mt-3 text-xs text-red-600">Rejected — draft discarded</div>
      )}
    </div>
  );
};
