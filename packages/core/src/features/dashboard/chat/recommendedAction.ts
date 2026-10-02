import type { CardDecision, CardField, CardLastAttempt, RecommendedAction } from './types';

/**
 * The event boundary for `recommended_action`.
 *
 * A card is one tap away from `client.review.propose`, and at
 * `act-within-bounds` it fires that call the moment it renders — so a
 * malformed payload is not a rendering problem, it is an RPC the person never
 * asked for. On 2026-09-15 two of them went out with no `actionId` and came
 * back 400 ("expected string, received undefined"), which is the server
 * catching a mistake the client should never have been able to make.
 *
 * So the shape is checked once, here, where the event arrives — not in the
 * card, not in the router. A payload that cannot produce a valid call is
 * dropped with a reason the trace can show, and nothing downstream has to be
 * defensive about it.
 */

export type RecommendedActionCheck
  = | { ok: true; rec: RecommendedAction }
    | { ok: false; reason: string };

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * A card's record link, only when it is a path inside the app — a card is
 * agent output, and a link it carries must not leave the product.
 * @param href - The link as it arrived.
 * @param label - Its words.
 */
export function cardLink(href: unknown, label: unknown): { href: string; hrefLabel?: string } | Record<string, never> {
  const h = text(href);
  if (!h.startsWith('/') || h.startsWith('//')) {
    return {};
  }
  return { href: h, ...(text(label) ? { hrefLabel: text(label) } : {}) };
}

/**
 * Everything a card shows beyond its title and button, copied from a stored
 * card run or a live `card` event onto the client's card — so a reload and
 * the live stream draw the same card. Both links go through `cardLink`, so
 * neither can leave the product. Absent keys stay absent.
 * @param card - A stored card run or the card from the wire.
 * @param card.kind
 * @param card.body
 * @param card.fields
 * @param card.secondaryHref
 * @param card.secondaryHrefLabel
 * @param card.lastAttempt
 * @param card.decision
 */
export function cardShown(card: { kind?: string; body?: string; fields?: CardField[]; secondaryHref?: string; secondaryHrefLabel?: string; lastAttempt?: CardLastAttempt; decision?: CardDecision }): Partial<RecommendedAction> {
  const second = cardLink(card.secondaryHref, card.secondaryHrefLabel);
  return {
    ...(card.kind ? { kind: card.kind } : {}),
    ...(card.body ? { body: card.body } : {}),
    ...(card.fields ? { fields: card.fields } : {}),
    ...('href' in second ? { secondaryHref: second.href, ...(second.hrefLabel ? { secondaryHrefLabel: second.hrefLabel } : {}) } : {}),
    ...(card.lastAttempt ? { lastAttempt: card.lastAttempt } : {}),
    ...(card.decision ? { decision: card.decision } : {}),
  };
}

/**
 * Validate one `recommended_action` payload.
 *
 * Required: an `actionId` (what would be proposed) and a `label` (what the
 * person is being asked to agree to). `input` is normalised to an object,
 * because an action with no arguments is legitimate and an action with a
 * mangled one is not.
 * @param raw - `event.recommendation`, exactly as it arrived.
 */
export function readRecommendedAction(raw: unknown): RecommendedActionCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'the recommendation payload was missing' };
  }
  const r = raw as Record<string, unknown>;
  const actionId = text(r.actionId);
  if (!actionId) {
    return { ok: false, reason: 'the recommendation named no action, so there was nothing to prepare' };
  }
  const label = text(r.label);
  if (!label) {
    return { ok: false, reason: `the recommendation for "${actionId}" had no label, so there was nothing to agree to` };
  }
  const input = r.input && typeof r.input === 'object' && !Array.isArray(r.input)
    ? (r.input as Record<string, unknown>)
    : {};
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : undefined;
  const runId = typeof r.runId === 'number' && Number.isInteger(r.runId) ? r.runId : undefined;
  // The agent's own recommendation for the card this becomes. Both or
  // neither: a verdict with no sentence cannot be checked by the reviewer it
  // is shown to, and a sentence with no verdict argues for an outcome the
  // card never names. Dropping a half-filled pair leaves the card with no
  // recommendation, which the queue reads as "nothing judged this".
  const decision = text(r.suggestedDecision);
  const reason = text(r.suggestedDecisionReason);
  const advises = (decision === 'approve' || decision === 'reject' || decision === 'snooze') && reason !== '';
  return {
    ok: true,
    rec: {
      actionId,
      label,
      input,
      ...(text(r.rationale) ? { rationale: text(r.rationale) } : {}),
      ...(confidence === undefined ? {} : { confidence }),
      ...(text(r.agentSlug) ? { agentSlug: text(r.agentSlug) } : {}),
      ...(runId === undefined ? {} : { runId }),
      ...(advises ? { suggestedDecision: decision as 'approve' | 'reject' | 'snooze', suggestedDecisionReason: reason } : {}),
      ...cardLink(r.href, r.hrefLabel),
      ...draftOf(r.draft),
    },
  };
}

/**
 * A "Draft needed" card's prompt and what the bar said, when both are text.
 * @param raw - `draft` as it arrived.
 */
export function draftOf(raw: unknown): { draft: { prompt: string; missing: string } } | Record<string, never> {
  const d = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  const prompt = text(d?.prompt);
  return prompt ? { draft: { prompt: prompt.slice(0, 2000), missing: text(d?.missing).slice(0, 600) } } : {};
}

/**
 * What approving a card DOES, in plain words, from its action id — never from
 * the agent's title, which says what the agent wants rather than what the
 * button will do (Chris, 2026-09-28: "I don't understand what the first card
 * did"). Present tense, so one line reads true before and after: "Files a
 * request on Work" is what it will do and what it did.
 *
 * Kept on the client so a card can say it before any run exists. An id not in
 * the map still gets a line — the id itself, made readable.
 */
const ACTION_EFFECT: Record<string, string> = {
  'objects.propose_candidate': 'Files a request on Work',
  'objects.update_meta': 'Changes the record',
  'objects.rename': 'Renames the record',
  'factory.dispatch_task': 'Starts the build',
  'ask.file': 'Asks you to rule',
  'ask.withdraw': 'Withdraws the ask',
  'git.merge': 'Hands you the merge',
  'git.push_branch': 'Pushes the branch for review',
  'deploy.release': 'Releases the deploy',
  'deploy.provision': 'Provisions the infrastructure',
  'release.announce': 'Announces the release',
  'notify.requester': 'Answers the person who asked',
  'gmail.send': 'Sends the email',
  'chat.post_message': 'Posts the chat message',
  'hubspot.update': 'Updates the HubSpot record',
  'wiki.write_page': 'Writes the wiki page',
  'playbook.write': 'Writes the playbook',
  'mission.update_notes': 'Updates the mission notes',
  'learning.adopt_rule': 'Adopts the rule',
  'agent.revise_prompt': 'Revises the agent\'s instructions',
  'team.hire_agent': 'Adds the agent to the team',
  'plugin.enable': 'Turns the plugin on or off',
  'personalization.enroll': 'Enrolls the contact in the sequence',
  'qc.hold': 'Holds the kit',
  'qc.release': 'Releases the kit',
  'qc.request_rework': 'Sends it back for rework',
  'dataset.add_example': 'Adds it to the dataset',
};

/**
 * The one line a card shows for what approving it does.
 * @param actionId - The card's action id (`rec.actionId`).
 */
export function describeActionEffect(actionId: string): string {
  const id = actionId.trim();
  if (!id) {
    return 'Nothing to run: this is a note';
  }
  const known = ACTION_EFFECT[id];
  if (known) {
    return known;
  }
  // `crm.log_call` → "Runs crm: log call". Readable, and still the real name.
  const [system, ...rest] = id.split('.');
  const verb = rest.join(' ').replace(/[_-]+/g, ' ').trim();
  return verb ? `Runs ${system}: ${verb}` : `Runs ${system}`;
}

export type CardStateInput = {
  /** The run's status, or null when nothing is filed yet. */
  status: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  approvedByAgent?: boolean;
  /** The turn tried to file the card and could not (`card_update` state `unfiled`); nothing is in Review. */
  unfiled?: boolean;
  /** What a done run did, from its result — "changed request #124: outcome, mainRisk". */
  summary?: string | null;
  /** The filing misses its type's bar; nothing is filed until a draft is written. */
  draft?: boolean;
  /** A ruling's answer: the option, and whether the trust bar chose it. */
  choice?: { label: string; byTrustBar: boolean } | null;
};

/**
 * The card's state as ONE clause — who has it and what happened. It used to
 * be assembled from four fragments ("Done · approved by … · Undo · filed by
 * the agent within bounds"), which read as both auto-approved and approved by
 * a person at once. Filing and deciding are different facts: filing is
 * bookkeeping, deciding is the state.
 * @param s - What the run says.
 * @param time - Formats `decidedAt`.
 */
export function describeCardState(s: CardStateInput, time: (iso: string) => string): { label: string; tone: 'muted' | 'amber' | 'green' | 'red' } {
  const by = s.decidedBy ? ` by ${s.decidedBy}` : '';
  const at = s.decidedAt ? ` · ${time(s.decidedAt)}` : '';
  // A card that was meant to be filed and was not is not waiting on anyone:
  // "Waiting on you" over no action run was a promise (conversation 349).
  if (s.unfiled && s.status === null) {
    return { label: 'Not filed', tone: 'red' };
  }
  // A filing that misses its bar is not waiting on a decision — it is
  // waiting on a draft, and the card's one button asks for it.
  if (s.draft && s.status === null) {
    return { label: 'Draft needed', tone: 'amber' };
  }
  // DONE SAYS WHAT WAS DONE (Chris, 2026-09-28: "Done for you · Undo" did not
  // telegraph that it had already run). The run's own result names it.
  const did = s.summary?.trim() ? ` — ${s.summary.trim()}` : '';
  switch (s.status) {
    case null:
    case 'pending':
      return { label: 'Waiting on you', tone: 'amber' };
    case 'executing':
      return s.approvedByAgent
        ? { label: 'Done for you · running', tone: 'amber' }
        : { label: `Approved${by} · running`, tone: 'amber' };
    case 'done':
      // A ruling reads as its answer: the option, and who chose it.
      if (s.choice) {
        return { label: s.choice.byTrustBar ? `Chose ${s.choice.label} for you` : `You chose ${s.choice.label}`, tone: 'green' };
      }
      return s.approvedByAgent
        ? { label: `Done for you${did}`, tone: 'green' }
        : { label: `Approved${by}${at}${did}`, tone: 'green' };
    case 'rejected':
      return { label: `Rejected${by}${at}`, tone: 'red' };
    case 'undone':
      return { label: `Undone${by}${at}`, tone: 'muted' };
    case 'closed':
      // The review sweep closed it: nobody decided, its reason was gone.
      return { label: `Closed — no longer needed${at}`, tone: 'muted' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'snoozed':
      return { label: 'Deferred', tone: 'muted' };
    default:
      return { label: s.status, tone: 'muted' };
  }
}
