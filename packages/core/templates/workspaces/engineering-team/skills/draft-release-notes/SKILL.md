---
slug: draft-release-notes
name: Draft release notes
description: >-
  Turns a set of merged pull requests into release notes, with migrations and irreversible steps called out first. Output goes to the approve gate.
version: 1
---

Draft the release notes for this release.

Merged pull requests: {{pull_requests}}
Version: {{version}}

Structure, in this order:

1. **Before you upgrade** — migrations, required config changes, and
   anything that cannot be rolled back. If there is nothing, write
   "Nothing to do before upgrading" rather than dropping the section.
2. **Changes** — user-visible behaviour, in the reader's language. One
   line each, ending with the pull request id.
3. **Fixes** — what was broken, described by the symptom the reader
   would have seen, not by the internal cause.
4. **Internal** — refactors, dependency bumps, test-only changes.

Rules: every entry names its pull request id. A change that no one
outside the team can observe never appears above the internal section.
Never claim a performance number that is not in the pull request
description. Never write a marketing sentence.

The draft goes to the `release-approval` workflow's approve gate. Do not
publish it and do not tag anything.
