/**
 * Made-up answers for the `agent-behaviour` eval's tools. No tool here
 * reaches a database, a connector or the network: each answers from the
 * fixture book below. The answer is shaped like the real tool's, so the
 * model keeps working the way it would. Arguments are still checked
 * against the real tool's schema (`run.ts`), so a malformed call fails as
 * it would in production.
 */

const DEALS = [
  { id: 'D-1001', name: 'Northwind retainer', company: 'Northwind', stage: 'Negotiation', amount: 78000, closeDate: '2026-11-30' },
  { id: 'D-1002', name: 'Meridian Dental rollout', company: 'Meridian Dental', stage: 'Proposal', amount: 46000, closeDate: '2026-10-31' },
  { id: 'D-1003', name: 'Meridian Dental phase 2', company: 'Meridian Dental', stage: 'Discovery', amount: 31000, closeDate: '2026-12-20' },
  { id: 'D-1004', name: 'Summit Facilities platform', company: 'Summit Facilities', stage: 'Contract sent', amount: 150000, closeDate: '2026-10-29' },
  { id: 'D-1005', name: 'Atlas Field Services pilot', company: 'Atlas Field Services', stage: 'Proposal', amount: 62000, closeDate: '2026-11-14' },
];

const CALLS = [
  { meetingId: 'M-301', title: 'Discovery: Cobalt', date: '2026-10-21', classified: false },
  { meetingId: 'M-302', title: 'Discovery: Corvus Media', date: '2026-10-22', classified: true, verdict: 'qualified' },
  { meetingId: 'M-303', title: 'Discovery: Beacon Health', date: '2026-10-23', classified: false },
];

const json = (value: unknown) => JSON.stringify(value);

/**
 * What one tool answers, given its arguments.
 * @param name - The tool.
 * @param args - What the model passed (already checked against the schema).
 */
export function stubAnswer(name: string, args: Record<string, unknown>): string {
  const company = typeof args.company === 'string' ? args.company : typeof args.query === 'string' ? args.query : '';
  if (name === 'hubspot_list_deals' || name === 'hubspot_company_deals' || name === 'hubspot_count_deals') {
    const deals = company ? DEALS.filter(d => d.company.toLowerCase().includes(company.toLowerCase())) : DEALS;
    return json({ total: (deals.length ? deals : DEALS).length, deals: deals.length ? deals : DEALS });
  }
  if (name === 'hubspot_search_companies' || name === 'hubspot_get_company') {
    return json({ companies: [...new Set(DEALS.map(d => d.company))].map((c, i) => ({ id: `C-${200 + i}`, name: c })) });
  }
  if (name.startsWith('hubspot_')) {
    return json({ results: DEALS.slice(0, 3) });
  }
  if (name === 'get_discovery_ledger' || name === 'match_meetings' || name === 'reconcile_discovery_window') {
    return json({ window: '2026-10-19..2026-10-25', calls: CALLS });
  }
  if (name === 'recommend_action') {
    return json({ status: 'done', actionId: args.action_id, summary: `Done: ${String(args.label ?? 'the change')}. The person can undo it from the card.` });
  }
  if (name === 'propose_action') {
    return json({ status: 'proposed', proposalId: 512, note: 'Waiting for approval on the Review page.' });
  }
  if (name === 'render_chart' || name === 'render_deck' || name === 'render_document' || name === 'render_table' || name === 'render_markdown') {
    return json({ artifactId: 9001, status: 'rendered' });
  }
  if (name === 'generate_image') {
    return json({ artifactId: 9002, status: 'image created' });
  }
  if (name === 'write_wiki_page') {
    return json({ path: String(args.path ?? 'onboarding-checklist'), status: 'saved' });
  }
  if (name === 'goal_create') {
    return json({ goalId: 77, status: 'drafted as a Decision for the person to confirm' });
  }
  if (name === 'remember_preference') {
    return json({ status: 'remembered' });
  }
  if (name === 'file_ask') {
    return json({ askId: 41, status: 'filed', to: args.to ?? 'finance' });
  }
  if (name === 'query_state' || name === 'search_knowledge' || name === 'lookup_objects') {
    return json({ results: [{ title: 'Pipeline review notes, 2026-10-20', excerpt: '38 open deals, $4.1M raw, $2.4M weighted.' }] });
  }
  if (name === 'get_gmail_thread') {
    return json({ subject: 'Revised SOW', messages: [{ from: 'ops@northwind.example', date: '2026-10-26', body: 'Thanks, reviewing the revised SOW this week.' }] });
  }
  return json({ ok: true, note: 'No records match in the sample data.' });
}
