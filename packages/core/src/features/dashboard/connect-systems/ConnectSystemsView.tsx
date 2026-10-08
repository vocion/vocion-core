'use client';

import type { DockedAnswer, DockedOption } from './DockedDecision';
import type { FlowState } from './flow';
import type { ConnectCandidate } from '@/libs/connect/systemsPlan';
import type { ConfigFieldValue } from '@/libs/sources/configFields';
import { Check, Clock, Loader2, Minus } from 'lucide-react';
import { evidenceLine, unlockLine } from '@/libs/connect/systemsPlan';
import { DockedDecision } from './DockedDecision';
import { ConfigFields, CredentialFields } from './FieldsForm';
import { progressOf } from './flow';

/**
 * What the walk-through draws for each state — one docked decision at a time —
 * with no data fetching of its own, so Storybook and the tests drive it with a
 * state and watch what it asks for. `ConnectSystemsFlow` wires it to the RPCs.
 */

export type ViewAnswer
  = | { kind: 'answer'; connectors: string[] }
    | { kind: 'connect' }
    | { kind: 'later' }
    | { kind: 'skip' }
    | { kind: 'stop' }
    | { kind: 'back' }
    | { kind: 'retry_load' }
    | { kind: 'done' }
    | { kind: 'again_later' }
    | { kind: 'something_else'; text: string }
    | { kind: 'submit_form' };

export type ConnectSystemsViewProps = {
  state: FlowState;
  /** The title: "Connect your systems", or "Connect the systems GTM uses". */
  title: string;
  onAnswer: (a: ViewAnswer) => void;
  /** Typed credential values (secret; held here only until saved). */
  credentialValues: Record<string, string>;
  onCredentialChange: (name: string, value: string) => void;
  configValues: Record<string, ConfigFieldValue>;
  onConfigChange: (key: string, value: ConfigFieldValue) => void;
  busy?: boolean;
  error?: string | null;
};

/**
 * Why a system is offered, and what it unlocks, as the step's body.
 * @param c - The system.
 */
function why(c: ConnectCandidate): string {
  const evidence = c.evidence.map(evidenceLine).join(' · ');
  const unlocks = c.unlocks.length > 0 ? `Unlocks ${unlockLine(c, 'connected')}` : '';
  return [evidence, unlocks].filter(Boolean).join(' — ');
}

/**
 * The connect option's words: whose login, or which key.
 * @param c - The system.
 */
function connectLabel(c: ConnectCandidate): { label: string; consequence: string } {
  switch (c.method.kind) {
    case 'login':
      return { label: `Log in with ${c.method.providerLabel}`, consequence: 'Opens their login in a small window, then checks it works' };
    case 'key':
      return { label: `Paste ${c.method.credentialLabel.toLowerCase().startsWith('a') ? 'an' : 'a'} ${c.method.credentialLabel}`, consequence: 'Goes straight to the vault, then checks it works' };
    case 'page':
      return { label: 'Open its connect form', consequence: 'Its full form opens in a small window; this checks it when you are back' };
  }
}

const LATER: DockedOption = { id: 'later', label: 'Later', consequence: 'Come back to it at the end' };

export function ConnectSystemsView(props: ConnectSystemsViewProps) {
  const { state, title, onAnswer, busy = false, error = null } = props;
  const progress = progressOf(state);

  if (state.phase === 'loading') {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground" data-testid="connect-systems-loading">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Working out what to connect…
      </div>
    );
  }

  if (state.phase === 'error' || state.phase === 'refused') {
    return (
      <DockedDecision
        id={`connect-${state.phase}`}
        eyebrow={title}
        question={state.phase === 'refused' ? state.reason : 'The list could not be built.'}
        body={state.phase === 'error' ? state.reason : 'An admin of this workspace can connect its systems.'}
        options={state.phase === 'error' ? [{ id: 'retry', label: 'Try again', recommended: true }] : [{ id: 'done', label: 'OK', recommended: true }]}
        allowOther={false}
        skipLabel={null}
        onAnswer={a => onAnswer(a.kind === 'option' && a.optionIds[0] === 'retry' ? { kind: 'retry_load' } : { kind: 'done' })}
        onEscape={() => onAnswer({ kind: 'done' })}
        escapeLabel="Close"
      />
    );
  }

  if (state.phase === 'nothing') {
    const names = state.plan.connected.map(c => c.name).join(', ');
    return (
      <DockedDecision
        id="connect-nothing"
        eyebrow={title}
        question="Everything here is connected."
        body={names ? `Connected: ${names}.` : 'There is nothing this workspace can connect yet.'}
        options={[{ id: 'done', label: 'Done', recommended: true }]}
        allowOther={false}
        skipLabel={null}
        onAnswer={() => onAnswer({ kind: 'done' })}
        onEscape={() => onAnswer({ kind: 'done' })}
        escapeLabel="Close"
      />
    );
  }

  if (state.phase === 'question') {
    const byId = new Map(state.plan.candidates.map(c => [c.connector, c]));
    const options = state.plan.question!.options.map((slug) => {
      const c = byId.get(slug)!;
      return { id: slug, label: c.name, consequence: c.evidence.map(evidenceLine).join(' · ') || undefined, recommended: c.recommended };
    });
    return (
      <DockedDecision
        id="connect-question"
        eyebrow={title}
        question={state.plan.question!.question}
        body="Pick every one you use; the recommended ones are picked already."
        options={options}
        multiple
        submitLabel="Connect these"
        onAnswer={(a: DockedAnswer) => {
          if (a.kind === 'skip') {
            onAnswer({ kind: 'stop' });
          } else if (a.kind === 'free_text') {
            onAnswer({ kind: 'something_else', text: a.text });
          } else {
            onAnswer({ kind: 'answer', connectors: a.optionIds });
          }
        }}
        onEscape={() => onAnswer({ kind: 'stop' })}
        busy={busy}
        error={error}
      />
    );
  }

  if (state.phase === 'summary') {
    const connected = state.queue.filter(c => state.outcomes[c.connector] === 'connected');
    const later = state.queue.filter(c => state.outcomes[c.connector] === 'later');
    const options: DockedOption[] = [{ id: 'done', label: 'Done', consequence: 'Close this and carry on', recommended: true }];
    if (later.length > 0) {
      options.push({ id: 'again', label: `Connect the ${later.length === 1 ? 'one' : `${later.length}`} I put off`, consequence: later.map(c => c.name).join(', ') });
    }
    return (
      <DockedDecision
        id="connect-summary"
        eyebrow={title}
        question={state.queue.length === 0 ? 'Nothing was connected.' : `Connected ${connected.length} of ${state.queue.length}.`}
        body={state.queue.length > 0 && (
          <ul className="mt-1 divide-y divide-rule" data-testid="connect-summary">
            {state.queue.map((c) => {
              const outcome = state.outcomes[c.connector] ?? 'later';
              const Icon = outcome === 'connected' ? Check : outcome === 'later' ? Clock : Minus;
              return (
                <li key={c.connector} className="flex items-start gap-2 py-1.5" data-testid={`connect-summary-${c.connector}`} data-outcome={outcome}>
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${outcome === 'connected' ? 'text-[var(--brand-pass)]' : 'text-muted-foreground'}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{c.name}</span>
                    {state.previews[c.connector] && <span>{` · ${state.previews[c.connector]}`}</span>}
                    <span className="block text-[12.5px]">{unlockLine(c, outcome)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        options={options}
        allowOther={false}
        skipLabel={null}
        onAnswer={a => onAnswer(a.kind === 'option' && a.optionIds[0] === 'again' ? { kind: 'again_later' } : { kind: 'done' })}
        onEscape={() => onAnswer({ kind: 'done' })}
        escapeLabel="Close"
      />
    );
  }

  // The walk: one system at a time.
  const c = state.queue[state.index]!;
  const common = { eyebrow: title, progress, onEscape: () => onAnswer({ kind: 'stop' }), busy, error } as const;
  const somethingElse = (a: DockedAnswer, handle: (ids: string[]) => void) => {
    if (a.kind === 'skip') {
      onAnswer({ kind: 'skip' });
    } else if (a.kind === 'free_text') {
      onAnswer({ kind: 'something_else', text: a.text });
    } else {
      handle(a.optionIds);
    }
  };

  switch (state.step.at) {
    case 'choose': {
      const connect = connectLabel(c);
      return (
        <DockedDecision
          {...common}
          id={`connect-${c.connector}-choose`}
          question={`Connect ${c.name}?`}
          body={why(c)}
          options={[{ id: 'connect', ...connect, recommended: true }, LATER]}
          submitLabel="Continue"
          onAnswer={a => somethingElse(a, ids => onAnswer(ids[0] === 'later' ? { kind: 'later' } : { kind: 'connect' }))}
        />
      );
    }
    case 'key': {
      const method = c.method.kind === 'key' ? c.method : null;
      return (
        <DockedDecision
          {...common}
          id={`connect-${c.connector}-key`}
          question={`Paste your ${c.name} ${method?.credentialLabel ?? 'key'}`}
          body={method?.getItAt
            ? (
                <span>
                  {'Get one at '}
                  <a href={method.getItAt.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{method.getItAt.url}</a>
                  {`: ${method.getItAt.steps.join('; ')}. It goes straight to the vault and is never shown again.`}
                </span>
              )
            : 'It goes straight to the vault and is never shown again.'}
          options={[]}
          allowOther={false}
          submitLabel="Save and check"
          escapeLabel="Back"
          onEscape={() => onAnswer({ kind: 'back' })}
          onAnswer={a => (a.kind === 'skip' ? onAnswer({ kind: 'skip' }) : onAnswer({ kind: 'submit_form' }))}
        >
          <CredentialFields fields={method?.credentialFields ?? []} values={props.credentialValues} onChange={props.onCredentialChange} disabled={busy} />
          <ConfigFields fields={method?.configFields ?? []} values={props.configValues} onChange={props.onConfigChange} disabled={busy} />
        </DockedDecision>
      );
    }
    case 'settings': {
      const fields = c.method.kind === 'login' ? c.method.settingsAfterLogin : [];
      return (
        <DockedDecision
          {...common}
          id={`connect-${c.connector}-settings`}
          question={`Logged in. What should ${c.name} read?`}
          options={[]}
          allowOther={false}
          submitLabel="Save and check"
          onAnswer={a => (a.kind === 'skip' ? onAnswer({ kind: 'skip' }) : onAnswer({ kind: 'submit_form' }))}
        >
          <ConfigFields fields={fields} values={props.configValues} onChange={props.onConfigChange} disabled={busy} />
        </DockedDecision>
      );
    }
    case 'authorizing':
      return (
        <DockedDecision
          {...common}
          id={`connect-${c.connector}-authorizing`}
          question={`Finish connecting ${c.name} in the window that opened`}
          body="This carries on by itself when you are done there. Closed it by mistake? Go back and connect again."
          options={[]}
          allowOther={false}
          escapeLabel="Back"
          onEscape={() => onAnswer({ kind: 'back' })}
          onAnswer={a => (a.kind === 'skip' ? onAnswer({ kind: 'skip' }) : undefined)}
        />
      );
    case 'verifying':
      return (
        <DockedDecision
          {...common}
          id={`connect-${c.connector}-verifying`}
          question={`Checking ${c.name}…`}
          body="A test call, then a first look at what it holds."
          options={[]}
          allowOther={false}
          skipLabel={null}
          onAnswer={() => {}}
          busy
        />
      );
    case 'failed':
      return (
        <DockedDecision
          {...common}
          id={`connect-${c.connector}-failed`}
          question={`${c.name} did not connect`}
          body={state.step.reason}
          options={[{ id: 'retry', label: 'Try again', recommended: true }, LATER]}
          submitLabel="Continue"
          onAnswer={a => somethingElse(a, ids => onAnswer(ids[0] === 'later' ? { kind: 'later' } : { kind: 'connect' }))}
        />
      );
  }
}
