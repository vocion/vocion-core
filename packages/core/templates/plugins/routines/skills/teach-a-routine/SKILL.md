---
slug: teach-a-routine
name: Teach a task
description: >-
  Turn a narrated Slate recording of repeatable work into a routine its expert
  approves, run it for a list of rows in parallel, and report on the batch.
  Read when a person shares a Slate recording of a task, asks to automate work
  they do in a web app, or hands over a list to process.
version: 2
---

# Teach a task

A **routine** is a repeatable process a specialist taught once, that Vocion
runs, escalates and improves over time. Every routine has a **human expert**
responsible for its exceptions.

The product calls these **Automations**, their teaching inputs **Recordings**,
and executions **Runs**. Use **Teach a task** in user-facing instructions;
the `routine_*` tool names and stored identifiers are unchanged.

## Teach

1. The specialist records the task in Slate on the real system and narrates
   why each step happens and the rules ("look the person up by email first",
   "never create a duplicate"). One normal case and one exception is best.
2. `routine_teach` with the link. The analyst reads the transcript, what was
   on screen, and frames at the moments that matter, and drafts: steps linked
   to their moments, rules, escalation points, prohibited actions, inputs
   (which are shared by every row, which identify a row), outputs read back
   after saving, the buttons that save, and how to check the whole list.
3. List the open questions word for word. The expert answers them; record each
   with `routine_update` in their words.
4. The expert approves the version and sets trust. **Drafted**: every save
   waits for a person. **Approved**: the saves the spec names run unattended;
   anything else still waits. **Autonomous** is earned on verified runs.

## Run

`routine_run` with the rows (pasted CSV as `rows_csv`) and the shared inputs.
One browser run per row, several at once, each in a browser of its own. Rows
this routine already did are skipped (the dedupe ledger). A run that meets an
escalation point stops and asks the expert, with the page as evidence; their
answer goes back to the run. A run that stopped after a write it cannot
confirm is never replayed: the expert checks it by hand.

After the rows, when the routine adds records to a list, one read-only run
checks the whole list against the rows. Records not on the list are a
finding: the expert chooses to deactivate them, delete them, or leave them,
and that change runs as its own batch, approved by their answer.

## Report

`routine_report` by batch id: rows done and verified by read-back, skipped,
escalated and how each was answered, human minutes against the manual
baseline from the recording, run cost, and the findings.
