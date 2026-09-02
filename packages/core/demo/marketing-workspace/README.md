# vocion-marketing workspace (shell)

The team that markets Vocion, running on Vocion. This is the Phase-0 shell
from the Self-Promoting Vocion brief: apply it, run the missions, and every
artifact lands in the review queue for a human to publish by hand. The
automation (GitHub/social/video actions, trust ladder) turns on later
without changing this workspace's shape.

## What's here
- 1 lead + 4 specialists (parent: marketing_lead) - strategy, build, write, amplify, measure
- 2 standing missions: the showcase loop (Mon/Wed/Fri) + strategy & weekly report (Mon)
- `showcase` tracker object type - one record per run: assets, cost, engagement
- `trust.yaml` - the autonomy growth ladder for the six outbound actions, ALL DISABLED
- `seed-budgets.ts` - proposed per-agent hard caps (~$400/mo team envelope), stub
- playbooks: brand voice + the loop procedure (selection rules, publishing order, the one-feature-request rule)

## Apply
    npm run workspace:check -- $PWD/demo/marketing-workspace
    npm run workspace:apply -- $PWD/demo/marketing-workspace --project <id|slug>

## What is deliberately NOT here yet (see requirements/self-promoting-loop.md)
- The six action handlers (github.issue, github.pr, devto.post, linkedin.post, x.post, youtube.upload)
- The video pipeline skill (Playwright recorder + TTS + ffmpeg)
- Engagement sync into the tracker (Growth Analyst reads by hand until then)
- The agent-build sandbox that turns approved feature requests into PRs (.github/workflows/agent-build.yml)
