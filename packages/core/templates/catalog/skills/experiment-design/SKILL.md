---
slug: experiment-design
name: "Experiment Design"
description: >-
  Design a test with a hypothesis, one variable, a metric, the volume needed and the condition that stops it.
version: 1
---

# Experiment Design

Write the whole design before anything runs. A test defined afterwards is a
story about whatever happened.

- **Hypothesis.** What you believe, and what result would prove you wrong.
  A hypothesis that cannot fail is an intention.
- **One variable.** Change one thing. Two changes produce a result nobody
  can attribute, which costs the whole test.
- **The metric**, chosen before the run, and stated as the single thing that
  decides it. Secondary metrics are context and do not get promoted after
  the fact.
- **Volume needed** to tell the expected difference from noise, and
  therefore how long at current rate. If that is longer than anybody will
  wait, say so now rather than stopping early later.
- **Stop condition.** When it ends, and what ends it early — a result, a
  volume, or a harm threshold.

**Peeking invalidates it.** State that the result is read once, at the stop
condition, and not watched daily until it says something.

Say what a null result would mean. Most tests return one, and a design with
no plan for it wastes the run.
