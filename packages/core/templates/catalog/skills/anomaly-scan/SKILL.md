---
slug: anomaly-scan
name: "Anomaly Scan"
description: >-
  Separate a real movement from normal variation, with the baseline window stated.
version: 1
---

# Anomaly Scan

Establish what normal looks like before calling anything abnormal. State the
baseline window and why that window — the answer changes completely between
a week and a year.

Account for the variation you already expect: weekday and weekend, seasonal
shape, and known events like a campaign or a release. A Monday that looks
like every other Monday is not an anomaly.

**Report the movement with its size and its confidence**, not as a binary.
"Down 14%, which is outside the range of the last twelve weeks" is usable.
"Anomaly detected" is not.

Check the boring explanations first, in this order: did the data change, did
the measurement change, did the business change. Most anomalies are the
first two, and reporting a tracking break as a performance drop sends people
to fix the wrong thing.

Say what you checked and ruled out. Silence reads as not looked at.

Flagging is where this stops. Explaining the driver is `decompose-variance`.
