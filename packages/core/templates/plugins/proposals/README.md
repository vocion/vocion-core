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
- **The framework is injected, not copied.** `framework.css` goes into every
  document the render path renders, underneath whatever `<style>` the model
  wrote, and is re-injected on every edit and every verify — so the document
  is still a self-contained file that prints and downloads on its own, and a
  hand-typed copy can no longer drift from it. The receipt also names **every
  class used with no rule anywhere in the document**, which catches a class a
  workspace invented as well as one the framework never had.
- **The client's logo, fetched for real.** `fetch_image` takes a URL, checks
  from the BYTES that it is an image, downscales it and returns a data URI to
  inline; with a `room_id` it lands on the data room's `brand`, so the mark is
  fetched once and every later document written from that room uses the same
  one. `read_data_room` prints it under **Client brand**.
- **Red team before send, enforced by the export**: `red_team_document` reads
  the document as the sceptical buyer — grounding, promised outcomes,
  placeholders, the client's words, scope, commercial clarity, register — and
  returns numbered findings by sheet with the fix, stored on the version it
  read. `export_document_pdf` will not print a client document that has a
  blocking finding, and runs the read itself if nobody has. Which playbooks
  count as client-facing is `defaults.clientFacingPlaybooks` in workspace.yaml
  (`proposal`, `scope`, `partnership-update` by default).
- **It learns from every correction, without being asked to.** The writer
  declares the `proposal-feedback` learning step. A turn in which a person
  corrected the writer's work on a document — the turn changed a document AND
  the message instructed — has the standing rules in what they said drafted by
  the cheap model and put through the trust ladder
  (`learning.adopt_rule`): above the workspace's learning bar
  (`defaults.learningEagerness`, 7/10 → 72% by default) the rule adopts
  itself and shows in Review › Decided with **Undo**; below it, a person
  decides on a card carrying their own words. A restatement of a rule already
  on file raises its occurrence count instead of adding a near-duplicate.
  Review decisions on a proposal file there the same way, and a red-team
  finding that recurs becomes a rule. To review every rule instead, set
  `learningEagerness: 0`, or pin the kind with an `autoApproveAbove` in the
  workspace's own `trust.yaml`.
- **No sheet is a wall of text**, and `verify_document` checks it without a
  model: the framework declares its component vocabulary in `framework.css`
  (`.vocion-component-vocabulary`), and the receipt names every sheet carrying
  none of it, by number and label. A report, not a refusal — the spine allows
  a sheet to be prose when prose is right, and that sheet says so in one line.
- The **Proposals** app under GTM (`/gtm/proposals`): every room at Proposal
  stage, its latest document and verify state, open items, and Draft.
- A weekly mission: every Proposal-stage room has a verified current document,
  or an open item saying what is missing.
- The `proposals` team, graded on documents rendered and documents that
  verified clean.

**Customise it** in the workspace: patch the writer with
`agents/proposal-writer.yaml` + `extends: core` (a different model, more
skills, your KPI), replace the framework whole-file at
`skills/proposal-document/` — the injected CSS is read through the same
override path, so your `framework.css` is the one that ships in the document —
and put your palette, logos and voice in `brand.yaml`, which the writer reads
with `get_brand`.

Depends on **data-rooms**; turning this on turns that on.
