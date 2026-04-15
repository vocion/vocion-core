# Customer Onboarding

Build-up process for each new customer deployment.

## 1. Discovery

Map:
- Systems in use
- Teams and org structure
- Top workflows and pain points
- Compliance concerns
- ROI targets

## 2. Connector Onboarding

Connect high-value systems first. Typical priority order:

1. Slack
2. Google Drive / SharePoint
3. CRM (Salesforce, HubSpot)
4. Ticketing (Jira, Zendesk, Linear)
5. Knowledge base (Notion, Confluence)
6. Git / PM system (GitHub, Asana)

## 3. Permission Model

Define:
- Identity source (Clerk, SSO provider)
- Team structure
- Role model (which roles, who gets what)
- Approval boundaries (which actions need approval, by whom)
- Auth mode per connector (shared auth vs per-user auth)

Onyx actions support both shared auth and per-user auth. Vocion's policy layer decides what is allowed for whom.

## 4. Object Mapping

Create canonical business objects and mapping rules.

**This is not optional. This is the product.**

Example mappings for a typical customer:

| Business Object | Source Systems |
|-----------------|---------------|
| Account | Salesforce + Slack channel + Drive folder + Jira epic |
| Project | Jira project + GitHub repo + decision docs + release notes |
| Incident | PagerDuty + Slack thread + postmortem + Jira tasks |
| Customer | CRM record + support tickets + Slack DMs + contracts |

## 5. Skill Design

Pick the first 10-20 high-value skills. Prefer:

- Account review
- Escalation summary
- Report generation
- Task creation
- Record update
- Meeting follow-up

## 6. Eval Baseline

Create gold-standard test cases:

- Trusted answers (expected correct responses)
- Required citations (must reference specific sources)
- Forbidden sources (must not reference certain data)
- Expected actions (correct mutation for given context)
- Approval-required cases (verify approval flow triggers)

## 7. Pilot

Launch to one team, not the whole company.

- Select a champion team
- Set up office hours
- Collect structured feedback
- Iterate on skills and mappings
- Establish baseline metrics

## 8. Rollout

Expand by domain with:
- Champions per team
- Office hours
- Dashboard reviews
- Adoption metrics
- Feedback loops
