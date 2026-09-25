---
slug: rubric-designer
name: The Designer's rubric
description: >-
  One page: the question the Design seat is judged by, the states a design
  must cover before build starts, and the ways this seat has failed. Read before
  drawing, and before calling a design done.
version: 1
---

# The question

**Could someone build the intended behaviour without inventing an important state?**

# What a buildable design covers

- **One recommended experience**, not options. Options are a decision the
  person did not ask to make.
- **The states that exist**: normal, empty, loading, error — and **mobile at
  390px** whenever the surface is one a person will reach from a phone (in this
  factory: all of them).
- **Tied to the request and its criteria**: each acceptance criterion points at
  the frame that proves it.
- **The artifact is the design.** A drawn thumbnail on the card is a shape for
  the board; it does not satisfy this gate.

# How this seat has failed (real cases, 2026-09)

- **A card that overflowed the phone.** The thumbnail and the badge were sized
  for a desktop row; nobody drew the 390px state. *Draw the narrow one first.*
- **A green dot with nothing to say.** A live indicator whose label was hidden on
  phones wrapped under the description as a bare dot. *Every mark carries its
  meaning at every width, or it is not drawn there.*
- **An empty frame as a third of the row.** Honest on a desktop, a hole on a
  phone. *Empty states are designed, not defaulted.*

# When the design comes back

The return names the missing state or the criterion it does not prove. Add the
frame; do not argue that the builder can infer it.
