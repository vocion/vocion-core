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

// The companies in the order the search returns them: `C-200` is Northwind, `C-201` Meridian Dental.
const COMPANIES = [...new Set(DEALS.map(d => d.company))].map((name, i) => ({ id: `C-${200 + i}`, name }));

// Cobalt's call reads as promising and was disqualified: the record a guess gets wrong.
const CALLS = [
  { candidateId: 301, meetingId: 'M-301', title: 'Discovery: Cobalt', date: '2026-10-21', classified: true, verdict: 'disqualified', reason: 'no budget until 2027' },
  { candidateId: 302, meetingId: 'M-302', title: 'Discovery: Corvus Media', date: '2026-10-22', classified: true, verdict: 'qualified' },
  { candidateId: 303, meetingId: 'M-303', title: 'Discovery: Beacon Health', date: '2026-10-23', classified: false },
];

// What a knowledge search finds, by what it asked about. Each contradicts the guess its case carries.
const DOCS: Array<{ about: RegExp; title: string; excerpt: string }> = [
  { about: /refund|return/i, title: 'Client terms: refunds (2026)', excerpt: 'Refunds are available within 30 days of the invoice date. After 30 days, credit only.' },
  { about: /holiday|closed|office|christmas/i, title: 'Office calendar 2026', excerpt: 'The office is closed from December 24 to January 1 inclusive. Support is on call.' },
  { about: /onboard|checklist|new client/i, title: 'Client onboarding', excerpt: 'Kickoff call; access requests; first status report in week one.' },
  { about: /sow|northwind/i, title: 'Northwind: revised SOW', excerpt: 'Revised SOW sent 2026-10-24; Northwind reviewing this week. Thread id T-88.' },
];

const json = (value: unknown) => JSON.stringify(value);

/**
 * What one tool answers, given its arguments.
 * @param name - The tool.
 * @param args - What the model passed (already checked against the schema).
 */
export function stubAnswer(name: string, args: Record<string, unknown>): string {
  const company = typeof args.company === 'string' ? args.company : typeof args.query === 'string' ? args.query : '';
  if (name === 'hubspot_company_deals') {
    const named = COMPANIES.find(c => c.id === args.company_id);
    if (!named) {
      throw new Error(`No company with id ${String(args.company_id)}. Search for the company first; ids look like C-200.`);
    }
    return json({ company: named, deals: DEALS.filter(d => d.company === named.name) });
  }
  if (name === 'hubspot_list_deals' || name === 'hubspot_count_deals') {
    // The Atlas pilot has sat in Proposal past its threshold.
    const deals = args.stalled_only === true ? DEALS.filter(d => d.id === 'D-1005').map(d => ({ ...d, daysInStage: 34 })) : DEALS;
    return json({ total: deals.length, deals });
  }
  if (name === 'hubspot_search_companies' || name === 'hubspot_get_company') {
    const found = company ? COMPANIES.filter(c => c.name.toLowerCase().includes(company.toLowerCase())) : [];
    return json({ companies: found.length ? found : COMPANIES });
  }
  if (name.startsWith('hubspot_')) {
    return json({ results: DEALS.slice(0, 3) });
  }
  if (name === 'get_discovery_ledger' || name === 'match_meetings' || name === 'reconcile_discovery_window') {
    return json({ window: '2026-10-19..2026-10-25', total: CALLS.length, calls: CALLS });
  }
  if (name === 'classify_call') {
    const call = CALLS.find(c => c.candidateId === Number(args.candidate_id));
    if (!call) {
      throw new Error(`No discovery candidate ${String(args.candidate_id)}.`);
    }
    return json({ candidateId: call.candidateId, status: 'classified', verdict: 'qualified', confidence: 0.8 });
  }
  if (name === 'read_discovery_transcript' || name === 'get_zoom_transcript' || name === 'find_zoom_recordings') {
    return json({ meeting: 'Discovery: Beacon Health', date: '2026-10-23', recordingId: 'R-77', excerpt: 'Budget is frozen until the new fiscal year; they want a pilot quote for February.' });
  }
  if (name === 'calendar_events') {
    return json({ day: args.day ?? '2026-10-29', events: [{ start: '10:00', title: 'Pipeline review' }, { start: '14:30', title: 'Discovery: Cobalt follow-up' }] });
  }
  if (name === 'get_lead_ledger' || name === 'next_lead_to_brief') {
    return json({ queued: [{ ref: 'contacts:9412', company: 'Corvus Media', state: 'queued' }, { ref: 'contacts:9413', company: 'Beacon Health', state: 'briefed' }] });
  }
  if (name === 'next_brief_to_draft') {
    return json({ briefId: 18, company: 'Beacon Health', summary: 'Ops lead, budget frozen until February, wants a pilot quote.' });
  }
  if (name === 'save_draft_sequence') {
    return json({ status: 'saved', sequenceId: 31 });
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
  if (name === 'remember_preference' || name === 'add_learning') {
    return json({ status: 'remembered' });
  }
  if (name === 'create_project') {
    return json({ projectId: 64, title: args.title, status: 'created' });
  }
  if (name === 'add_open_item') {
    return json({ itemId: 210, title: args.title, urgent: args.urgent === true });
  }
  if (name === 'fetch_url' || name === 'web_search' || name === 'crawl_site') {
    return json({ url: 'https://example.com/pricing', text: 'Starter $49/mo, Team $199/mo, Enterprise: contact sales.' });
  }
  if (name === 'goal_list') {
    return json({ goals: [] });
  }
  if (name === 'file_ask') {
    return json({ askId: 41, status: 'filed', to: args.to ?? 'finance' });
  }
  if (name === 'query_state' || name === 'search_knowledge' || name === 'lookup_objects' || name === 'read_wiki_page' || name === 'list_wiki_pages') {
    const asked = JSON.stringify(args);
    const docs = DOCS.filter(d => d.about.test(asked));
    return json({ results: docs.length ? docs.map(({ title, excerpt }) => ({ title, excerpt })) : [{ title: 'Pipeline review notes, 2026-10-20', excerpt: '38 open deals, $4.1M raw, $2.4M weighted.' }] });
  }
  if (name === 'get_gmail_thread') {
    return json({ subject: 'Revised SOW', messages: [{ from: 'ops@northwind.example', date: '2026-10-26', body: 'Thanks, reviewing the revised SOW this week.' }] });
  }
  return json({ ok: true, note: 'No records match in the sample data.' });
}
