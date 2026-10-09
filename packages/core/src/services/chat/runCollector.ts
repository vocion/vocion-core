/**
 * The assistant turn, buffered as it streams, ready to persist when the stream
 * closes.
 *
 * Lives beside the route rather than inside it because an App Router
 * `route.ts` may only export HTTP handlers — and a collector that decides what
 * a RELOADED transcript says is worth testing directly. Its job: fold the
 * event stream into the four persisted columns (`content`, `runs_json`,
 * `documents_json`, `trace_json`) exactly as the live surface folded it, so a
 * refresh shows the turn the person watched.
 *
 * Mirrors rev-ai's `_RunCollector` (server/main.py:1182-1212).
 */

import type { ConversationRun, ConversationTraceNode } from '@/services/ConversationService';
import { linkRecordMentions } from '@/libs/chat/recordMentions';
import { stepLabelFor } from '@/libs/chat/stepLabels';

export type CollectedDoc = { document_id: string; semantic_identifier: string; link: string; source_type: string; blurb: string; citationIndex?: number; foundBy?: string };

/** What a card hands the collector: the card run as it will be stored, minus its `type`. */
type CardRunInput = Omit<Extract<ConversationRun, { type: 'card' }>, 'type'>;

/**
 * The stored run for a card. It keeps everything the card shows, so a reload
 * draws the card the person saw: the body and fields, both links, the last
 * failed attempt and the decision. Keys the card did not set stay off the row.
 * @param card - The card as surfaced.
 */
function cardRunOf(card: CardRunInput): ConversationRun {
  return {
    type: 'card',
    ...(card.id ? { id: card.id } : {}),
    ...(card.kind ? { kind: card.kind } : {}),
    label: card.label,
    actionId: card.actionId,
    ...(card.actionLabel ? { actionLabel: card.actionLabel } : {}),
    input: card.input,
    runId: card.runId,
    ...(card.state ? { state: card.state } : {}),
    ...(card.rationale ? { rationale: card.rationale } : {}),
    ...(card.body ? { body: card.body } : {}),
    ...(card.fields ? { fields: card.fields } : {}),
    ...(card.href ? { href: card.href, ...(card.hrefLabel ? { hrefLabel: card.hrefLabel } : {}) } : {}),
    ...(card.secondaryHref ? { secondaryHref: card.secondaryHref, ...(card.secondaryHrefLabel ? { secondaryHrefLabel: card.secondaryHrefLabel } : {}) } : {}),
    ...(card.lastAttempt ? { lastAttempt: card.lastAttempt } : {}),
    ...(card.brand ? { brand: card.brand } : {}),
    ...(card.decision ? { decision: card.decision } : {}),
    ...(card.draft ? { draft: card.draft } : {}),
  };
}

export class RunCollector {
  private runs: ConversationRun[] = [];
  private currentText: string | null = null;
  private documents: CollectedDoc[] = [];
  private readonly docKeys = new Set<string>();
  // Merged by id, mirroring the client's fold (start → progress* → done),
  // so the persisted trace equals what the live surface showed.
  private readonly trace = new Map<string, ConversationTraceNode>();
  /**
   * Artifacts this turn created or changed. Stamped onto the assistant
   * message once it is persisted, so a RELOADED transcript still shows the
   * chip where the thing came from — otherwise the pane holds the current
   * artifact and nothing in the history says which turn made which.
   */
  private readonly artifactIds = new Set<number>();
  /** The answer's record mentions and their pages (`record_links`), applied to the stored text. */
  private mentionLinks: Array<{ text: string; href: string }> = [];

  onArtifact(id: number): void {
    if (Number.isInteger(id) && id > 0) {
      this.artifactIds.add(id);
    }
  }

  get touchedArtifactIds(): number[] {
    return [...this.artifactIds];
  }

  onTraceNode(event: Record<string, unknown>): void {
    const id = typeof event.id === 'string' ? event.id : null;
    if (!id) {
      return;
    }
    const prev = this.trace.get(id);
    const node = event as unknown as ConversationTraceNode & { delta?: string; type?: string };
    const merged: ConversationTraceNode = {
      ...prev,
      ...node,
      // Where in the answer the step began, fixed on first sight: the text
      // runs already flushed plus the one still accumulating. The live
      // surface computes the same number the same way (`useChatSession`),
      // so a reloaded transcript interleaves exactly as the streamed one did.
      anchor: prev?.anchor ?? this.textRunCount(),
      text: (prev?.text ?? '') + (typeof node.delta === 'string' ? node.delta : ''),
      citations: node.citations ?? prev?.citations,
      result: node.result ?? prev?.result,
      resultDetail: node.resultDetail ?? prev?.resultDetail,
      tool: node.tool ?? prev?.tool,
      args: node.args ?? prev?.args,
      detail: node.detail ?? prev?.detail,
      labels: node.labels ?? prev?.labels,
    };
    if (merged.labels && merged.status !== 'error') {
      merged.label = stepLabelFor(merged.labels, merged.status as 'start' | 'progress' | 'done');
    }
    delete (merged as { delta?: string }).delta;
    delete (merged as { type?: string }).type;
    this.trace.set(id, merged);
  }

  onDocuments(docs: CollectedDoc[]): void {
    for (const d of docs) {
      const key = `${d.citationIndex ?? ''}:${d.document_id}:${d.semantic_identifier}`;
      if (!this.docKeys.has(key)) {
        this.docKeys.add(key);
        this.documents.push(d);
      }
    }
  }

  onTextDelta(delta: string): void {
    if (!delta) {
      return;
    }
    this.currentText = (this.currentText ?? '') + delta;
  }

  onToolStart(name: string, input: Record<string, unknown>): void {
    this.flushText();
    this.runs.push({ type: 'tool', name, input });
  }

  /**
   * The answer's record mentions, linked (`record_links`): applied to every
   * text passage when the turn is written down, so a reload links what the
   * live transcript linked.
   * @param links - The mentions and their pages.
   */
  onRecordLinks(links: Array<{ text: string; href: string }>): void {
    this.mentionLinks.push(...links);
  }

  /**
   * A Decision this turn raised, or one whose state moved: one run per
   * Decision, its state kept current.
   * @param d - The Decision.
   * @param d.id - Its id.
   * @param d.question - Its question.
   * @param d.state - Its state.
   */
  onDecision(d: { id: number; question: string; state: string }): void {
    const known = this.runs.find((r): r is Extract<ConversationRun, { type: 'decision' }> => r.type === 'decision' && r.id === d.id);
    if (known) {
      known.state = d.state;
      return;
    }
    this.flushText();
    this.runs.push({ type: 'decision', id: d.id, question: d.question, state: d.state });
  }

  /**
   * A Done receipt: one per run, so a re-emitted receipt does not stack.
   * @param receipt - The receipt.
   */
  onReceipt(receipt: Extract<ConversationRun, { type: 'receipt' }>['receipt']): void {
    if (this.runs.some(r => r.type === 'receipt' && r.receipt.runId === receipt.runId)) {
      return;
    }
    this.flushText();
    this.runs.push({ type: 'receipt', receipt });
  }

  /**
   * The follow-ups the reply ended with — one set per turn, the last wins,
   * kept after the text so a reload draws the same pills.
   * @param items - The pills.
   */
  onSuggestions(items: Extract<ConversationRun, { type: 'suggestions' }>['items']): void {
    this.runs = this.runs.filter(r => r.type !== 'suggestions');
    if (items.length === 0) {
      return;
    }
    this.flushText();
    this.runs.push({ type: 'suggestions', items });
  }

  onCard(card: CardRunInput): void {
    // Written once: the route tees a card when it is first seen AND again
    // when the auto-filed copy is written to the stream (finding 18).
    if (this.hasCard(card.label, card.actionId)) {
      if (card.runId !== undefined) {
        this.onCardFiled(card.label, card.actionId, card.runId);
      }
      return;
    }
    this.flushText();
    this.runs.push(cardRunOf(card));
  }

  /**
   * Is this card already on the ledger?
   * @param label
   * @param actionId
   */
  hasCard(label: string, actionId: string): boolean {
    return this.runs.some(r => r.type === 'card' && r.label === label && r.actionId === actionId);
  }

  /**
   * The card was filed as a proposal after it was written down: stamp the id.
   * @param label
   * @param actionId
   * @param runId
   * @param outcome
   * @param outcome.state
   * @param outcome.ref
   * @param outcome.ref.type
   * @param outcome.ref.id
   */
  onCardFiled(label: string, actionId: string, runId: number, outcome: { state?: string; ref?: { type: string; id: number } } = {}): void {
    for (const r of this.runs) {
      if (r.type === 'card' && r.label === label && r.actionId === actionId) {
        r.runId = runId;
        r.state = outcome.state ?? 'filed';
        if (outcome.ref) {
          r.ref = outcome.ref;
        }
      }
    }
  }

  /**
   * A card the turn tried to file and could not: its state says so, and why.
   * @param label - The card's label.
   * @param actionId - Its action.
   * @param why - What the filing said.
   */
  onCardUnfiled(label: string, actionId: string, why: string): void {
    for (const r of this.runs) {
      if (r.type === 'card' && r.label === label && r.actionId === actionId && r.runId === undefined) {
        r.state = 'unfiled';
        r.reason = why.slice(0, 300);
      }
    }
  }

  onToolEnd(name: string, output: string): void {
    // Attach the output to the most recent matching tool run, if found.
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i];
      if (r && r.type === 'tool' && r.name === name && !r.output) {
        r.output = output.slice(0, 4000);
        return;
      }
    }
  }

  /**
   * A tool that FAILED. Persisted like any other step, because a reloaded
   * transcript that shows a delegation starting and nothing after it is the
   * defect this whole file's trace exists to prevent. `task` never gets a
   * `tool_start` breadcrumb (it is a delegate trace node instead), so its
   * failure is appended rather than matched.
   * @param name - Raw tool name from the `tool_error` event.
   * @param message - What went wrong.
   */
  onToolError(name: string, message: string): void {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i];
      if (r && r.type === 'tool' && r.name === name && !r.output) {
        r.output = message.slice(0, 4000);
        r.state = 'error';
        return;
      }
    }
    this.flushText();
    this.runs.push({ type: 'tool', name, input: {}, output: message.slice(0, 4000), state: 'error' });
  }

  /** Text runs that exist or will exist before the next step: flushed ones plus the passage in progress. */
  private textRunCount(): number {
    return this.runs.filter(r => r.type === 'text').length + (this.currentText?.trim() ? 1 : 0);
  }

  private flushText(): void {
    if (this.currentText !== null) {
      const t = this.currentText;
      if (t.trim()) {
        this.runs.push({ type: 'text', text: t });
      }
      this.currentText = null;
    }
  }

  finalise(): { text: string; runs: ConversationRun[]; documents: CollectedDoc[]; trace: ConversationTraceNode[] } {
    this.flushText();
    if (this.mentionLinks.length > 0) {
      for (const r of this.runs) {
        if (r.type === 'text') {
          r.text = linkRecordMentions(r.text, this.mentionLinks);
        }
      }
    }
    const text = this.runs
      .filter((r): r is { type: 'text'; text: string } => r.type === 'text')
      .map(r => r.text)
      .join('\n\n')
      .trim();
    return { text, runs: this.runs, documents: this.documents, trace: [...this.trace.values()] };
  }
}
