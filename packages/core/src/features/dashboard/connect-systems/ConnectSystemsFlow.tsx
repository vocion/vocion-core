'use client';

import type { ViewAnswer } from './ConnectSystemsView';
import type { FlowEvent, FlowResume, FlowState } from './flow';
import type { ConnectPlanInput, ConnectVerification } from '@/libs/connect/systemsPlan';
import type { ConfigFieldValue } from '@/libs/sources/configFields';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { SETUP_CHANGED_EVENT } from '@/features/dashboard/setupChanged';
import { client } from '@/libs/Orpc';
import { buildConfigFromFields, describeMissingFields, initialFieldValues } from '@/libs/sources/configFields';
import { ConnectSystemsView } from './ConnectSystemsView';
import { INITIAL, reduce, resumeOf, summaryLine } from './flow';
import { announceConnectSystemsFinished } from './launch';
import { openLoginWindow, reasonInWords } from './loginWindow';

/**
 * "CONNECT YOUR SYSTEMS", docked above the composer: the walk-through wired to
 * its RPCs (`connectSystems.plan | saveKey | verify | finish`). Self-contained
 * — it needs nothing from the conversation but the Decision it answers — so
 * every way in opens the same thing: the docked Decision, the Getting started
 * checklist, an app's page and the Connectors page.
 *
 * Fires `vocion:workspace-setup-changed` whenever a system connects, so the
 * checklist and an app page's live status re-read.
 */

export type ConnectSystemsFlowProps = {
  input: ConnectPlanInput;
  /** The Decision that started it, which it answers with its summary when it finishes. */
  decision?: { conversationId: number; decisionId: number } | null;
  /** The walk is over (Done, or closed). */
  onClose: () => void;
  /** "Something else", in the person's own words: handed to the agent as their next message. */
  onSomethingElse?: (text: string) => void;
  /** How long a first sync is waited on before the walk moves on and lets it finish in the background. */
  verifyBudgetMs?: number;
  /** The lead's own why from the turn that raised it, for the first step. */
  intro?: string | null;
  /** Where it was before a reload or a trip away: it picks up there. */
  resume?: FlowResume | null;
  /** Where it is now, each time that changes, for the surface to keep. */
  onProgress?: (where: FlowResume) => void;
};

const VERIFY_EVERY_MS = 1500;

/**
 * An error as a person reads it: the server's own sentence, never a stack.
 * @param error - What the call threw.
 */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'That did not work. Try again.';
}

export function ConnectSystemsFlow({ input, decision, onClose, onSomethingElse, verifyBudgetMs = 12_000, resume = null, onProgress, intro = null }: ConnectSystemsFlowProps) {
  const [state, dispatch] = useReducer((s: FlowState, e: FlowEvent) => reduce(s, e), INITIAL);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [configValues, setConfigValues] = useState<Record<string, ConfigFieldValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Read once, at the start: a resumed walk picks up where it was, and only then.
  const resumeRef = useRef(resume);
  const load = useCallback(() => {
    void client.connectSystems.plan(input)
      .then((plan) => {
        dispatch({ type: 'loaded', plan, resume: resumeRef.current });
        resumeRef.current = null;
      })
      .catch((e: unknown) => dispatch({ type: 'load_failed', reason: messageOf(e) }));
  }, [input]);
  useEffect(load, [load]);

  // Where it is, kept by the surface so a reload or the drawer never loses it.
  const where = resumeOf(state);
  const whereKey = where ? JSON.stringify(where) : null;
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });
  useEffect(() => {
    if (whereKey) {
      onProgressRef.current?.(JSON.parse(whereKey) as FlowResume);
    }
  }, [whereKey]);

  const current = state.phase === 'walk' ? state.queue[state.index]! : null;
  const stepAt = state.phase === 'walk' ? state.step.at : null;

  // A fresh step starts with nothing typed and no error.
  const stepKey = current ? `${current.connector}:${stepAt}` : state.phase;
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- each step starts clean
    setError(null);
  }, [stepKey]);

  // Verify before moving on: poll the test call and the first sync, and move
  // on with the count so far once the budget is spent — it keeps reading.
  useEffect(() => {
    if (!current || stepAt !== 'verifying') {
      return;
    }
    let cancelled = false;
    const started = Date.now();
    const tick = async () => {
      let result: ConnectVerification;
      try {
        result = await client.connectSystems.verify({ connector: current.connector });
      } catch (e) {
        result = { state: 'failed', reason: messageOf(e) };
      }
      if (cancelled) {
        return;
      }
      if (result.state === 'reading' && Date.now() - started < verifyBudgetMs) {
        setTimeout(() => void tick(), VERIFY_EVERY_MS);
        return;
      }
      if (result.state === 'verified' || result.state === 'reading') {
        window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
      }
      dispatch({ type: 'verified', result: result.state === 'reading' ? { state: 'reading', preview: result.preview ?? 'Reading it in the background' } : result });
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [current, stepAt, verifyBudgetMs]);

  const connect = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'walk') {
      return;
    }
    const c = s.queue[s.index]!;
    if (c.method.kind === 'key') {
      setCredentialValues({});
      setConfigValues(initialFieldValues(c.method.configFields));
      dispatch({ type: 'connect' });
      return;
    }
    // Opened inside the person's press, so no pop-up blocker stops it.
    const method = c.method;
    const href = method.kind === 'login' ? method.startHref : method.href;
    const opened = openLoginWindow(href, { closesAsOk: method.kind === 'page' });
    dispatch({ type: 'connect' });
    void opened.then((outcome) => {
      if (outcome.ok) {
        const settings = method.kind === 'login' ? method.settingsAfterLogin : [];
        if (settings.length > 0) {
          setConfigValues(initialFieldValues(settings));
        }
        dispatch({ type: 'login_returned', ok: true, needsSettings: settings.length > 0 });
      } else {
        dispatch({ type: 'login_returned', ok: false, reason: reasonInWords(outcome.reason) });
      }
    });
  }, []);

  const submitForm = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== 'walk' || busy) {
      return;
    }
    const c = s.queue[s.index]!;
    const fields = c.method.kind === 'key' ? c.method.configFields : c.method.kind === 'login' ? c.method.settingsAfterLogin : [];
    const built = buildConfigFromFields(fields, configValues);
    if (built.missingLabels.length > 0) {
      setError(describeMissingFields(built.missingLabels));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (s.step.at === 'key') {
        const missing = c.method.kind === 'key' ? c.method.credentialFields.filter(f => !f.optional && !(credentialValues[f.name] ?? '').trim()) : [];
        if (missing.length > 0) {
          setError(`Enter the ${missing.map(f => f.label).join(' and ')}.`);
          return;
        }
        await client.connectSystems.saveKey({ connector: c.connector, config: built.config, values: credentialValues });
        // Gone from the page the moment the vault has it.
        setCredentialValues({});
      } else {
        await client.connect.saveSource({ connector: c.connector, config: built.config });
      }
      dispatch({ type: 'saved' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [busy, configValues, credentialValues]);

  const finish = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'summary' && decision && s.queue.length > 0) {
      const summary = summaryLine(s);
      void client.connectSystems.finish({ ...decision, summary })
        .then(() => announceConnectSystemsFinished(decision.decisionId, summary))
        .catch(() => {});
    }
    onClose();
  }, [decision, onClose]);

  const onAnswer = (a: ViewAnswer) => {
    switch (a.kind) {
      case 'answer':
        dispatch({ type: 'answered', connectors: a.connectors });
        return;
      case 'connect':
        connect();
        return;
      case 'submit_form':
        void submitForm();
        return;
      case 'later':
      case 'skip':
      case 'stop':
      case 'back':
        setCredentialValues({});
        dispatch({ type: a.kind });
        return;
      case 'retry_load':
        dispatch({ type: 'load_failed', reason: '' });
        load();
        return;
      case 'again_later': {
        const s = stateRef.current;
        if (s.phase === 'summary') {
          const later = s.queue.filter(c => s.outcomes[c.connector] === 'later');
          dispatch({ type: 'loaded', plan: { ...s.plan, candidates: later, question: null } });
        }
        return;
      }
      case 'something_else':
        onSomethingElse?.(a.text);
        return;
      case 'done':
        finish();
    }
  };

  const title = state.phase !== 'loading' && 'plan' in state && state.plan.scope ? `${state.plan.scope.appName} setup` : 'Connect your systems';
  return (
    <div data-testid="connect-systems" data-phase={state.phase} data-step={stepAt ?? undefined} data-connector={current?.connector}>
      <ConnectSystemsView
        intro={intro}
        stepLines={input.say}
        state={state.phase === 'error' && !state.reason ? { phase: 'loading' } : state}
        title={title}
        onAnswer={onAnswer}
        credentialValues={credentialValues}
        onCredentialChange={(name, value) => setCredentialValues(v => ({ ...v, [name]: value }))}
        configValues={configValues}
        onConfigChange={(key, value) => setConfigValues(v => ({ ...v, [key]: value }))}
        busy={busy}
        error={error}
      />
    </div>
  );
}
