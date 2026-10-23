'use client';

import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { explainPermissionError, reconnectHref } from '@/libs/connect/permissionError';

/**
 * WHY AN APPROVED ACTION DID NOT GO THROUGH, at three levels (#1286): a plain
 * sentence, the one thing to do about it, and the raw failure behind Details.
 *
 * A connector that refused for want of access (Gmail read-only asked for a
 * draft, a Slack bot without `chat:write`) reads as what Vocion can and cannot
 * do there, with a reconnect that asks for exactly the missing access
 * (`libs/connect/permissionError.ts`). Anything else reads as its own words
 * up to the payload, so a vendor's JSON never sits in the main view.
 */

/**
 * The readable part of a failure: the words before any JSON body, with the
 * status kept — `Gmail send failed: 500 {…}` → `Gmail send failed (500).`
 * @param error - What the run recorded.
 */
export function failureSummary(error: string): string {
  const cut = error.search(/[{[]/);
  const head = (cut >= 0 ? error.slice(0, cut) : error).trim();
  const status = /\b(\d{3})$/.exec(head);
  const prefix = (status ? head.slice(0, status.index) : head).replace(/[:\s]+$/, '');
  const words = status && prefix ? `${prefix} (${status[1]})` : prefix;
  if (!words) {
    return 'The system it writes to refused the change.';
  }
  const sentence = words.length > 240 ? `${words.slice(0, 237).trimEnd()}…` : words;
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * @param props - The failure.
 * @param props.error - What the run recorded.
 * @param props.actionId - The action that failed, for its connector.
 * @param props.approveVerb - The bar's primary, named in the next step.
 * @param props.accessGranted - On a permission failure, whether the
 * connection holds the missing access now (the person reconnected since). True
 * drops the reconnect: the access is in place, and the next step is to press
 * the primary again.
 */
export function ExecutionFailure(props: { error: string; actionId: string; approveVerb: string; accessGranted?: boolean | null }) {
  const problem = explainPermissionError(props.error, props.actionId);
  // The access the run lacked, when the connection holds it now.
  const granted = problem?.kind === 'scope' && props.accessGranted === true ? problem : null;
  const [copied, setCopied] = useState(false);
  const raw = props.error;
  // Details only when there is more to see than the summary already says.
  const hasDetails = problem !== null || failureSummary(raw).replace(/\.$/, '') !== raw.trim().replace(/\.$/, '');

  return (
    <div data-testid="execution-failed-banner" data-kind={granted ? 'access-granted' : problem?.kind ?? 'other'} className={`flex items-start gap-2.5 border-l-2 py-1 pl-3 text-sm ${granted ? 'border-border' : 'border-brand-fail'}`}>
      {granted
        ? <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand-fail" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground" data-testid="execution-failed-sentence">
          {granted ? `${granted.system} now lets Vocion ${granted.needs}.` : problem ? problem.sentence : 'This did not go through.'}
        </p>
        {!problem && <p className="mt-0.5 text-[13px] break-words text-muted-foreground" data-testid="execution-failed-summary">{failureSummary(raw)}</p>}
        <p className="mt-1 text-[13px] text-muted-foreground">
          {granted
            ? `The last try failed before you reconnected. Press ${props.approveVerb} to try again.`
            : problem
              ? (
                  <>
                    <a
                      href={reconnectHref(problem)}
                      // Back to this page after the reconnect. Added on the
                      // press, not in render: the server render has no
                      // location, and a link that differed between the two
                      // would be a hydration warning.
                      onClick={(e) => {
                        e.currentTarget.href = reconnectHref(problem, `${window.location.pathname}${window.location.search}`);
                      }}
                      data-testid="execution-failed-fix"
                      className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                    >
                      {`${problem.fixLabel} →`}
                    </a>
                    {` Then press ${props.approveVerb} again.`}
                  </>
                )
              : `Fix what it names, then press ${props.approveVerb} again.`}
        </p>
        {hasDetails && (
          <details className="mt-1.5 text-[12px] text-muted-foreground" data-testid="execution-failed-details">
            <summary className="cursor-pointer select-none hover:text-foreground">Details</summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-surface-soft p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">{raw}</pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(raw).then(() => setCopied(true)).catch(() => {});
              }}
              className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-surface-hover hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </details>
        )}
      </div>
    </div>
  );
}
