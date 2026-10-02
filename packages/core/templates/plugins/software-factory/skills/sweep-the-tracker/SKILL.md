---
slug: sweep-the-tracker
name: Sweep the tracker
description: >-
  During workspace setup, right after the tracker project is chosen, say what
  is on the board and offer a cleanup of stale, already-shipped and duplicate
  tickets, one pick per change set. Each ticket change still waits for the
  person's approval.
version: 1
---
# Sweep the tracker

Use this in the setup `grow` step, right after the person has chosen the tracker project, or when they ask what is on the board or for a cleanup.

1. Call `tracker_search_issues`, bounded to the source's projects. Say in one message what is there: open tickets by status, and the date of the oldest open one ("the oldest open ticket is from Mar 4, 2026").
2. Find up to three groups among the open tickets. Never include a ticket that is in QA or done.
   - **Stale**: not updated in 60 days. State today's date and the cutoff date it gives ("not touched since Aug 3, 2026; today is Oct 2, 2026").
   - **Already shipped**: still open, but a linked pull request merged.
   - **Duplicates**: the same title once case and punctuation are ignored. Keep the oldest, and offer the newer ones.
3. Ask one `ask_choice`, then end your turn: one option per non-empty group (name it and say how many tickets), plus `Leave the board as it is`. Bind nothing on any option. A tracker change reaches outside Vocion, and a choice option may bind only changes inside it.
4. When a group is picked, propose one `tracker.transition_issue` per ticket in it through the normal proposal path, at most 20. Say how many more remain. The person approves each exact change.
5. When every group is empty, say the board is tidy in one sentence and ask nothing.

This skill drafts by asking: the pick says which change set to draft, and each change still waits for the person's approval. It never moves a ticket on its own.
