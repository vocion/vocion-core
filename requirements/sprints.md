# Sprint Breakdown

2-week sprints. Phase 1 and Phase 2 broken down. Phases 3-6 are higher-level until Phase 2 is complete.

---

## Phase 1: Foundation (Sprints 1-4, ~8 weeks)

### Sprint 1: Infrastructure + Auth

- [ ] Provision AWS infrastructure (VPC, ECS/EKS, RDS, secrets)
- [ ] Deploy Onyx on AWS (Docker/K8s)
- [ ] Verify Onyx API accessible from CoreContext network
- [ ] Set up Clerk organizations with multi-tenancy
- [ ] Extend CoreContext DB schema: workspace, user, team, role tables
- [ ] Implement API auth middleware (Clerk token verification + role resolution)
- [ ] Set up CI/CD pipeline (GitHub Actions)

### Sprint 2: Connector Admin + Object Store

- [ ] Build connector admin page (list, add, configure, status)
- [ ] Integrate Onyx connector APIs (create, update, delete, sync status)
- [ ] Design and implement object mapping DB schema (source_system, connector, business_object, object_mapping)
- [ ] Build object mapping admin page (CRUD for canonical objects and mappings)
- [ ] Seed initial source system definitions (Slack, Drive, Salesforce, Jira, etc.)

### Sprint 3: Audit + Feedback + Events

- [ ] Implement audit event table and logging service
- [ ] Add audit logging to all API endpoints
- [ ] Build feedback capture API (thumbs, corrections, source reports)
- [ ] Build feedback UI component (reusable across all surfaces)
- [ ] Set up OpenTelemetry base instrumentation
- [ ] Set up Langfuse integration for LLM trace capture
- [ ] Implement usage record tracking

### Sprint 4: Admin Console + Polish

- [ ] Build admin dashboard (workspace overview, connector health, user count, recent activity)
- [ ] Build user management page (invite, roles, deactivate)
- [ ] Build knowledge domain management page
- [ ] Integration testing: Clerk auth -> CoreContext API -> Onyx
- [ ] Load testing baseline
- [ ] Documentation: deployment runbook, connector setup guide

**Phase 1 Milestone:** Platform shell operational. Ready for first customer connector onboarding.

---

## Phase 2: Ask + Find (Sprints 5-8, ~8 weeks)

### Sprint 5: Chat UI + Onyx Integration

- [ ] Build conversation pane (streaming answers, message history)
- [ ] Integrate Onyx chat/ask API from CoreContext backend
- [ ] Implement scope resolution (org -> connectors -> domains -> objects)
- [ ] Pass resolved scope to Onyx retrieval calls
- [ ] Build thread history (save, list, reopen conversations)
- [ ] Add scope controls to chat UI (system selector, domain selector, time range)

### Sprint 6: Context Drawer + Citations

- [ ] Build context drawer (right-side evidence panel)
- [ ] Parse Onyx citations into structured evidence items
- [ ] Display source documents with metadata (system, date, author)
- [ ] Link citations to business objects where mapping exists
- [ ] Show related prior answers and runs
- [ ] Implement "pin" and "save" for evidence items

### Sprint 7: Search + Skills Catalog

- [ ] Build search UI (query bar, filters, result cards)
- [ ] Integrate Onyx search API with source/time/author/tag filters
- [ ] Build skill catalog page (list skills, descriptions, input forms)
- [ ] Implement 10-15 starter query skills (see skills.md)
- [ ] Build skill execution UI (input form -> run -> output display)
- [ ] Add run history page (list past runs with status, inputs, outputs)

### Sprint 8: Assistants + Polish

- [ ] Configure 3-5 starter assistants in Onyx (general, sales, support, product, custom)
- [ ] Build assistant selector in chat UI
- [ ] Add follow-up suggestions to answers
- [ ] Implement memory/session state (recent searches, pinned objects, reusable scopes)
- [ ] Add feedback capture to all surfaces (chat, search, skills, evidence)
- [ ] End-to-end testing: full ask/search/skill flow
- [ ] Performance tuning: streaming latency, search response time

**Phase 2 Milestone:** Users can ask business questions, search with filters, run query skills, and explore evidence. First real user value delivered.

---

## Phase 3: Act (Sprints 9-12, ~8 weeks)

High-level scope (detailed sprint breakdown when Phase 2 completes):

- Sprint 9: Action bar + mutation skill framework
- Sprint 10: Approval model + approval inbox
- Sprint 11: Run history + notifications + audit trail
- Sprint 12: 5-10 mutation skills + integration testing

---

## Phase 4: Automate (Sprints 13-16, ~8 weeks)

High-level scope:

- Sprint 13: Temporal integration + basic workflow engine
- Sprint 14: Workflow builder UI + triggers
- Sprint 15: Hooks, schedules, human-in-the-loop
- Sprint 16: Run monitoring + SLAs + polish

---

## Phase 5: Govern + Optimize (Sprints 17-20, ~8 weeks)

High-level scope:

- Sprint 17: Policy packs + domain ownership
- Sprint 18: Analytics dashboards + usage reporting
- Sprint 19: Eval workbench + skill versioning
- Sprint 20: Connector health monitoring + adoption reporting

---

## Phase 6: Verticalize (Sprints 21+)

High-level scope:

- Design first vertical pack (likely Sales or Support)
- Object model + connector bundle + skill pack + workflow pack
- Dashboard pack + training materials
- Repeat for additional verticals
