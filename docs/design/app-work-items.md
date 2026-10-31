# Work items inside apps

A workspace is the authorization boundary. An app is the working context. Projects hold shared client context; app views present the work specific to their domain.

Shared object pages use a collection-aware return link and a reusable work-item shell. A registered business object should foreground its deliverable, evidence, actual lifecycle, and next action. Generic metadata remains a fallback for types without a work view.

SEO is the first implementation:

- Projects lead with approved goals, latest audit and existing work. Reference context and prior audit runs are secondary.
- Pages foreground the versioned draft, with brief/research, review/feedback, and history nearby. Feedback and sign-off use the existing version-bound review contract. Approving a draft does not bypass publication checks.
- Audits distinguish unresolved finding groups from affected pages and linked implementation work. A linked task is not proof of a fix. Reports remain readable artifacts; the work view is the place to act.

Workspace URLs remain canonical. Shared pages carry an explicit `app` query parameter; only apps installed in the current workspace are selected. Links and browser history retain context, including document links. App context never grants access to records, artifacts, or actions.

Agents may prepare sourced profile drafts automatically, separately from approved strategy. Missing business goals require a meaningful question. Unchanged approved profiles do not require repeated approval. Human-only actions retain their existing execution gates and truthful reviewer attribution.

Review cards should reuse the action's business title, payload, evidence, and verbs. Internal action names and filing receipts must not stand in for the decision. An action that requires a person must not display an automatic-approval promise.

Progress is observable work: real phases, counts, and findings. It must not expose internal chain of thought or invent completion percentages. Findings may remain preliminary until reconciliation and report persistence finish.

Other apps should reuse the shell, navigation, artifact and review contracts while defining their own lifecycle and domain-specific actions. A finance statement, sales proposal, and SEO draft are not interchangeable metadata forms.

## SEO strategy and execution roadmap

The strategy approval and delivery plan are distinct. An agent can prepare a strategy revision, but the current approved goal and document remain authoritative until a person approves the replacement. A draft token binds approval to the prepared revision; editing the goal title does not break that association. Replaying a consumed or superseded draft is refused. Missing business priorities remain questions, not invented goals.

The approved goal owner manages the client roadmap. Initiatives have a Now/Next/Later lane, an accountable owner, acceptance criteria, next action, dependencies, optional effort and blockers, and links to actual execution records or project tasks. An audit finding can prefill an initiative only when the server confirms that the audit belongs to the current workspace and client. A lane or manual status change never publishes content or approves a strategy.

Roadmap writes require a human session and an expected revision. The service independently enforces goal ownership, workspace membership for assignees, client-scoped work links, dependency validity, and optimistic concurrency. A stale save must return a conflict rather than overwrite another edit. Workspace and actor identifiers come from authentication, never from the request body. Unknown or foreign projects return not found.

Delivery completion requires linked work and satisfied dependencies. Completed drafting workflows, rejected content, dropped tasks, an open publication pull request, and failed publisher calls are not delivery. A project task counts only when its actual completion decision is Done. A published page needs a matching public verification result for its current URL before the roadmap counts it delivered; a provider publication receipt alone is pending verification. Generic object status alone is insufficient. Delivery metrics and measured business outcomes remain separate.

## Audit evidence and verification

Audits record which checks ran, which URLs were covered, and whether coverage was complete. A missing finding on an unavailable, partial, capped or crawl-only run is retained as unverified evidence. Automatic resolution requires a covered recheck of that finding's check and recorded scope on the same site. Legacy audits without coverage cannot claim verified resolution.

A manual fix is **reported fixed**, with its reporter and date retained. Only a positive covered recheck establishes **verified fixed**, with separate verifier and date. Linking an implementation task or drafting a page is not verification. Pagination-template repetitions remain inspectable finding groups with evidence and calibrated severity; they are not automatically suppressed as harmless. Schema and crawler observations must not promise inclusion in AI answers or attribute business impact without measurement.

## Measurement and release acceptance

Client outcomes display baseline, target and current measurements with their source, observation date and measurement window. Missing access or evidence is shown explicitly; unknown is never converted to zero. Publication progress must not be presented as traffic, leads, ranking gains or causal impact. Search Console captures preserve the initial baseline and use complete reporting windows. Downloadable progress reports carry the same evidence and limitations as the workspace.

Release acceptance covers these journeys:

- New client context → sourced profile and actual priorities → strategy draft → human-edited approval → stable goal binding → owned roadmap.
- Revision pending, rejected or superseded → approved strategy remains authoritative; stale approval and stale roadmap writes are refused.
- Audit finding → linked initiative and task/page → actual execution → covered recheck; unavailable checks and reported fixes cannot silently resolve the audit.
- Content review rejection → feedback/redraft; human sign-off → publication attempt; an unmerged PR or publisher failure stays incomplete.
- Client/workspace scope, bearer-write refusal, owner checks, dependency blocking and missing measurement access remain enforced on server calls as well as visible in the UI.
- Browser reload preserves a saved roadmap, workspace/app navigation and actionable evidence links.

Service/PGlite tests use fictional clients and stub external agents, websites and publishing adapters. Chromium component tests and browser navigation tests complement those fixtures; they do not establish that a real client's CMS, Search Console credentials or publishing permissions work. A production acceptance run must verify those integrations with the selected client and record its actual evidence before claiming live end-to-end delivery.
