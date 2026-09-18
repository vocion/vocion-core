---
slug: test-entry
name: "Test Entry"
description: >-
  Run a new definition against a case whose answer is already known, side by side.
version: 1
---

# Test Entry

Pick a case they have already done by hand — ideally the exact one captured.
Run the new definition and show the output next to theirs.

This step decides whether the thing gets used. Somebody who has watched it
reproduce a known-good result will let it run; somebody who has not will
check it every time, which saves nothing.

Where it differs, find out why before changing anything. The difference is
sometimes the definition being wrong and sometimes the definition being
right about something done inconsistently by hand — and those need opposite
responses.

**Do not ask them to accept a near miss.** Fix it and run it again.
