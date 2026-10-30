/**
 * The questions of the `wiki-evidence` eval (ADR 0012), on the made-up
 * workspace in `corpus.ts`. Two kinds, as in the write-up the ADR follows:
 *
 * - `simple`: one passage answers it. The control: memory should not help
 *   much, and must not hurt.
 * - `connected`: the answer crosses documents: a newer version, an amendment,
 *   a reference to follow, a claim whose source changed.
 *
 * Graded without a model: every `mustSay` pattern in the answer, and no
 * `mustNotSay` pattern stated as current (`score.ts`).
 */
export type QuestionKind = 'simple' | 'connected';

export type EvidenceQuestion = {
  id: string;
  kind: QuestionKind;
  question: string;
  mustSay: RegExp[];
  /** Values that would be wrong if stated as current: old versions, the pre-change wiki. */
  mustNotSay?: RegExp[];
  /** The documents a well-grounded answer cites. */
  evidence: number[];
};

export const EVIDENCE_QUESTIONS: EvidenceQuestion[] = [
  { id: 's-password', kind: 'simple', question: 'How long must a password be?', mustSay: [/\b14\b/], evidence: [111] },
  { id: 's-holiday', kind: 'simple', question: 'When is the office closed over the holidays?', mustSay: [/24\s*(?:th\s*)?(?:of\s*)?dec|dec\w*\s*24/i, /1\s*(?:st\s*)?(?:of\s*)?jan|jan\w*\s*1\b/i], evidence: [114] },
  { id: 's-senior-rate', kind: 'simple', question: 'What is the senior consultant\'s hourly rate?', mustSay: [/\$\s?210/], mustNotSay: [/\$\s?190/], evidence: [106] },
  { id: 's-security-lead', kind: 'simple', question: 'Who is the on-call security lead?', mustSay: [/priya\s+raman/i], evidence: [112] },
  { id: 's-stipend', kind: 'simple', question: 'How much is the one-time home equipment stipend?', mustSay: [/\$\s?500/], evidence: [116] },
  { id: 's-remote', kind: 'simple', question: 'How many days a week can staff work remotely?', mustSay: [/\b(?:3|three)\b/i], evidence: [115] },
  { id: 's-payment-terms', kind: 'simple', question: 'What are the payment terms on our statements of work?', mustSay: [/net\s*30/i], evidence: [108] },
  { id: 's-discount-15', kind: 'simple', question: 'Who can approve a 15% discount?', mustSay: [/sales\s+director/i], evidence: [107] },
  { id: 'c-per-diem', kind: 'connected', question: 'What is our domestic per diem?', mustSay: [/\$\s?75/], mustNotSay: [/\$\s?60/], evidence: [102] },
  { id: 'c-zurich-hotel', kind: 'connected', question: 'What is the hotel cap per night for a trip to Zurich?', mustSay: [/\$\s?260/], mustNotSay: [/\$\s?180/], evidence: [102, 103] },
  { id: 'c-refund-window', kind: 'connected', question: 'How long do customers have to ask for a refund?', mustSay: [/\b14\s*(?:calendar\s*)?days?\b/i], mustNotSay: [/\b30\s*days?\b/i], evidence: [104] },
  { id: 'c-enterprise-refund', kind: 'connected', question: 'An enterprise customer on an annual contract asks for a refund 40 days after delivery. Are they inside the window?', mustSay: [/\b45\b/, /\byes\b|\binside\b|\bwithin\b|\beligible\b/i], evidence: [104, 105] },
  { id: 'c-recordings', kind: 'connected', question: 'How long do we keep call recordings?', mustSay: [/\b18\s*months?\b/i], mustNotSay: [/\b36\s*months?\b/i], evidence: [118] },
  { id: 'c-change-request', kind: 'connected', question: 'A client on a standard SOW wants a scope change worth $8,000. What does it need before work starts?', mustSay: [/\bwrit(?:ing|ten)\b/i, /sign[\s-]?off|approv|sign/i], evidence: [108, 109] },
  { id: 'c-discount-25', kind: 'connected', question: 'We want to give a new client 25% off the senior consultant rate. Who must approve it, and what hourly rate would they pay?', mustSay: [/\bCFO\b|chief financial/i, /157(?:\.50?)?\b/], mustNotSay: [/\$\s?142(?:\.50)?\b/], evidence: [106, 107] },
  { id: 'c-vendor', kind: 'connected', question: 'A new vendor contract is $40,000 a year. What review does it need, and what does that policy require of laptops?', mustSay: [/security\s+review/i, /encrypt/i], evidence: [117, 111] },
  { id: 'c-discount-dependents', kind: 'connected', question: 'Which of our documents rely on the Discount Approval Policy?', mustSay: [/rate\s+card\s+2026/i, /pricing\s+faq/i], evidence: [106, 120] },
  { id: 'c-onboarding-travel', kind: 'connected', question: 'Does the onboarding checklist\'s expense training still point at the current travel policy?', mustSay: [/\b2026\b/, /\bno\b|not\b|outdated|out of date|superseded|replaced|old/i], evidence: [113, 102] },
  { id: 'c-receipts-wiki', kind: 'connected', question: 'What does our wiki say the receipt deadline is, and is that still right?', mustSay: [/\b14\s*days?\b/i, /\b30\s*days?\b/i, /outdated|out of date|superseded|replaced|no longer|not (?:still )?(?:right|correct|current)|changed|stale/i], evidence: [102] },
  { id: 'c-refresh', kind: 'connected', question: 'Someone working remotely needs replacement equipment in their second year. What can they claim?', mustSay: [/\$\s?150/], evidence: [115, 116] },
];
