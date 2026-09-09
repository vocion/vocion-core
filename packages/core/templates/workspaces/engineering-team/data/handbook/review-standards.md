---
title: Code review standards
owner: Platform team
updated: 2026-08-14
---

# Code review standards

## What blocks a merge

Only four kinds of finding block. Everything else is a suggestion and is
labelled as one.

1. **Incorrect behaviour** — the change does not do what the description
   says, or breaks a documented behaviour.
2. **Security or data exposure** — authentication, authorisation,
   tenancy, secrets, or PII in a log line.
3. **Unsafe migration** — a schema change that takes a long lock, drops
   a column still read by running code, or cannot be rolled back.
4. **A missing test for new behaviour** — every behaviour a change adds
   gets one named test case. Refactors that add no behaviour do not.

## Review shape

A review names the single most important finding first. Reviewers quote
the line they mean. Reviewers say what they did not check — generated
files, infrastructure, anything behind a feature flag.

## Turnaround

- First review within one business day of the pull request opening.
- A pull request open more than five business days has a named blocker
  and a named owner, or it is closed.

## Tenancy

Any query that reads a tenant-scoped table filters on the organisation
id from the verified request context, never from the request body. A
review that cannot see the filter blocks.
