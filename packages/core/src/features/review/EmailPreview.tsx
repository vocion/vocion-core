import type { EmailPreviewModel } from '@/services/inbox/emailPreview';
import { Mail } from 'lucide-react';

/**
 * The proposed email, as an email. To, Cc, Subject as a header block; the
 * body with its own line breaks; a draft is labelled as one so "approve"
 * reads correctly ("writes a draft" vs "sends"). No JSON — that stays in the
 * sheet's details for engineers.
 * @param props
 * @param props.email - The email read off the action payload.
 */
export function EmailPreview({ email }: { email: EmailPreviewModel }) {
  return (
    <section data-testid="email-preview" aria-label="The email" className="border-y border-rule py-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <Mail className="size-3.5" aria-hidden />
        {email.draft ? 'The email — approving writes a Gmail draft, nothing is sent' : 'The email — approving sends it'}
      </div>
      <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">To</dt>
        <dd className="break-words">{email.to}</dd>
        {email.cc && (
          <>
            <dt className="text-muted-foreground">Cc</dt>
            <dd className="break-words">{email.cc}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="font-medium">{email.subject}</dd>
      </dl>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed break-words whitespace-pre-wrap">{email.body}</p>
    </section>
  );
}
