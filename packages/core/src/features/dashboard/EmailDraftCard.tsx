'use client';

import type { DraftCardStatus } from '@/features/dashboard/DraftCard';
import { ExternalLink, Mail } from 'lucide-react';
import { DraftCard, toPlainText } from '@/features/dashboard/DraftCard';

type EmailDraftCardProps = {
  skillName: string;
  runId: number;
  content: string;
  status: DraftCardStatus;
  prospectName?: string;
  prospectCompany?: string;
  onApprove?: (editedContent: string) => void;
  onReject?: () => void;
};

function parseEmailContent(raw: string): { subject: string; body: string } {
  const lines = raw.split('\n');
  let subject = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\*{0,2}Subject:\*{0,2}\s*/i.test(line)) {
      subject = line.replace(/^\*{0,2}Subject:\*{0,2}\s*/i, '').trim();
      bodyStart = i + 1;
      break;
    }
    if (line.trim() && !line.startsWith('#')) {
      break;
    }
  }

  while (bodyStart < lines.length && !lines[bodyStart]!.trim()) {
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join('\n').trim();

  return { subject, body };
}

export const EmailDraftCard = ({
  skillName,
  runId,
  content,
  status,
  prospectName,
  prospectCompany,
  onApprove,
  onReject,
}: EmailDraftCardProps) => {
  const parsed = parseEmailContent(content);

  // Build mailto from the raw body (not edited — the base handles editing internally)
  const plainBody = toPlainText(parsed.body);
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(parsed.subject)}&body=${encodeURIComponent(plainBody)}`;

  return (
    <DraftCard
      icon={<Mail className="size-4 text-blue-500" />}
      label="Email Draft"
      skillName={skillName}
      runId={runId}
      content={content}
      status={status}
      prospectName={prospectName}
      prospectCompany={prospectCompany}
      headerExtra={
        parsed.subject
          ? (
              <div className="mt-1 text-xs">
                <span className="text-muted-foreground">Subject: </span>
                <span className="font-medium">{parsed.subject}</span>
              </div>
            )
          : undefined
      }
      actions={() => (
        <a
          href={mailtoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <ExternalLink className="size-3.5" />
          Send with email
        </a>
      )}
      onApprove={onApprove}
      onReject={onReject}
    />
  );
};
