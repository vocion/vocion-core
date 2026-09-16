/**
 * Is this message feedback about the product?
 *
 * "Every interaction should teach the system something" (docs/MANIFESTO.md §9,
 * Improvement must be visible*). A person who replies to an agent in Slack
 * with "you should have had the thread context here" has just written a
 * requirement. Left in the thread it is read once; recognised, it becomes a
 * proposed rule and a question in somebody's inbox.
 *
 * Cheap and pure on purpose. The heuristic decides the clear cases — a demand,
 * a complaint, a "you should have…" — and returns `unsure` for the rest, which
 * is the ONLY case where a model is asked. A classifier that calls a model on
 * "thanks!" costs a turn to learn nothing.
 *
 * It answers "does this read as feedback", never "is this feedback true" or
 * "should we build it". Those are a person's calls, which is why the outcome
 * is an ask and not a commit.
 */

export type FeedbackVerdict = 'feedback' | 'not_feedback' | 'unsure';

export type FeedbackSignal = {
  verdict: FeedbackVerdict;
  /** Which patterns fired, so a wrong call is debuggable without a model. */
  signals: string[];
};

/** Patterns that say "this is a requirement or a complaint", with the name that explains why. */
const STRONG: { name: string; re: RegExp }[] = [
  // "you should have had context", "we shouldn't need to ask twice"
  { name: 'should', re: /\b(?:should(?:'ve|n't)?|shouldnt)\b/i },
  { name: 'should-have', re: /\bshould\s+(?:have|be|not|never|always)\b/i },
  // "why doesn't it…", "why can't I…", "why is there no…"
  { name: 'why-not', re: /\bwhy\s+(?:do(?:es)?n't|can't|cannot|is(?:n't)? there no|are there no|didn't)\b/i },
  // a complaint about behaviour that happened
  { name: 'failed', re: /\b(?:doesn't work|does not work|not working|is broken|it broke|fumbled|got it wrong|failed to|didn't (?:work|do|have|know))\b/i },
  // "I expected", "that's not what I asked for"
  { name: 'expectation', re: /\b(?:i expected|not what i (?:asked|wanted|meant)|that's wrong|this is wrong)\b/i },
  // "I should have been able to", "you should be able to"
  { name: 'able-to', re: /\b(?:should|could)\s+(?:have\s+)?be(?:en)?\s+able\s+to\b/i },
  // "close this gap", "this is a gap"
  { name: 'gap', re: /\b(?:functional gap|close (?:this|that) gap|missing (?:feature|capability))\b/i },
];

/** Patterns that say "this is a request", weaker on their own. */
const REQUEST: { name: string; re: RegExp }[] = [
  { name: 'ask-for', re: /\b(?:can you|could you|would you|can we|could we)\b/i },
  { name: 'please', re: /\bplease\b/i },
  { name: 'wish', re: /\b(?:i want|i'd like|i would like|it would be (?:nice|better|good)|wish (?:it|you|we))\b/i },
  { name: 'need', re: /\b(?:we need|i need|needs to)\b/i },
  // An imperative: "add a tool that…", "fix the reply path" — at the start of
  // the message, or after the polite opening that so often precedes it.
  { name: 'imperative', re: /(?:^|\b(?:you|we|please|and|then)\s+)(?:add|fix|make|build|support|allow|let|change|remove|stop|start|use|give|show|send|record|track|teach|handle)\b/i },
];

/** Gratitude and acknowledgement — never feedback, however warm. */
const ACK = /^(?:thanks|thank you|thx|ty|nice|great|awesome|perfect|cool|got it|ok|okay|[k👍🙏]|❤️|\p{Extended_Pictographic})[\s!.,:)]*$/iu;

/** A plain question about facts or logistics: answer it, do not file it. */
const LOGISTICS = /^(?:what|when|where|who|which|how (?:many|much|long|is|are|was|were|did|do|does))\b/i;

/**
 * Classify a message as product feedback, not feedback, or too ambiguous to
 * say without a model.
 *
 * Order matters: a bare acknowledgement short-circuits, then the strong
 * patterns, then the request patterns. A logistics question with no request
 * pattern is not feedback; one that also asks for a change is `unsure`, and
 * the model breaks the tie.
 * @param text - What the person wrote, mentions already stripped.
 */
export function classifyFeedback(text: string): FeedbackSignal {
  const t = text.trim();
  if (!t) {
    return { verdict: 'not_feedback', signals: ['empty'] };
  }
  if (ACK.test(t)) {
    return { verdict: 'not_feedback', signals: ['acknowledgement'] };
  }
  const strong = STRONG.filter(p => p.re.test(t)).map(p => p.name);
  if (strong.length > 0) {
    return { verdict: 'feedback', signals: strong };
  }
  const requests = REQUEST.filter(p => p.re.test(t)).map(p => p.name);
  if (requests.length >= 2) {
    return { verdict: 'feedback', signals: requests };
  }
  if (requests.length === 1) {
    return { verdict: 'unsure', signals: requests };
  }
  if (LOGISTICS.test(t)) {
    return { verdict: 'not_feedback', signals: ['logistics-question'] };
  }
  return { verdict: 'unsure', signals: [] };
}

/**
 * The instruction that rides under a message the classifier flagged. In code
 * rather than in the system prompt, because it names the exact tool and the
 * exact condition, and because a rule every agent must follow on a surface
 * should not depend on which agent answered.
 * @param signal - The classification.
 */
export function feedbackNote(signal: FeedbackSignal): string {
  if (signal.verdict === 'not_feedback') {
    return '';
  }
  const lead = signal.verdict === 'feedback'
    ? 'This message reads as feedback or an instruction about the product itself.'
    : 'This message may be feedback or an instruction about the product itself — decide, and if it is:';
  return `\n\n--- this is feedback ---\n${lead} Call \`file_feedback\` with it: that records what was said as a proposed rule and, where this workspace has a team that builds, puts a recommendation in the Needs-you inbox for a person to approve. Then say in your reply what you filed and link it. Do not start the work from here — approving the recommendation is what starts it.`;
}
