# Use-case catalog

**Internal — MetaCTO team only.** A forcing-function list of 50 business workflows, organized by complexity. Each one doubles as (a) a roadmap driver — does the platform let you build this? — and (b) marketing content once shipped.

**Use this list to:**
- Pick the next 1–3 workflows to stand up end-to-end
- Identify missing platform capabilities (revealed by the workflow's requirements)
- Seed the public `/use-cases` page with realized examples

---

## Complexity levels

| Level | Description | Platform capabilities stressed |
|---|---|---|
| **1** | Single source in, single draft out | Sources, Skills |
| **2** | Multi-source synthesis, one reviewer | + Retrieval, Approvals |
| **3** | Structured outputs + routing + departmental workflows | + Workflows, typed plugins, validation |
| **4** | Human-in-the-loop approvals across interfaces | + Review queue, resume-from-any-channel, audit |
| **5** | Multi-step, cross-system operational workflows | + Plugins, external APIs, long-running state, multi-output |

---

## Level 1 — Single-source drafting

| # | Workflow | Industry | Department | Sources | Output |
|---|---|---|---|---|---|
| 1 | Generate sales proposal decks from Zoom transcripts | Services | Sales | Zoom, CRM notes | Proposal deck draft |
| 2 | Draft follow-up emails from discovery call notes | Consulting | Sales | Meeting notes, CRM | Follow-up email |
| 3 | Turn support tickets into reply drafts | SaaS | Support | Help desk ticket | Support reply draft |
| 4 | Convert customer interview transcripts into insight summaries | Software | Product | Interview transcript | Insight memo |
| 5 | Draft job descriptions from intake notes | Recruiting | HR | Intake form, meeting notes | Job description |
| 6 | Turn call recordings into SOAP notes | Healthcare | Clinical Ops | Visit transcript | SOAP note draft |
| 7 | Generate case summary memos from intake calls | Legal | Legal Ops | Client intake notes | Case summary |
| 8 | Draft donor follow-up emails from fundraiser call notes | Nonprofit | Development | Call notes, donor CRM | Donor email draft |
| 9 | Turn property showing notes into listing follow-ups | Real Estate | Sales | Agent notes | Follow-up email |
| 10 | Create meeting recap posts from team calls | Agency | Operations | Meeting transcript | Internal recap post |

---

## Level 2 — Multi-source synthesis, one reviewer

| # | Workflow | Industry | Department | Sources | Output |
|---|---|---|---|---|---|
| 11 | Weekly pipeline summaries from CRM + calls + Slack | B2B | Sales | CRM, meeting notes, Slack | Weekly pipeline summary |
| 12 | Account health briefs from tickets + NPS + usage | SaaS | Customer Success | Ticketing, survey, analytics | Account health brief |
| 13 | Candidate interview summaries from notes + scorecards + resume | Recruiting | Talent | ATS, scorecards, resume | Candidate summary |
| 14 | Board update memos from financials + product + team updates | Startup | Executive | BI, product docs, team notes | Board memo |
| 15 | Investor update emails from KPIs + founder notes | Startup | Founder/Finance | Metrics dashboard, notes | Investor update |
| 16 | Customer-safe incident summaries from bug tickets + notes | Software | Support/Eng | Jira, incident notes, status | Incident communication |
| 17 | Underwriting summaries from borrower docs + analyst notes | Fintech | Underwriting | Application docs, notes | Underwriting summary |
| 18 | Policy renewal summaries from account + claims + policy docs | Insurance | Account Mgmt | CRM, claims, policy files | Renewal summary |
| 19 | Treatment plan summaries from intake + assessments + notes | Healthcare | Care Team | Intake forms, assessments | Treatment summary |
| 20 | Vendor review summaries from procurement + contracts + stakeholders | Enterprise | Procurement | Intake, contracts, comments | Vendor review memo |

---

## Level 3 — Structured outputs + routing

Stresses typed plugins, validation, and workflow composition.

| # | Workflow | Industry | Department | Output |
|---|---|---|---|---|
| 21 | Lead → qualified opportunity brief + routing recommendation | SaaS | RevOps | Opportunity brief + routing |
| 22 | Signed SOW → implementation plan | Services | Delivery | Implementation plan |
| 23 | Customer feature requests → PRD draft | SaaS | Product | PRD draft |
| 24 | Contract redlines from fallback rules + clause library | Legal | Legal | Redline suggestions |
| 25 | Mortgage applications → condition checklist | Fintech | Loan Ops | Condition checklist |
| 26 | Field notes + photos → site inspection report | Construction | Field Ops | Inspection report |
| 27 | Shipment exceptions → resolution drafts | E-commerce | Operations | Resolution draft |
| 28 | Lab results + prior notes → clinician review packet | Healthcare | Clinical Ops | Review packet |
| 29 | POS + labor + manager notes → store performance summary | Retail | Operations | Performance summary |
| 30 | Maintenance + lease + tenant history → property notice | Real Estate | Property Ops | Notice draft |

---

## Level 4 — HITL approval workflows across interfaces

Review queue, resumability, and audit become central.

| # | Workflow | Industry | Department | Key capability |
|---|---|---|---|---|
| 31 | Sales proposals → AE approval | Services | Sales | Review queue |
| 32 | Refund requests → human review on policy exceptions | E-commerce | Support | Conditional routing |
| 33 | Prior auth packets → staff review before submission | Healthcare | Revenue Cycle | Evidence-gated approval |
| 34 | Employment offer letters → HR signoff | Recruiting | HR | Approval matrix |
| 35 | Compliance review summaries → manager in Slack | Enterprise | Compliance | Cross-channel approval |
| 36 | Claims determination letters → supervisor review on edge cases | Insurance | Claims | Edge-case escalation |
| 37 | Vendor security assessments → security approval | SaaS | Security | Multi-doc review |
| 38 | Grant recommendations → committee approval | Nonprofit | Programs | Multi-approver |
| 39 | Real estate offer comparisons → broker review | Real Estate | Brokerage | Structured diff |
| 40 | Weekly executive packets → signoff before distribution | Any | Exec Ops | Scheduled + approval |

---

## Level 5 — Multi-step, cross-system operational workflows

These are the strongest roadmap forcing functions. They demand plugins, typed data, review states, interfaces, and full traceability.

| # | Workflow | Industry | Department | Why it matters |
|---|---|---|---|---|
| 41 | RFP → draft response → owner assignments → final package | Services | Sales/Delivery | Owner routing, parallel tasks |
| 42 | Support escalation → root cause → eng ticket → customer update → postmortem | SaaS | Support + Eng | Multi-team, multi-output |
| 43 | Underwriting: docs + external data + analyst notes + policy → rec + exception queue | Fintech | Underwriting | External API calls, exception routing |
| 44 | Patient referral → scheduling + missing-doc requests + clinician prep notes | Healthcare | Intake Ops | Multi-output, dependent steps |
| 45 | New client intake → scoping + risk flags + team recs + SOW draft | Services | Sales/Delivery | Plugin orchestration |
| 46 | Enterprise procurement: vendor + security + pricing + legal + stakeholders → decision pack | Enterprise | Procurement | Audit trail + multi-input |
| 47 | Franchise perf data → action plans + coaching notes + exec rollups | Franchise/Retail | Operations | Scale (100s of locations) |
| 48 | Litigation intake → matter summary + doc requests + deadlines + staffing | Legal | Legal Ops | Calendar + template + rules |
| 49 | Supply chain exceptions: ERP + shipment + vendor + inventory → routing + exec alert | Manufacturing | Supply Chain | Real-time event handling |
| 50 | Strategic planning → initiative briefs + owner assignments + approval checkpoints + quarterly updates | Any | Strategy/Exec | Recurring workflow, multi-touch |

---

## Strong candidates for roadmap forcing functions

### Best for typed plugins + validation
- #21 Lead qualification and routing
- #24 Contract redlines
- #25 Loan condition checklists
- #43 Underwriting recommendations
- #49 Supply chain exception workflows

### Best for human review + resumability
- #31 Sales proposals with approval
- #32 Refund exception handling
- #33 Prior authorization review
- #36 Claims determination letters
- #40 Weekly executive reporting packets

### Best for multi-step orchestration
- #41 RFP response workflow
- #42 Escalation → postmortem
- #45 Client intake → SOW
- #46 Procurement decision pack
- #50 Strategic planning workflow

### Best for cross-interface storytelling
- #31 Run from Slack, approve on web
- #40 Trigger from CLI, review in Slack, distribute by email
- #42 Start from support system, resume in Slack, finalize in product tools
- #45 Start from ChatGPT or call transcript, route to delivery review queue
- #50 Trigger from internal app, review in web queue, audit in dashboard

### Best for API + external-integration story
- #26 Construction site inspections — their existing field-notes app posts to Vocion, triggers workflow, polls result
- #27 Shipment exceptions — OMS webhooks in, status back
- #29 Store performance — POS system pushes nightly, Vocion replies with action plan
- #43 Underwriting — loan-origination system posts application, polls for decision
- #49 Supply chain exceptions — ERP event bus in, routing webhook out

---

## Suggested first 12 to build

Strong variety without spreading thin:

1. Sales proposal decks from call transcripts (L4)
2. Support reply drafting with exception review (L4)
3. Weekly business reporting with signoff (L4)
4. Feature request → PRD draft (L3)
5. Client intake → SOW draft (L5)
6. RFP response workflow (L5)
7. Incident summary → customer update workflow (L5)
8. Candidate interview summary workflow (L2)
9. Executive reporting packet (L4)
10. Procurement decision pack (L5)
11. Underwriting recommendation workflow (L5)
12. Prior authorization packet drafting (L4)

Coverage: sales · support · product · delivery · exec ops · legal/compliance · healthcare · fintech · multi-step orchestration.

---

## Packaging for public marketing (once shipped)

For every realized use case, produce:

- **Headline** — clear business outcome
- **Who it's for** — industry + department
- **What goes in** — sources + systems
- **What comes out** — artifacts + decisions + approvals
- **Why Vocion fits** — versioned context, human review, audit trail, typed plugins, self-hosting
- **The stack** — list of Sources / Objects / Skills / Workflows / Agent that compose it

Example:

> **Sales proposal decks from Zoom calls, for development agencies.** Takes meeting transcripts, CRM notes, pricing rules, and approved case studies. Drafts a proposal deck with human review before it goes out. Every recommendation traceable to the exact workflow version and source context used.
>
> **Stack:** Sources (Zoom, HubSpot, Google Drive) · Objects (Account, Deal) · Skills (extract_pain_points, match_case_studies, draft_deck) · Workflows (proposal_generation with approval) · Agent (your sales agent).

---

## Tracking template (for each realized use case)

```
industry:   services
department: sales
trigger:    zoom-call-completed
output:     proposal-deck.pdf
complexity: 4
capability: review-queue + audit
status:     shipped (2026-04-20)
```
