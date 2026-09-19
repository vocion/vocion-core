# Red team — read it as the buyer before the buyer does

`red_team_document` reads every sheet as the sceptical operations lead who has
to carry this into an internal business case. It returns numbered findings by
sheet — the rule broken, what they read, the fix — graded `block` (not sent),
`fix` (costs trust) and `consider`. Run it after `verify_document` and before
you call a document ready; fix the blocks by sheet; run it again. Pass the
rubric below as `rubric` and the room's starred facts in brief as `context`.

**It is a gate, not a habit.** The result is stored on the version it read, and
`export_document_pdf` refuses to print a client document with a blocking
finding on its current version. If you have not run it, the export runs it for
you — on core's generic rubric only, without the house rules below. So run it
yourself: the rubric here is the part the gate cannot supply. An edit of any
kind makes the document unread again.

## House rubric (paste as `rubric`)

- **Grounding.** Every number, name, date and quote traces to the decision log or a starred source. **A fact the room already carries is sourced** — a call that happened, a filed transcript, a decision-log line — and asking for a written copy of a record the room holds is not a finding. An unsourced figure is a block unless it is a `.ph` placeholder marked "to be baselined". A claim about a third party (a named reference, another client's results) needs their permission, which is a different question from whether it is sourced.
- **No outcome promise.** We commit capabilities and to measuring together. A projected saving, percentage, revenue or return figure is a block. The client's own cost numbers belong in the problem statement, never in a promised return.
- **Placeholders in the open.** Anything unbaselined shows as a `.ph` chip in the document and is an open item on the room. Nothing unknown is dropped or guessed.
- **The client's words are the spine.** Their product names, their stage names, their question answered in their unit ("100 good and 100 bad per SKU", not "a few weeks"). The pull-quote is something they said, attributed and dated.
- **Scope is unmistakable.** In / out / later are visually and verbally distinct; the appendix says "not in this scope" in words; the out-of-scope list names the other project we must not touch.
- **Assume the yes.** No line invites a no, hedges, or argues against the offer. "If this drops down your list, say so" is cut.
- **One decision, framed.** Next steps are Confirm · Send the inputs · Kickoff, with a date or the reason there is none; the three paths at the end of term are all acceptable outcomes.
- **Commercial clarity.** Per-month, term, total, what lands each month and what is invoiced; run costs after handoff estimated later and never bundled; the named concession earned, never given; ownership paragraph matching the MSA.
- **Register.** No antithesis, no consultant jargon for the client's world, no prose em-dashes, no aphorisms, no "say so plainly" / "before anything moves" / "tell me plainly"; numerals; Metacto with a capital M; "the <client> team", never "<person>'s team"; capabilities, never headcount.
- **Structure.** One idea per sheet; every mock captioned illustrative; dashboards show categories, not numbers; the roadmap is the last sheet and marked out of scope.
- **The people question.** The system reports on structures, SKUs, plants and process steps — never per-person scorecards — and the FAQ says why.

## What to do with findings

- A **block** is fixed before anything else, with `edit_document` on the named sheet, then the document is red-teamed again.
- A **fix** is fixed, or left with one line saying why.
- A finding that appears on a **second document** is a rule: add it as a learning in the `proposal-feedback` step (`add_learning`) so the next proposal starts without it. The rubric above is where those rules eventually land.
