# The spark

Vocion has one AI colour, the **spark**: the Vocion mark's own rail, violet
into indigo, blue and teal (`--spark-1…4` = `#7C3CFF`, `#4D63FF`, `#168BFF`,
`#16D6D2`; `--spark`,
`--spark-conic`; as text, `--shimmer-1…4`, deepened in light and brightened
in dark). It means **an agent is at work**, and it appears only where that is
true:

- **An agent's dot at work.** `AgentDot working`: the spark blooms over the
  agent's own colour from the centre (600ms), turns and breathes;
  `AgentDot settling` lets it go when the work ends (900ms). The live line
  blooms; the turn header settles. One face per agent: its own colour at rest
  everywhere.
- **The empty chat's big spark**: a still `SparkOrb` (`xl`, 64px) above the
  team, Vocion ready to work; the lead and its teammates sit under it in
  their own colours.
- **At inline size the spark is flat.** Below 20px (`SparkOrb` and `AgentDot`
  at `xs`/`sm`, the live line's 14px mark) a sphere's highlight, a turning
  conic and a glow halo turn to mud, so the mark is a flat disc of the
  gradient that softly pulses (`data-flat`). Larger orbs keep the sphere.
- **The thinking line** (`.work-shimmer`), a soft spark band sweeping muted
  text, 13px semibold on the live line: slow (4.8s, eased) and quiet (each stop
  blended a third back to the muted tone), so it glows rather than flashes.
- **The composer's edge** while a turn runs (`.composer-working`).
- **The flash** on what a turn just changed (`[data-version-changed]`).
- **`SparkOrb`**, the bare orb, only where no agent is known.

Never a button, card, row, section, header, chip or filter, and never on a
surface when nothing is working: a static "agent suggests" mark is muted ink
plus the agent's `AgentDot`, not a coloured sparkle. The spark stays Vocion's
on a branded Org; the Org's colour is its logo, links and focus.

Reduced motion keeps the colour and drops the movement: the orb is still, the
shimmer is plain muted text, the composer edge stops drifting.

**Where it came from.** Jamie's "not sexy enough" (2026-10-23), measured
against Breeze, ElevenLabs and Amplitude: all three keep the app plain and
spend colour on the AI's presence. Chris picked the Prism palette and the
bloom-and-settle transition.
