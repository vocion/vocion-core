/**
 * Use-case catalog surfaced on /use-cases.
 *
 * Mirrors docs/internal/use-case-catalog.md. Each case has enough metadata
 * to filter, badge the first-12 recommended builds, and serve as a
 * marketing card when the workflow actually ships.
 */

export type Capability = 'typed_plugins' | 'review_audit' | 'multi_step' | 'cross_interface';
export type Status = 'live' | 'spec' | 'planned';

export type UseCase = {
  id: number;
  title: string;
  summary: string;
  industry: string;
  department: string;
  sources: string[];
  output: string;
  level: 1 | 2 | 3 | 4 | 5;
  capabilities: Capability[];
  featured?: boolean;
  status: Status;
};

export const USE_CASES: UseCase[] = [
  // Level 1 — single-source drafting
  { id: 1, title: 'Sales proposal decks from Zoom calls', summary: 'Use meeting transcripts + CRM notes to draft proposal decks for a development agency.', industry: 'Services', department: 'Sales', sources: ['Zoom transcript', 'CRM notes'], output: 'Proposal deck draft', level: 1, capabilities: [], featured: true, status: 'planned' },
  { id: 2, title: 'Follow-up emails from discovery notes', summary: 'Draft follow-up emails from discovery call notes for a consulting firm.', industry: 'Consulting', department: 'Sales', sources: ['Meeting notes', 'CRM record'], output: 'Follow-up email', level: 1, capabilities: [], status: 'spec' },
  { id: 3, title: 'Support reply drafts from tickets', summary: 'Turn inbound support tickets into draft responses for a SaaS company.', industry: 'SaaS', department: 'Support', sources: ['Help desk ticket'], output: 'Support reply draft', level: 1, capabilities: [], featured: true, status: 'planned' },
  { id: 4, title: 'Product insight summaries from interviews', summary: 'Convert customer interview transcripts into product insight memos.', industry: 'Software', department: 'Product', sources: ['Interview transcript'], output: 'Insight memo', level: 1, capabilities: [], status: 'planned' },
  { id: 5, title: 'Job descriptions from intake notes', summary: 'Draft JDs from hiring-manager intake notes for a recruiting team.', industry: 'Recruiting', department: 'HR', sources: ['Intake form', 'Meeting notes'], output: 'Job description', level: 1, capabilities: [], status: 'planned' },
  { id: 6, title: 'SOAP notes from visit transcripts', summary: 'Turn call recordings into SOAP note drafts for a healthcare clinic.', industry: 'Healthcare', department: 'Clinical Ops', sources: ['Visit transcript'], output: 'SOAP note draft', level: 1, capabilities: [], status: 'planned' },
  { id: 7, title: 'Case summary memos from intake', summary: 'Generate case summary memos from client intake calls for a law firm.', industry: 'Legal', department: 'Legal Ops', sources: ['Client intake notes'], output: 'Case summary', level: 1, capabilities: [], status: 'planned' },
  { id: 8, title: 'Donor follow-up emails', summary: 'Draft donor follow-ups from fundraiser call notes for a nonprofit.', industry: 'Nonprofit', department: 'Development', sources: ['Call notes', 'Donor CRM'], output: 'Donor email draft', level: 1, capabilities: [], status: 'planned' },
  { id: 9, title: 'Real estate listing follow-ups', summary: 'Turn property-showing notes into listing follow-up emails.', industry: 'Real Estate', department: 'Sales', sources: ['Agent notes'], output: 'Follow-up email', level: 1, capabilities: [], status: 'planned' },
  { id: 10, title: 'Internal meeting recap posts', summary: 'Create recap posts from internal team calls for an agency.', industry: 'Agency', department: 'Operations', sources: ['Meeting transcript'], output: 'Internal recap post', level: 1, capabilities: [], status: 'planned' },

  // Level 2 — multi-source synthesis, one reviewer
  { id: 11, title: 'Weekly pipeline summaries', summary: 'Draft weekly pipeline summaries from CRM, call notes, and Slack updates.', industry: 'B2B', department: 'Sales', sources: ['CRM', 'Meeting notes', 'Slack'], output: 'Weekly pipeline summary', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 12, title: 'Account health briefs', summary: 'Generate account health briefs from tickets, NPS, and usage analytics.', industry: 'SaaS', department: 'Customer Success', sources: ['Ticketing', 'Survey tool', 'Product analytics'], output: 'Account health brief', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 13, title: 'Candidate interview summaries', summary: 'Build interview summaries from recruiter notes, scorecards, and resumes.', industry: 'Recruiting', department: 'Talent', sources: ['ATS', 'Scorecards', 'Resume'], output: 'Candidate summary', level: 2, capabilities: ['review_audit'], featured: true, status: 'planned' },
  { id: 14, title: 'Board update memos', summary: 'Draft board updates from financial metrics, product notes, and team updates.', industry: 'Startup', department: 'Executive', sources: ['BI dashboard', 'Product docs', 'Team notes'], output: 'Board memo', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 15, title: 'Investor update emails', summary: 'Generate investor update emails from KPI dashboards and founder notes.', industry: 'Startup', department: 'Founder/Finance', sources: ['Metrics dashboard', 'Founder notes'], output: 'Investor update', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 16, title: 'Incident communication drafts', summary: 'Turn bug tickets and incident notes into customer-safe incident summaries.', industry: 'Software', department: 'Support/Engineering', sources: ['Jira', 'Incident notes', 'Status updates'], output: 'Incident communication draft', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 17, title: 'Underwriting summaries', summary: 'Draft underwriting summaries from borrower docs and analyst notes.', industry: 'Fintech', department: 'Underwriting', sources: ['Application docs', 'Analyst notes'], output: 'Underwriting summary', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 18, title: 'Policy renewal summaries', summary: 'Create renewal summaries from account notes, claims history, and policy docs.', industry: 'Insurance', department: 'Account Management', sources: ['CRM', 'Claims system', 'Policy files'], output: 'Renewal summary', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 19, title: 'Treatment plan summaries', summary: 'Generate treatment summaries from intake forms, assessments, and clinician notes.', industry: 'Healthcare', department: 'Care Team', sources: ['Intake forms', 'Assessment tools', 'Notes'], output: 'Treatment summary draft', level: 2, capabilities: ['review_audit'], status: 'planned' },
  { id: 20, title: 'Vendor review summaries', summary: 'Draft vendor review memos from procurement forms, contracts, and stakeholder comments.', industry: 'Enterprise', department: 'Procurement', sources: ['Intake forms', 'Contracts', 'Comments'], output: 'Vendor review memo', level: 2, capabilities: ['review_audit'], status: 'planned' },

  // Level 3 — structured outputs + routing
  { id: 21, title: 'Lead qualification + routing', summary: 'Turn inbound leads into qualified opportunity briefs with routing recommendations.', industry: 'SaaS', department: 'RevOps', sources: ['Web form', 'CRM', 'Enrichment source'], output: 'Opportunity brief + routing decision', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 22, title: 'Implementation plans from SOWs', summary: 'Generate implementation plans from signed SOWs, kickoff notes, and requirements.', industry: 'Services', department: 'Delivery', sources: ['Contract', 'Kickoff transcript', 'Requirements doc'], output: 'Implementation plan', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 23, title: 'Feature request → PRD draft', summary: 'Convert customer feature requests into product requirement drafts.', industry: 'SaaS', department: 'Product', sources: ['Support tickets', 'Sales feedback', 'Roadmap notes'], output: 'PRD draft', level: 3, capabilities: ['typed_plugins'], featured: true, status: 'planned' },
  { id: 24, title: 'Contract redlines', summary: 'Draft legal contract redlines from fallback rules and prior approved language.', industry: 'Legal', department: 'Legal', sources: ['Contract doc', 'Clause library', 'Policy rules'], output: 'Redline suggestions', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 25, title: 'Loan condition checklists', summary: 'Generate mortgage loan condition checklists from applications and underwriting guidelines.', industry: 'Fintech', department: 'Loan Ops', sources: ['Application docs', 'Underwriting rules'], output: 'Condition checklist', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 26, title: 'Site inspection reports', summary: 'Create inspection reports from field notes, photos, and checklist forms.', industry: 'Construction', department: 'Field Ops', sources: ['Mobile forms', 'Images', 'Project checklist'], output: 'Inspection report', level: 3, capabilities: ['typed_plugins', 'cross_interface'], status: 'planned' },
  { id: 27, title: 'Shipment exception resolutions', summary: 'Draft resolutions from carrier events, order data, and support history.', industry: 'E-commerce', department: 'Operations', sources: ['OMS', 'Carrier feed', 'Support tickets'], output: 'Resolution draft', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 28, title: 'Clinician review packets', summary: 'Turn lab results and prior notes into clinician review packets for specialty care.', industry: 'Healthcare', department: 'Clinical Ops', sources: ['Lab system', 'EHR notes'], output: 'Review packet', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 29, title: 'Store performance summaries', summary: 'Generate performance summaries from POS, labor, and district manager notes.', industry: 'Retail', department: 'Operations', sources: ['POS', 'Scheduling tool', 'Notes'], output: 'Performance summary', level: 3, capabilities: ['typed_plugins'], status: 'planned' },
  { id: 30, title: 'Property management notices', summary: 'Draft notices from maintenance tickets, lease data, and tenant history.', industry: 'Real Estate', department: 'Property Ops', sources: ['Ticketing', 'Lease system', 'Resident records'], output: 'Notice draft', level: 3, capabilities: ['typed_plugins'], status: 'planned' },

  // Level 4 — HITL approval across interfaces
  { id: 31, title: 'Outbound sales proposals with approval', summary: 'Draft proposals from call transcripts, CRM, and pricing rules. Route to AE for approval.', industry: 'Services', department: 'Sales', sources: ['Zoom', 'CRM', 'Pricing sheet'], output: 'Proposal draft with approval step', level: 4, capabilities: ['review_audit', 'cross_interface'], featured: true, status: 'planned' },
  { id: 32, title: 'Refund request triage', summary: 'Generate replies for refunds, require review when policy exceptions are detected.', industry: 'E-commerce', department: 'Support', sources: ['Ticket', 'Order system', 'Refund policy'], output: 'Reply draft or escalation', level: 4, capabilities: ['review_audit'], featured: true, status: 'planned' },
  { id: 33, title: 'Prior authorization packets', summary: 'Create prior auth drafts from chart notes and payer rules; staff review before submission.', industry: 'Healthcare', department: 'Revenue Cycle', sources: ['EHR notes', 'Payer policy', 'Intake data'], output: 'Prior auth packet draft', level: 4, capabilities: ['review_audit'], featured: true, status: 'planned' },
  { id: 34, title: 'Employment offer letters', summary: 'Draft offer letters from recruiter notes and comp bands; route to HR for signoff.', industry: 'Recruiting', department: 'HR', sources: ['ATS', 'Compensation table', 'Approval matrix'], output: 'Offer letter draft', level: 4, capabilities: ['review_audit'], status: 'planned' },
  { id: 35, title: 'Compliance review summaries', summary: 'Generate compliance summaries from policy exceptions and evidence; manager review in Slack.', industry: 'Enterprise', department: 'Compliance', sources: ['Policy docs', 'Control logs', 'Evidence files'], output: 'Compliance summary with approval', level: 4, capabilities: ['review_audit', 'cross_interface'], status: 'planned' },
  { id: 36, title: 'Claims determination letters', summary: 'Draft claim letters from adjuster notes and policy language; supervisor review on edges.', industry: 'Insurance', department: 'Claims', sources: ['Claim file', 'Adjuster notes', 'Policy document'], output: 'Determination letter draft', level: 4, capabilities: ['review_audit'], featured: true, status: 'planned' },
  { id: 37, title: 'Vendor security assessments', summary: 'Summarize questionnaires + evidence, route to security for approval.', industry: 'SaaS', department: 'Security', sources: ['Security questionnaire', 'Attachments', 'Policy docs'], output: 'Assessment summary', level: 4, capabilities: ['review_audit'], status: 'planned' },
  { id: 38, title: 'Grant recommendation memos', summary: 'Draft grant recommendations from applications and reviewer notes; committee approval.', industry: 'Nonprofit', department: 'Programs', sources: ['Application forms', 'Review notes'], output: 'Recommendation memo', level: 4, capabilities: ['review_audit'], status: 'planned' },
  { id: 39, title: 'Offer comparison sheets', summary: 'Generate real estate offer comparisons from listings, disclosures, and agent notes.', industry: 'Real Estate', department: 'Brokerage', sources: ['MLS data', 'Disclosure docs', 'Agent notes'], output: 'Offer comparison sheet', level: 4, capabilities: ['review_audit'], status: 'planned' },
  { id: 40, title: 'Weekly executive reporting packets', summary: 'Build exec packets from BI + departmental inputs; signoff before distribution.', industry: 'Any', department: 'Executive Ops', sources: ['Dashboard', 'Forms', 'Departmental notes'], output: 'Executive packet', level: 4, capabilities: ['review_audit', 'cross_interface'], featured: true, status: 'planned' },

  // Level 5 — multi-step cross-system
  { id: 41, title: 'RFP response workflow', summary: 'Turn RFPs into draft responses, assign owners, collect approvals, generate final package.', industry: 'Services', department: 'Sales/Delivery', sources: ['RFP files', 'Knowledge base', 'Resumes', 'Case studies'], output: 'Draft response + owner tasks + final package', level: 5, capabilities: ['multi_step', 'review_audit'], featured: true, status: 'planned' },
  { id: 42, title: 'Escalation → postmortem', summary: 'Convert support escalations into root-cause summaries, eng tickets, customer updates, postmortems.', industry: 'SaaS', department: 'Support + Engineering', sources: ['Tickets', 'Logs', 'Incident timeline', 'Slack'], output: 'Multi-output workflow across teams', level: 5, capabilities: ['multi_step', 'cross_interface'], featured: true, status: 'planned' },
  { id: 43, title: 'Underwriting recommendations', summary: 'Generate recs from docs, external data, analyst notes, and policy rules; route exceptions.', industry: 'Fintech', department: 'Underwriting', sources: ['Uploaded docs', 'Credit data', 'Internal rules', 'Analyst notes'], output: 'Recommendation + exception queue', level: 5, capabilities: ['typed_plugins', 'multi_step'], featured: true, status: 'planned' },
  { id: 44, title: 'Patient referral packets', summary: 'Turn referrals into scheduling recs, missing-doc requests, and clinician prep notes.', industry: 'Healthcare', department: 'Intake Ops', sources: ['Referral docs', 'Insurance data', 'Scheduling system', 'Chart history'], output: 'Outreach tasks + prep notes + intake summary', level: 5, capabilities: ['multi_step'], status: 'planned' },
  { id: 45, title: 'Client intake → SOW', summary: 'Convert intake into project scoping, risk flags, team recs, and first-draft SOW.', industry: 'Services', department: 'Sales/Delivery', sources: ['Discovery call', 'CRM', 'Templates', 'Staffing data'], output: 'Scope package + SOW draft', level: 5, capabilities: ['multi_step', 'cross_interface'], featured: true, status: 'planned' },
  { id: 46, title: 'Procurement decision packs', summary: 'Generate enterprise procurement packs from vendors, security, pricing, legal, and stakeholders.', industry: 'Enterprise', department: 'Procurement', sources: ['Vendor docs', 'Security review', 'Finance inputs', 'Legal comments'], output: 'Decision pack with audit trail', level: 5, capabilities: ['multi_step', 'review_audit'], featured: true, status: 'planned' },
  { id: 47, title: 'Franchise performance → action plans', summary: 'Turn franchise performance data into action plans, coaching notes, and exec rollups.', industry: 'Franchise/Retail', department: 'Operations', sources: ['POS', 'Labor', 'Field reports', 'Benchmarks'], output: 'Store plan + manager notes + exec summary', level: 5, capabilities: ['multi_step'], status: 'planned' },
  { id: 48, title: 'Litigation intake → matter setup', summary: 'Convert litigation intake into matter summaries, document requests, deadline calendars, staffing.', industry: 'Legal', department: 'Legal Ops', sources: ['Intake forms', 'Emails', 'Uploaded files', 'Rules database'], output: 'Matter setup package', level: 5, capabilities: ['multi_step'], status: 'planned' },
  { id: 49, title: 'Supply chain exception workflows', summary: 'Generate exception handling from ERP, shipment events, vendor messages, inventory thresholds.', industry: 'Manufacturing', department: 'Supply Chain', sources: ['ERP', 'Carrier feeds', 'Supplier emails', 'Inventory data'], output: 'Exception summary + action routing + exec alert', level: 5, capabilities: ['typed_plugins', 'multi_step'], status: 'planned' },
  { id: 50, title: 'Strategic planning → initiative briefs', summary: 'Turn planning inputs into cross-functional briefs, owner assignments, approval checkpoints, quarterly updates.', industry: 'Any', department: 'Strategy/Executive', sources: ['Planning docs', 'KPI dashboards', 'Meeting notes', 'Departmental updates'], output: 'Initiative briefs + recurring updates', level: 5, capabilities: ['multi_step', 'cross_interface'], status: 'planned' },
];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  typed_plugins: 'Typed plugins',
  review_audit: 'Review + audit',
  multi_step: 'Multi-step',
  cross_interface: 'Cross-interface',
};

export const LEVEL_LABELS: Record<number, string> = {
  1: 'L1 — Drafting',
  2: 'L2 — Synthesis',
  3: 'L3 — Structured',
  4: 'L4 — HITL',
  5: 'L5 — Orchestration',
};
