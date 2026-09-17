---
slug: queue-sweep
name: "Queue Sweep"
description: >-
  Find what is aging, unassigned, or quietly past target.
version: 1
---

# Queue Sweep

Run against the whole queue, not only what is open in front of somebody.

Four piles: unassigned, no update in longer than the target allows, past
target, and waiting on somebody outside the team.

The fourth is the one that rots. Items waiting on an external party sit
outside anybody's list and are usually the oldest things in the queue.

Per item: how long, on whom, and the single next move. Sort by age within
each pile.

Report the counts and the trend. The number of items sitting untouched is a
better measure of queue health than the number closed.
