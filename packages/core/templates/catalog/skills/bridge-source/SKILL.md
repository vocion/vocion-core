---
slug: bridge-source
name: "Bridge Source"
description: >-
  Connect an unlisted tool through the directory or a generic bridge, never a hand-built client.
version: 1
---

# Bridge Source

Check the connector directory first. A supported connector is maintained,
authenticated properly, and understands the system's own shapes.

Where none exists, use a generic bridge. **Never hand-build against a raw
API** — that produces something one person understands and nobody
maintains.

Establish before wiring anything: what it holds that is actually needed,
what the identifiers are and how they match existing records, what the
rate limits are, and whether reads are enough.

Start read-only. Confirm the data is what was expected before anything
writes.

Once connected it joins like any other source, under the same gates.
