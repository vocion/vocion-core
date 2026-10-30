'use client';

import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { useState } from 'react';
import { ListRow, ListRows, Section } from '@/components/patterns';
import { DecisionCard } from '@/features/dashboard/chat/decisions/DecisionCard';
import { answerLine, decisionAnswerWire, decisionKey } from '@/libs/decisions/decision';
import { client } from '@/libs/Orpc';

/**
 * "Needs you" on an app's home: what the app's agents are waiting on the
 * person for, decided right here with the one decision card (#1504: a chip
 * or the person's own words decide, no duplicate asks). ONE card at a time,
 * oldest first, "1 of 3", recommended option first and keyboard-driven,
 * the way the chat dock shows them. A Decision asked inside a conversation
 * is answered there, where the agent hears it on the turn it starts: those
 * are rows that open their chat.
 *
 * Nothing waiting, no section (and no "N waiting" nudge anywhere here).
 * @param props
 * @param props.decisions - The app's open Decisions, oldest first.
 * @param props.agentNames - Agent slug → name, for each card's eyebrow.
 * @param props.labels - The words.
 * @param props.labels.title - The section's eyebrow.
 * @param props.labels.inChat - The eyebrow over Decisions waiting in a chat.
 * @param props.labels.openChat - The subline of a row that opens its chat.
 * @param props.labels.failed - Why an answer did not land.
 */
export function HomeDecisions({ decisions, agentNames, labels }: { decisions: DecisionView[]; agentNames: Record<string, string>; labels: { title: string; inChat: string; openChat: string; failed: string } }) {
  const [settled, setSettled] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const here = decisions.filter(d => d.conversationId === null && !settled[decisionKey(d)]);
  const inChats = decisions.filter(d => d.conversationId !== null);
  const done = Object.values(settled);
  if (here.length === 0 && inChats.length === 0 && done.length === 0) {
    return null;
  }
  const current = here[0];

  const answer = (view: DecisionView, a: DecisionAnswer) => {
    const key = decisionKey(view);
    setBusy(key);
    setError(null);
    void client.decisions.answer({ ...decisionAnswerWire(view, a), subject: view.subject ?? 'ask' })
      .then(() => setSettled(prev => ({ ...prev, [key]: `${a.kind === 'skip' ? 'Skipped' : a.kind === 'free_text' ? 'Answered' : `Chose ${answerLine(view, a)}`} · ${view.question}` })))
      .catch((e: unknown) => setError((e as Error).message || labels.failed))
      .finally(() => setBusy(null));
  };

  return (
    <Section eyebrow={labels.title} data-testid="home-needs-you">
      {current && (
        <DecisionCard
          key={decisionKey(current)}
          decision={current}
          variant="list"
          agentName={current.agentSlug ? agentNames[current.agentSlug] ?? null : null}
          position={here.length > 1 ? { index: 0, total: here.length } : undefined}
          onAnswer={a => answer(current, a)}
          busy={busy === decisionKey(current)}
          error={error}
        />
      )}
      {done.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground" data-testid="home-decided" aria-live="polite">
          {done.map(line => <li key={line}>{line}</li>)}
        </ul>
      )}
      {inChats.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[12px] text-muted-foreground">{labels.inChat}</p>
          <ListRows className="border-y border-border/70">
            {inChats.map(d => (
              <ListRow
                key={decisionKey(d)}
                href={`/dashboard/chat?conversation=${d.conversationId}`}
                title={d.question}
                subline={labels.openChat}
              />
            ))}
          </ListRows>
        </div>
      )}
    </Section>
  );
}
