# Workspace manager (the `workspace-manager` plugin)

The workspace looking after itself. Using the platform should make the
platform better: every day people used the workspace, the **Workspace
manager** reads how it went — did each chat get the person where they wanted,
where did they have to ask again, what was missing — and files what would fix
it as proposals a person decides.

On by default in every shared workspace, in the Workforce app. Turning it off
on the Plugins page sticks.

**What it adds**

- The **Workspace manager** agent and its team, so its reports read as their
  own line on Briefings.
- `usage-review-check`: each morning at 06:00 in the workspace's own time zone,
  a read in code, with no model, of whether anyone used the workspace in the
  last day. Only then is `usage.review_due` raised.
- `usage-review`: answers that event — the agent runs `run_usage_review`
  once (`services/usageReview`), which publishes the day's report on Briefings
  and files its fixes on Needs you as `org.change` proposals: a connector,
  skill or tool people needed (`request_capability`), or a standing rule
  that would have prevented the friction (`adopt_rule`).
- Manage → Insights → **Usage review** for admins: every day's report, in
  the Briefings archive filtered to the manager's team. Ask the Workspace
  manager in chat to run one now.

**What it reads** depends on the Org's "Help improve Vocion" setting: chat
content and metadata, or metadata only. See `docs/guides/usage-review.md`.

**Customise it** in the workspace: move the check with
`automations/usage-review-check.yaml` (`when.schedule`), or turn the plugin
off. The judge's daily spend is capped by `VOCION_USAGE_REVIEW_DAILY_CENTS`.
