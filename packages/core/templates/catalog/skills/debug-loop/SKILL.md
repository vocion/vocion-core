---
slug: debug-loop
name: "Debug Loop"
description: >-
  Reproduce, isolate, diagnose, fix and verify — with the hypothesis stated before the change.
version: 1
---

# Debug Loop

**Reproduce first.** A fix for a fault you cannot reproduce cannot be
verified. Establish the exact conditions, and say so if they cannot be
established.

Isolate by bisecting: what changed, what differs between working and
failing, the smallest case that still fails.

**State the hypothesis before changing anything**, and what would
disconfirm it. Changing things until the symptom stops produces fixes that
are not fixes.

Fix the cause, and say explicitly when you are applying a mitigation
instead so it does not get recorded as resolved.

Verify against the original reproduction. Then ask where else this pattern
exists — one occurrence found is rarely one occurrence present.
