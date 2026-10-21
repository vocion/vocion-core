# Browser runs

A browser run is a task done in a web browser on a site with no API or
connector: a vendor portal, a government site, anything behind a sign-in. The
agent hands the task over, the browser works on its own, and the person
watches it beside the conversation.

It is a run, the third kind next to an engineering run (`worker_run`) and an
agent run (`mission_run`): a task, its inputs, the outputs it owes, every step
it took, and its result (`browser_run`, migration 0210).

## Asking for one

- **In chat, in words:** "use the browser to …". The consent read
  (`turnJudge.saidToDecide`) finds the person asked, and the run starts at once
  as theirs.
- **With `@browser`:** type `@brow` in the composer and pick **Browser**. The
  tag travels as a typed field (`asked_for`), so the run starts with no
  judgement call (`libs/chat/askedFor.ts`).
- **Suggested by the agent:** when the browser was the agent's idea, the run is
  filed as `proposed` with a **Start** button. Nothing runs until the person
  presses it.
- **From the list:** `/dashboard/browser` keeps the person's runs, and
  **Run the practice task** shows the whole shape in one click.

The agent's tools are `browser_task` (start or suggest, with inputs and named
outputs), `browser_task_check` and `browser_task_stop`.

## What the person sees

The run opens in the preview pane as it starts, and a chip with a live status
dot sits under the answer. The pane shows:

- the browser as it works, several frames a second, with the cursor gliding to
  what it clicks;
- each step, one line, with why;
- anything it is holding for the person, with **Approve** and **Decline**;
- what it found, each output by name, with a list of rows shown as a table.

A result that lands after the agent's turn has ended is said in the
conversation through `tellConversation`, so a run asked for from a Slack thread
reports back in that thread.

## What the browser may and may not do

- **Approval before anything that changes something:** a click on a button
  whose name says submit, send, pay, save, update, delete (and the rest of
  `CONSEQUENTIAL` in `libs/browser/run.ts`), or Enter in a form whose button
  does. The engine enforces this, not the model, so a page that talks the model
  into "click Pay" still stops.
- **Secrets are never read by the model.** An input marked secret reaches the
  model as `{{password}}`. The engine types the value, and any echo of it on a
  page is masked again. Its value is never stored.
- **Public addresses only.** Every request the page makes is checked the way
  the fetch tools check theirs (`libs/net/publicUrl.ts`). The box itself,
  private networks and the cloud metadata address are refused.
  `VOCION_BROWSER_ALLOW_HOSTS` opens named hosts for a test or a demo.
- **The page is data.** The loop's prompt says so, and the approval hold does
  not depend on the model believing it.

## Limits (for now)

- **One live run per person.** A second one is refused while the first runs or
  waits.
- **One browser per person, kept between runs.** It closes 20 minutes after the
  last run, so a follow-up task carries on from the page the last one left,
  still signed in (`continue_from_current_page`).
- **Per run:** 40 steps, 8 minutes of work, and 30 minutes waiting on the
  person.
- **In process.** The browser runs in the app process (the shared Chromium
  that renders documents). A run that was live when the app restarted reads as
  failed, saying so.

## The practice site

Fernhill Supply's supplier portal (`services/browser/practiceSite.ts`) is
answered from memory inside the browser and never touches the network. It has:

- a sign-in (`ap@larkfield.example` / `fernhill-demo`);
- a cookie banner in the way;
- an invoice list with a status filter, and invoice pages;
- a payment-details form whose **Save changes** is held for approval.

The data is fixed, so tests can assert on it: five unpaid invoices totalling
$40,689.35.

## Switching it on

- `VOCION_BROWSER_RUNS=on` gives every agent the tools in a person's turn and
  offers `@browser` in the composer.
- Without it, an agent needs `harness.grantTools: [browser_tasks]`.
- The loop runs on the `main` role with thinking off, charged to `browser.run`.

## Where this goes next

The engine is one seam: Playwright on the app box today. Amazon Bedrock
AgentCore Browser gives isolated, managed sessions over CDP, which Playwright
can drive the same way (`connectOverCDP`). Nova Act is a candidate engine for
visually heavy pages. The task, approvals, secrets, steps and outputs stay in
Vocion either way. A recorded demonstration (a Slate recording) turned into a
browser-run task is the step after that.
