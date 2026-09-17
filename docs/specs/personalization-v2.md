<!-- The spec this PR implements: the Personalization lead page v2 rebuild (chat grounding, sequence-state resolution, brief/recommendation/sequence as record-scoped artifacts, the collapsed brief, per-dimension confidence, the three-zone page and the scoped chat drawer). -->

# Personalization lead page — CEO product review (Chris Fitkin, 2026-09-16)

Verbatim. Every person and company named in the original has been replaced by a fixture; the originals are deliberately not recorded here.

## The failure mode

This page is currently four products sharing one screen: **research brief + recommendation engine + sequence editor + copilot/chat.** They are all individually useful, but the boundaries between them are unclear. The result is duplicated information, conflicting state, and a huge amount of page surface for a lead where Vocion basically knows four facts.

The most important design rule I would apply here is:

> **Less evidence should produce a smaller brief, not a longer explanation of why evidence is missing.**

This example violates that badly.

## P0: the chat is contextually broken

Worse than polish. The page contains a generated brief and sequence recommendation. The chat says "there's no brief or proposal to review here". It also says the contact "hasn't engaged since (no page views, no clicks beyond the ad itself)" while the brief explicitly says those engagement fields were **unavailable** and nothing can be inferred from them. Two Vocion surfaces looking at the same object, giving contradictory answers. That damages trust immediately.

The chat needs explicit page context injected on every turn — current object, current research brief id, current recommendation, current draft sequence id, current CRM snapshot id, user-visible state — and instructions along the lines of: *You are working inside the Dana Reyes personalization review. Treat the attached research brief and outreach recommendation as the canonical current artifacts. When discussing this contact, distinguish CRM facts, research findings, inference, and unavailable data.*

Expose it to the user as a tiny context indicator: **Working with:** `Dana's brief` `4-send sequence`. That makes the chat feel attached to the artifact rather than a global chatbot floating beside it.

## P0: a potentially dangerous sequence-state problem

The page recommends **Enroll in Personalized Nurture**. The CRM context says the contact "was enrolled in a sequence within minutes of becoming an MQL". Those need reconciliation before an **Enroll** button goes in front of somebody. Is the contact (A) in another sequence, (B) already in this one, (C) enrolled but finished, or (D) in an automated CRM sequence Vocion proposes replacing? The UI makes this impossible to tell. It should be explicit:

> **Current state** — Inbound sequence · active · step 1 of 3
> **Vocion recommends** — Replace with Personalized Nurture · Gentle · 4 sends
> **Approving will** — Unenroll from Inbound Follow-up and enroll in Personalized Nurture.

Or: **Approving will** — Add Personalized Nurture. Existing sequence will remain active. That distinction is consequential.

## The brief is much too long for the information available

Confirmed facts: name, title, company, that it is a lead-gen MQL, the eBook conversion, the arrival date, that the domain exists, and that the website could not be retrieved. That is it.

Yet the interface generates: Prospect, Research That Matters, Recommended Angle, Opening Question, Case Study, Missing, Claims, Confidence, Timeline, CRM Context, another Missing section, Reference Articles. The same lack of information is repeated six or seven times. "We don't know what this company does" appears in slightly different language throughout. That makes the agent appear verbose rather than rigorous.

For this lead the brief could be: **What we know** (two sentences) · **What we couldn't verify** (two sentences) · **Recommended angle** (one sentence) · **Sources** (three chips) · **Research confidence: Low**. Done. The rest belongs under **Evidence**.

## "Prospect facts" is mislabeled

Source / Campaign / Became MQL / On enroll are not prospect facts — they are a mix of acquisition metadata and proposed action. Separate the concepts:

| Section | Contains |
|---|---|
| **About the prospect** | person, role, company, verified company information |
| **Acquisition context** | source, campaign, conversion, date |
| **Engagement** | emails, opens, clicks, meetings, replies |
| **Research gaps** | information Vocion tried but couldn't establish |
| **Recommended outreach** | what Vocion thinks should happen next |

## Upgrade brief-generation research

The current behaviour looks like a pipeline that tried CRM plus a simple HTTP fetch and then mostly gave up. If Personalization is meant to create credible personalized outreach, web research is a first-class capability, not optional enrichment. A waterfall:

1. **Entity resolution** — person, company, domain, aliases
2. **First-party sources** — company site, about, product, blog, case studies
3. **Person research** — public professional profile, company bio, talks/posts where accessible
4. **External validation** — search results, press, directories, customer mentions
5. **Internal context** — CRM, previous emails, meetings, proposals, company knowledge
6. **Evidence reconciliation** — remove contradictions, flag stale/unconfirmed claims
7. **Outreach synthesis** — only then generate angle and sequence

A client-rendered website should trigger a browser/render fallback rather than terminate company research. Search should continue even if the company's own site fails: the company name, the person's name, both together, a professional-profile site search, the bare domain. If the research stack cannot run those searches, that is a capability gap in this workflow.

## Change what "confidence" means

`0.20 speculative` collapses several different questions. This lead could have: Identity **High** · Acquisition context **High** · Company understanding **Very low** · Engagement understanding **Unknown** · Personalization fit **Low**. You do not need five meters in the UI, but the brief should calculate them separately internally, so the recommendation engine can reason: *identity is known, company context is insufficient, engagement is unavailable — use generic-curiosity nurture rather than personalized business-problem messaging.* That is much stronger than "brief confidence .2".

## Brief and recommendation must be separate artifacts

Today the recommendation is embedded in the brief, the sequence appears in the brief, again in chat, again as an injected overview in chat, and the persistent button says Enroll. That is why it feels like 4x duty. Model it — internally and visually — as:

- **Artifact 1: Research brief** — what do we know? Generated from evidence, mostly factual.
- **Artifact 2: Outreach recommendation** — given what we know, what should we do, and why.
- **Artifact 3: Draft sequence** — what exactly will be sent? Editable messages.
- **Decision** — Enroll / Decline / Snooze.

A clean causal chain: **Evidence → Brief → Recommendation → Draft → Human decision → Action.** That is exactly the traceability you want Vocion to embody.

## The page should be dramatically simpler

Today: navigation | huge document | metadata rail | chat — with the sequence inside the document. Too many vertical zones. Cap it at **navigation | primary workspace | optional copilot drawer**. The metadata column goes away; confidence, timeline and CRM context belong in the brief or under an **Evidence** drawer.

Preferred structure: name, role, company; acquisition line; research confidence. Then one recommendation block (what, why, `Review sequence` / `Enroll`). Then tabs: **Brief · Sequence · Evidence**. Brief is What we know / What we don't know / Recommended angle / Sources. Sequence is the four sends with Edit, a rationale line, and Decline / Enroll. Evidence holds CRM fields, failed fetches, exact claims, timestamps, source URLs, unavailable fields, run id, model version.

## Chat should be an editor, not another representation

Do not let it permanently consume a quarter of the screen. Make it a drawer with an explicit scope: opened from the brief, **Ask about brief**; from Send 2, **Editing Send 2**; from the recommendation, **Discuss recommendation**. Then "make this less salesy" has an unambiguous referent instead of the user hoping the chatbot knows.

## Kill the injected duplicate sequence card

The sequence overview inside chat does not help — the sequence already exists 800 pixels to the left. Worse, it creates another action state: **Looks good · send 2 next**. What does that mean relative to the page's Enroll button? Advancing a draft review? Sending email 1? Approving send 1? Selecting send 2? Unclear. Chat should reference the canonical sequence UI instead: *"I've updated Send 1. The sequence has one unsaved change."* with a `View Send 1` link. No duplicate mini application inside the conversation. If chat needs a card, it is a compact reference to the same underlying object, not a second independently actionable sequence UI.

## There is a good product hiding here

The recommendation is reasonable: we know almost nothing about this company, so do not fabricate personalization — ask a simple honest question. That is good behaviour. The interface buries that intelligent decision beneath several thousand characters explaining why it knows almost nothing. Say instead: **Research confidence: Low. We verified 4 useful facts. We couldn't establish what the company does. Recommendation: use a low-pressure curiosity sequence rather than fabricate personalization.** Then let me inspect the evidence if I care.

## Priority order

| Priority | Change |
|---|---|
| **P0** | Fix chat grounding and contradictions with the active brief |
| **P0** | Resolve current-sequence vs recommended-sequence state before allowing Enroll |
| **P1** | Separate Brief, Recommendation and Sequence into distinct artifacts |
| **P1** | Collapse the low-confidence brief to 3–5 useful sections |
| **P1** | Upgrade research with actual web search + browser-render fallback |
| **P1** | Eliminate duplicate sequence UI/actions inside chat |
| **P2** | Remove the permanent metadata rail; move details into Evidence |
| **P2** | Make chat an artifact-aware drawer |
| **P2** | Replace global confidence with evidence-aware confidence internally |
| **P3** | Polish source chips, editing interactions and evidence inspection |

**North star for this screen:** I can understand what Vocion knows, what it recommends, why, exactly what it will do, and edit or approve it in under 30 seconds. All the ingredients are present; they are stacked on top of each other instead of forming one clear flow.

## Follow-up (Chris, same session): should the brief be an artifact?

> "should the 'Personalization Brief' use the artifacts system? so that we can reference it, edit, and version it? like any good md content file?"

**Yes.** A research brief is markdown produced by an agent, edited by a human, that needs versions, authorship, citation and a stable id. That is the artifact contract exactly (migration 0101 `artifact_version`: version, author kind, change summary, restore-as-new-head, folder, the artifacts log, the preview panel, `@mention` in the composer). Building a second store for briefs would be the §19 mistake — a real gap closed locally instead of generically.

So the causal chain becomes literal, each link an artifact with a version and an author:

**Evidence → Brief (artifact) → Recommendation (artifact) → Draft sequence (artifact) → Human decision → Action**

What this buys immediately: the brief is referenceable (`@Dana's brief`), previewable in the side panel like any other reference, versioned so an edit is attributable, restorable, and listed in the artifacts log. The chat's context indicator ("Working with: `Dana's brief` `4-send sequence`") becomes literally the artifact ids it has attached, not prose.

What it requires, and must be built honestly rather than assumed:
- **Artifacts are conversation-scoped today.** A brief belongs to a *record*. Artifacts need to attach to a record as well as a conversation — a real extension of the artifact model, not a field bolted on.
- **The sequence is structured, not prose.** Artifact kinds already include table/record/chart; the draft sequence is a typed artifact, not markdown, and its editor is the sequence editor rather than a textarea.
- **A decision must pin the version it approved.** Enroll records the exact brief, recommendation and sequence versions it acted on, so the audit answers "what did the human actually approve" rather than "what does this look like now".
- **Regeneration is a new version, never a silent overwrite**, with the reason in the change summary.
