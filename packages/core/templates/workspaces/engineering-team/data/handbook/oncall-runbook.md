---
title: On-call runbook
owner: Platform team
updated: 2026-08-02
---

# On-call runbook

## The first ten minutes

1. Acknowledge the page.
2. Decide severity from the matrix and say it out loud in the incident
   channel, with the sentence from the matrix that decides it.
3. Post the blast radius: which services, which environments, since
   when. "Unknown" is an acceptable answer and a better one than a
   guess.
4. List what changed in the last 24 hours — deploys, merged pull
   requests, configuration changes — most suspicious first.

## Mitigate before diagnosing

Restore service first. A rollback that costs a day of debugging context
is still cheaper than an hour of downtime. Diagnosis happens after.

## Communication

The incident lead posts an update every 30 minutes while a SEV1 or SEV2
is open, even when the update is "no change".

## After

Postmortem within three business days. Timeline entries carry a
timestamp and the artifact they came from. No individual is named as a
cause.
