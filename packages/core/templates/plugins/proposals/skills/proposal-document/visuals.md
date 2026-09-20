# Visuals — when a sheet earns one, and how

Everything is hand-coded HTML and CSS in the document: inline SVG, the
framework's classes, and exactly two image files (the seller's mark and the
client's logo, as data URIs). No screenshots, no exported diagrams. That is why
a wording change is a text edit and the PDF prints at full resolution.

## The rule: no sheet is a wall of text

A sheet carries a component from the vocabulary below, **or** it says in one
line of its own prose why it does not need one. The test is the reader's:

> would they have to picture something they have never seen, or hold several
> things at once?

Either one, and the sheet has earned a component. Neither, and the sheet is
allowed its prose — and says so, in the sheet, in one line.

`verify_document` checks this. Its receipt names every sheet carrying no
component, by number and label. It is a report, not a refusal: a prose sheet
that earned its prose is fine, and the receipt is telling you to look, not to
change it.

Five of these are settled. They are not preferences; they are what a client
document does.

| Sheet | What it carries | Why |
|---|---|---|
| **Cover** | the client's logo lockup beside the seller's mark, and the three-step `.journey` term strip | they see their own mark, and the whole term in one line, before a word of prose |
| **The gap / the problem** | a **"today" window** — `.win2.plain`, the spreadsheet or paper log they run now | the before-and-after reads off the page; no sentence has to claim it |
| **Each product sheet** | a **product window** — `.win2`, titlebar naming the client's own app and site | "this is software", and it is theirs |
| **What you're buying** | **side-by-side windows** — `.ovcards`, one per product | three products held at once is exactly the "several things" case |
| **The plan** | the de-boxed `.gantt` | time, with parallel tracks |

The markup for all five is in `components.md`. Copy it; do not invent a
sibling.

## When a sheet earns a visual

A visual goes in when the reader has to picture something they have never
seen, or hold several things at once. Otherwise it is a sentence.

| The reader must… | Use | Example |
|---|---|---|
| picture a process they asked about | a numbered **step strip** — `.journey` for three with arrows, `.journey.n4` / `.journey.n5 mid` for four or five without | "how would this change the flow of operations?" → five steps of the walkaround |
| see a product they are buying but cannot see | a **window mock** (`.win2` / `.plat`): mac dots, hairline rows, status pills | the inspection queue with four believable rows and their states |
| hold time with parallel tracks | a de-boxed **Gantt** (`.gantt`): bars on month or week columns, solid = build, lighter = live and compounding, a dashed gate | the 4-month plan |
| grasp a method, not a result | a **categories-only dashboard** (`.dtiles`): Baseline · Measured · Tracked · Target, no numbers | the measurement sheet |
| compare two or three facts | a **sentence**, or `.drow` hairline rows | never a chart |

## The vocabulary

| Element | Form | Meaning |
|---|---|---|
| Open blocks | a 3px coloured top rule on the page background, never a white card | teal = foundation, people, context · accent = automation, agents, high trust |
| Window mock | the **only** boxed element in a document: `.win2` with a dark `.wh` titlebar naming the client's own app and place, `.wr-meta` queue state on the right, `.wr2` hairline rows of real-looking records, `.pill` states | "this is software" |
| Today window | `.win2.plain` — the same window, grey chrome, monospace rows, no pills, no brand colour | "what you run now" |
| Gantt | de-boxed swim lanes, bars over week or month columns, a dashed gate line, a `.g-note` anchoring week 1 to a real date | time |
| Chips | small-caps tags (`.syschip`, `.sk`) for measures, systems, skills; dashed and greyed (`.futtag`) when not built yet | what is measured, what is reached, what is later |
| Glyphs | inline line SVG, 24 viewBox, 1.8px stroke, `currentColor`: window = interface · nodes = intelligence · database = context · shield = trust · bot = agent · person = human | the kind of thing |
| Hairline rows | `.drow` definition rows, bold term then colon | the default when a visual is not earned |

## The two rules that keep a mock honest

Three, counting the plain one: **the "today" window is the client's system,
not a strawman.** Its rows are what their spreadsheet actually holds — the
columns they named on the call — and its caption says whose it is: "The
tracker the site team keeps today." A today window that invents how bad it is
loses the sheet the moment they read it.

1. **Every mock carries an italic caption underneath** (`.mock-cap`): "Illustrative interface. Checklists, SKU types and which steps require a photo are defined with your quality team in month 1." Call it the product UI, never a mock, in the prose.
2. **No invented performance figures, anywhere.** Dashboards show category labels, not numbers, and the caption says so: "showing categories rather than results; Metacto does not publish projected performance figures in a proposal." A believable mock row is a structure id and a state, never a result.

## Traps

- Short generic class names collide with house styles and make text vanish or turn accent-coloured. Use the framework's classes; do not invent `.gr` or `.roadmap` siblings.
- A class with no rule renders as a bare `<div>` and looks exactly like a component that "did not come out well". The render receipt now names every one of them; a clean receipt is part of the look, not just the layout.
- A Gantt bar lands on the wrong column silently. The look pass checks; read the receipt.
- A sheet of nothing but paragraphs is the failure that is hardest to see while writing it, because every paragraph is good. The receipt names each sheet that carries no component from the vocabulary; go and look at those sheets.
- Headless Chrome defaults to dark mode and can mojibake non-ASCII characters in a local render. Entity-escape them; ship no dark-mode block.
- Background colours print only because `print-color-adjust:exact` is forced; the client's own printer has "Background graphics" off by default.
