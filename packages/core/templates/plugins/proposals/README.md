# Proposals

The client document, written from its data room: a proposal, a scope document,
a partnership update — US-Letter sheets in the house framework, self-contained
HTML that prints to the PDF the client reads, and **not done until the
render-verify receipt reads clean**.

**What turning it on adds**

- The **Proposal Writer** agent: reads the room first, builds with
  `render_document`, fixes what the receipt names sheet by sheet, verifies with
  the look, exports the PDF. Shadows the base pack's brief-only Proposal Writer.
- The `proposal-document` skill: the framework CSS, the component vocabulary,
  the twelve-sheet spine, when a sheet earns a visual, the structure and
  language rules, the verify loop and the red-team rubric.
- **Red team before send**: `red_team_document` reads the document as the
  sceptical buyer — grounding, promised outcomes, placeholders, the client's
  words, scope, commercial clarity, register — and returns numbered findings
  by sheet with the fix. Blocks are not sent.
- **It learns from every correction.** The writer declares the
  `proposal-feedback` learning step: every review decision on a proposal and
  every correction in chat files a candidate there, and adopted rules mount
  before the next proposal. A red-team finding that recurs becomes a rule.
- The **Proposals** app under GTM (`/gtm/proposals`): every room at Proposal
  stage, its latest document and verify state, open items, and Draft.
- A weekly mission: every Proposal-stage room has a verified current document,
  or an open item saying what is missing.
- The `proposals` team, graded on documents rendered and documents that
  verified clean.

**Customise it** in the workspace: patch the writer with
`agents/proposal-writer.yaml` + `extends: core` (a different model, more
skills, your KPI), replace the framework whole-file at
`skills/proposal-document/`, and put your palette, logos and voice in
`brand.yaml` — the writer reads them with `get_brand`.

Depends on **data-rooms**; turning this on turns that on.
