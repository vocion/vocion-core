'use client';

import type { DraftCardStatus } from '@/features/dashboard/DraftCard';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { DraftCard, toPlainText } from '@/features/dashboard/DraftCard';

type ProposalCardProps = {
  skillName: string;
  runId: number;
  content: string;
  status: DraftCardStatus;
  prospectName?: string;
  prospectCompany?: string;
  gammaUrl?: string;
  onApprove?: (editedContent: string) => void;
  onReject?: () => void;
};

export const ProposalCard = ({
  skillName,
  runId,
  content,
  status,
  prospectName,
  prospectCompany,
  gammaUrl: initialGammaUrl,
  onApprove,
  onReject,
}: ProposalCardProps) => {
  const [gammaUrl, setGammaUrl] = useState(initialGammaUrl);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const title = prospectCompany
    ? `${prospectCompany} — MVP Proposal`
    : prospectName
      ? `${prospectName} — MVP Proposal`
      : 'MVP Proposal';

  const handleSendToGamma = async (editedContent: string) => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/en/rpc/gamma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `${title}\n\n${toPlainText(editedContent)}`,
          numCards: 14,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setGammaUrl(data.url);
    } catch (err: any) {
      setError(err.message || 'Failed to generate presentation');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <DraftCard
      icon={<FileText className="size-4 text-purple-500" />}
      label="Proposal"
      skillName={skillName}
      runId={runId}
      content={content}
      status={status}
      prospectName={prospectName}
      prospectCompany={prospectCompany}
      headerExtra={
        <div className="mt-1 text-xs font-medium">{title}</div>
      }
      maxBodyHeight="400px"
      actions={editedContent => (
        <>
          {gammaUrl
            ? (
                <a
                  href={gammaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300 dark:hover:bg-purple-950/50"
                >
                  <ExternalLink className="size-3.5" />
                  View in Gamma
                </a>
              )
            : (
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => handleSendToGamma(editedContent)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300 dark:hover:bg-purple-950/50"
                >
                  {generating ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                  {generating ? 'Generating...' : 'Send to Gamma'}
                </button>
              )}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </>
      )}
      onApprove={onApprove}
      onReject={onReject}
    />
  );
};
