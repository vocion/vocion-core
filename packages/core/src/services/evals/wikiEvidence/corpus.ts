/**
 * The made-up workspace the `wiki-evidence` eval runs on (ADR 0012): twenty
 * internal documents of a small consultancy that supersede, amend and refer
 * to one another, and the wiki its curator compiled from them some months
 * ago. Every name, number and person here is invented.
 *
 * The traps are deliberate, the way real libraries are:
 * - the wiki's travel page was compiled from the 2025 policy, which the 2026
 *   policy has since replaced;
 * - the refund policy's window changed after the wiki cited it;
 * - the retention page cites the 2024 schedule, since replaced;
 * - the onboarding checklist still points at the 2025 travel policy;
 * - an amendment memo changes the refund window for one kind of account.
 */
import type { SourceDoc } from '@/libs/memory/evidence';
import { docIdsIn, EvidenceGraph, sourceEdges, wikiEdges } from '@/libs/memory/evidence';

export type CorpusPage = { slug: string; title: string; summary: string; md: string };

const doc = (id: number, title: string, passages: string[]): SourceDoc => ({ id, title, uri: `https://docs.example.com/d/${id}`, passages });

export const CORPUS_DOCS: SourceDoc[] = [
  doc(101, 'Travel and Expense Policy 2025', [
    'Purpose. This policy sets how staff book travel and claim expenses during 2025.',
    'Meals. The domestic per diem is $60 per day; international trips use the same rate converted at the booking-day exchange rate.',
    'Hotels. Hotel stays are capped at $180 per night, taxes included.',
    'Receipts. Submit receipts in the expense tool within 30 days of the trip ending.',
    'Flights. Book economy for any flight; premium economy needs a director\'s approval.',
  ]),
  doc(102, 'Travel and Expense Policy 2026', [
    'Purpose. This policy supersedes the Travel and Expense Policy 2025 from 1 January 2026.',
    'Meals. The domestic per diem is $75 per day.',
    'Hotels. Hotel stays are capped at $210 per night, or $260 per night in a city on the High-Cost City List.',
    'Receipts. Submit receipts in the expense tool within 14 days of the trip ending.',
    'Flights. Book economy for flights under 8 hours; premium economy is allowed for flights of 8 hours or more.',
  ]),
  doc(103, 'High-Cost City List', [
    'These cities count as high-cost for hotel caps: New York, San Francisco, London and Zurich.',
    'The list is reviewed every January by the finance team.',
  ]),
  doc(104, 'Refund Policy', [
    'Window. Customers may request a refund within 14 days of delivery.',
    'Method. Refunds go back to the original payment method within 5 business days of approval.',
    'Exclusions. Custom work that the customer signed off is not refundable.',
  ]),
  doc(105, 'Refund Memo for Enterprise Accounts', [
    'This memo amends the Refund Policy for enterprise accounts on annual contracts.',
    'Enterprise accounts on annual contracts may request a refund within 45 days of delivery.',
  ]),
  doc(106, 'Rate Card 2026', [
    'This rate card replaces the Rate Card 2025. Senior consultant: $210 per hour. Consultant: $160 per hour. Analyst: $110 per hour.',
    'Discounts are applied under the Discount Approval Policy.',
  ]),
  doc(107, 'Discount Approval Policy', [
    'An account executive may approve a discount of up to 10%.',
    'A discount above 10% and up to 20% needs the sales director\'s approval. A discount above 20% needs the CFO\'s approval.',
  ]),
  doc(108, 'Statement of Work Template', [
    'Rates. Rates follow the Rate Card 2026 unless the SOW names others.',
    'Payment. Invoices are payable net 30.',
    'Changes. Changes to scope are handled per the Change Request Procedure.',
  ]),
  doc(109, 'Change Request Procedure', [
    'Any change request over $5,000 needs the client\'s sign-off in writing before work starts.',
    'We answer every change request within 3 business days.',
  ]),
  doc(110, 'Rate Card 2025', [
    'Senior consultant: $190 per hour. Consultant: $145 per hour. Analyst: $100 per hour.',
  ]),
  doc(111, 'IT Security Policy', [
    'Devices. Every laptop is encrypted before it is handed over.',
    'Accounts. Multi-factor authentication is required on every account. Passwords are at least 14 characters.',
    'Incidents. Incidents are reported under the Incident Response Runbook.',
  ]),
  doc(112, 'Incident Response Runbook', [
    'Report any security incident within 1 hour in the #security-desk channel.',
    'The on-call security lead is Priya Raman.',
  ]),
  doc(113, 'Onboarding Checklist', [
    'Day 1: an encrypted laptop, set up as the IT Security Policy requires.',
    'Day 3: expense tool training, per the Travel and Expense Policy 2025.',
    'Week 1: a buddy from another team.',
  ]),
  doc(114, 'Holiday Calendar 2026', [
    'The office is closed from 24 December to 1 January.',
    'Everyone has 2 floating holidays a year.',
  ]),
  doc(115, 'Remote Work Policy', [
    'Staff may work remotely up to 3 days a week.',
    'Home equipment is covered under the Equipment Stipend Guidelines.',
  ]),
  doc(116, 'Equipment Stipend Guidelines', [
    'A one-time stipend of $500 covers a home desk and chair.',
    'An annual refresh of $150 covers replacement equipment, from the second year on.',
  ]),
  doc(117, 'Vendor Onboarding Procedure', [
    'A vendor with an annual contract over $25,000 needs a security review under the IT Security Policy.',
    'Every vendor sends a W-9 before the first payment.',
  ]),
  doc(118, 'Data Retention Schedule', [
    'This schedule supersedes the Data Retention Schedule 2024.',
    'Customer records are kept for 7 years. Call recordings are kept for 18 months.',
  ]),
  doc(119, 'Data Retention Schedule 2024', [
    'Customer records are kept for 7 years.',
    'Call recordings are kept for 36 months.',
  ]),
  doc(120, 'Pricing FAQ', [
    'Nonprofits may get up to 15% off, approved under the Discount Approval Policy.',
    'We do not discount the Analyst rate.',
  ]),
];

/**
 * The passages the wiki was compiled from, where they differed then: the
 * refund window was 30 days when the curator cited it.
 */
export const CORPUS_PASSAGES_AT_COMPILE: Record<string, string> = {
  '104.0': 'Window. Customers may request a refund within 30 days of delivery.',
};

export const CORPUS_WIKI: CorpusPage[] = [
  {
    slug: 'travel',
    title: 'Travel and expenses',
    summary: 'Per diem, hotel caps, receipts and flights.',
    md: [
      '## Travel',
      '',
      '- The domestic per diem is $60 per day. [src:101.1]',
      '- Hotels are capped at $180 per night. [src:101.2]',
      '- Receipts are due within 30 days of the trip. [src:101.3]',
      '- Book economy; premium economy needs a director. [src:101.4]',
    ].join('\n'),
  },
  {
    slug: 'refunds',
    title: 'Refunds',
    summary: 'The refund window and how refunds are paid.',
    md: [
      'Customers can get a refund within 30 days of delivery. [src:104.0]',
      'Refunds go back to the original payment method within 5 business days. [src:104.1]',
    ].join('\n'),
  },
  {
    slug: 'pricing',
    title: 'Pricing and discounts',
    summary: 'Hourly rates and who approves a discount.',
    md: [
      '- Senior consultants bill $210 per hour. [src:106.0]',
      '- Discounts above 20% need the CFO. [src:107.1]',
      '- SOWs are payable net 30. [src:108.1]',
    ].join('\n'),
  },
  {
    slug: 'security',
    title: 'Security basics',
    summary: 'Accounts, devices and incidents. See also [onboarding](/wiki/onboarding.md).',
    md: [
      '- Multi-factor authentication is required on every account. [src:111.1]',
      '- Report an incident within one hour in #security-desk. [src:112.0]',
      '',
      'New starters: see [Onboarding](/wiki/onboarding.md).',
    ].join('\n'),
  },
  {
    slug: 'onboarding',
    title: 'Onboarding',
    summary: 'A new starter\'s first week.',
    md: [
      '- Day 1: an encrypted laptop. [src:113.0]',
      '- Day 3: expense tool training. [src:113.1]',
      '- Week 1: a buddy from another team. [src:113.2]',
    ].join('\n'),
  },
  {
    slug: 'data-retention',
    title: 'Data retention',
    summary: 'How long we keep records and recordings.',
    md: [
      '- Customer records are kept for 7 years. [src:119.0]',
      '- Call recordings are kept for 36 months. [src:119.1]',
    ].join('\n'),
  },
];

/** The evidence graph of the made-up workspace, built the way the live one is. */
export function corpusGraph(): EvidenceGraph {
  const byId = new Map(CORPUS_DOCS.map(d => [d.id, d]));
  const atCompile = (docId: number, idx: number | null): string | null => {
    const key = `${docId}.${idx}`;
    if (CORPUS_PASSAGES_AT_COMPILE[key]) {
      return CORPUS_PASSAGES_AT_COMPILE[key]!;
    }
    const d = byId.get(docId);
    return d ? (idx === null ? d.passages.join('\n') : d.passages[idx] ?? null) : null;
  };
  const edges = [...CORPUS_WIKI.flatMap(p => wikiEdges(p, atCompile).edges), ...sourceEdges(CORPUS_DOCS)];
  const ids = new Set(docIdsIn(edges));
  return new EvidenceGraph({
    edges,
    pages: CORPUS_WIKI.map(p => ({ slug: p.slug, title: p.title, summary: p.summary })),
    docs: CORPUS_DOCS.filter(d => ids.has(d.id)).map(d => ({ id: d.id, title: d.title, uri: d.uri })),
    passages: async docId => byId.get(docId)?.passages ?? null,
  });
}
