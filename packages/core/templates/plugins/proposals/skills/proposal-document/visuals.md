# Visuals — when a sheet earns one, and how

Everything is hand-coded HTML and CSS in the document: inline SVG, the
framework's classes, and exactly two image files (the seller's mark and the
client's logo, as data URIs). No screenshots, no exported diagrams. That is why
a wording change is a text edit and the PDF prints at full resolution.

## When a sheet earns a visual

A visual goes in when the reader has to picture something they have never
seen, or hold several things at once. Otherwise it is a sentence.

| The reader must… | Use | Example |
|---|---|---|
| picture a process they asked about | a numbered **step strip** (`.journey`, three to five `.jstep`s) | "how would this change the flow of operations?" → five steps of the walkaround |
| see a product they are buying but cannot see | a **window mock** (`.win2` / `.plat`): mac dots, hairline rows, status pills | the inspection queue with four believable rows and their states |
| hold time with parallel tracks | a de-boxed **Gantt** (`.gantt`): bars on month or week columns, solid = build, lighter = live and compounding, a dashed gate | the 4-month plan |
| grasp a method, not a result | a **categories-only dashboard** (`.dtiles`): Baseline · Measured · Tracked · Target, no numbers | the measurement sheet |
| compare two or three facts | a **sentence**, or `.drow` hairline rows | never a chart |

## The vocabulary

| Element | Form | Meaning |
|---|---|---|
| Open blocks | a 3px coloured top rule on the page background, never a white card | teal = foundation, people, context · accent = automation, agents, high trust |
| Window mock | the **only** boxed element in a document: mac-dot header, hairline rows, `.pill` states | "this is software" |
| Gantt | de-boxed swim lanes, bars over week or month columns, a dashed gate line, a `.g-note` anchoring week 1 to a real date | time |
| Chips | small-caps tags (`.syschip`, `.sk`) for measures, systems, skills; dashed and greyed (`.futtag`) when not built yet | what is measured, what is reached, what is later |
| Glyphs | inline line SVG, 24 viewBox, 1.8px stroke, `currentColor`: window = interface · nodes = intelligence · database = context · shield = trust · bot = agent · person = human | the kind of thing |
| Hairline rows | `.drow` definition rows, bold term then colon | the default when a visual is not earned |

## The two rules that keep a mock honest

1. **Every mock carries an italic caption underneath** (`.mock-cap`): "Illustrative interface. Checklists, SKU types and which steps require a photo are defined with your quality team in month 1." Call it the product UI, never a mock, in the prose.
2. **No invented performance figures, anywhere.** Dashboards show category labels, not numbers, and the caption says so: "showing categories rather than results; Metacto does not publish projected performance figures in a proposal." A believable mock row is a structure id and a state, never a result.

## Traps

- Short generic class names collide with house styles and make text vanish or turn accent-coloured. Use the framework's classes; do not invent `.gr` or `.roadmap` siblings.
- A Gantt bar lands on the wrong column silently. The look pass checks; read the receipt.
- Headless Chrome defaults to dark mode and can mojibake non-ASCII characters in a local render. Entity-escape them; ship no dark-mode block.
- Background colours print only because `print-color-adjust:exact` is forced; the client's own printer has "Background graphics" off by default.
