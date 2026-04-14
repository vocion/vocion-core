'use client';

import type { DraftCardStatus } from '@/features/dashboard/DraftCard';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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

type GammaState
  = | { phase: 'idle' }
    | { phase: 'creating' }
    | { phase: 'generating'; generationId: string }
    | { phase: 'done'; url: string }
    | { phase: 'error'; message: string };

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
  const [gamma, setGamma] = useState<GammaState>(
    initialGammaUrl ? { phase: 'done', url: initialGammaUrl } : { phase: 'idle' },
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const title = prospectCompany
    ? `${prospectCompany} — MVP Proposal`
    : prospectName
      ? `${prospectName} — MVP Proposal`
      : 'MVP Proposal';

  // Poll for completion when in 'generating' phase
  const pollForCompletion = useCallback((generationId: string) => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/en/rpc/gamma?id=${encodeURIComponent(generationId)}`);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (data.status === 'completed' && data.url) {
          setGamma({ phase: 'done', url: data.url });
          if (pollRef.current) {
            clearInterval(pollRef.current);
          }
        } else if (data.status === 'failed') {
          setGamma({ phase: 'error', message: 'Gamma generation failed' });
          if (pollRef.current) {
            clearInterval(pollRef.current);
          }
        }
      } catch {
        // Silently retry on network errors
      }
    }, 5000);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const handleSendToGamma = async (editedContent: string) => {
    setGamma({ phase: 'creating' });
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
      const generationId = data.generationId as string;

      // Move to generating state and start polling
      setGamma({ phase: 'generating', generationId });
      pollForCompletion(generationId);
    } catch (err: any) {
      setGamma({ phase: 'error', message: err.message || 'Failed to start generation' });
    }
  };

  const gammaButtonClass = 'inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300 dark:hover:bg-purple-950/50';

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
          {gamma.phase === 'idle' && (
            <button
              type="button"
              onClick={() => handleSendToGamma(editedContent)}
              className={gammaButtonClass}
            >
              <ExternalLink className="size-3.5" />
              Send to Gamma
            </button>
          )}

          {gamma.phase === 'creating' && (
            <span className={`${gammaButtonClass} opacity-60`}>
              <Loader2 className="size-3.5 animate-spin" />
              Starting...
            </span>
          )}

          {gamma.phase === 'generating' && (
            <span className={`${gammaButtonClass} cursor-default opacity-80`}>
              <Loader2 className="size-3.5 animate-spin" />
              Building deck (~20s)...
            </span>
          )}

          {gamma.phase === 'done' && (
            <a
              href={gamma.url}
              target="_blank"
              rel="noopener noreferrer"
              className={gammaButtonClass}
            >
              <ExternalLink className="size-3.5" />
              View in Gamma
            </a>
          )}

          {gamma.phase === 'error' && (
            <>
              <button
                type="button"
                onClick={() => handleSendToGamma(editedContent)}
                className={gammaButtonClass}
              >
                <ExternalLink className="size-3.5" />
                Retry
              </button>
              <span className="text-xs text-red-500">{gamma.message}</span>
            </>
          )}
        </>
      )}
      onApprove={onApprove}
      onReject={onReject}
    />
  );
};
