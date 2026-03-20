# Skills System

Skills are the center of productization.

## Skill Definition

A skill is a packaged unit with:

| Property | Description |
|----------|-------------|
| Name | Human-readable identifier |
| Description | What the skill does |
| Owner | Team or user who maintains it |
| Input Schema | Variables and form fields |
| Allowed Scopes | Which domains, systems, objects are in scope |
| Prompt/Instructions | The prompt template with variable slots |
| Retrieval Profile | How and where to retrieve context |
| Allowed Actions | Mutations this skill can perform |
| Approval Requirement | Whether human approval is needed |
| Output Schema | Expected output structure |
| Eval Set | Gold-standard test cases |
| Version History | All prior versions |
| Rollback Target | Which version to fall back to |

## Skill Types

### Query Skills (Read-Only)

| Example | Description |
|---------|-------------|
| Summarize account health | Pull context across CRM, tickets, Slack |
| Find prior escalations | Search historical escalation patterns |
| Pull roadmap evidence | Gather product decisions and plans |
| Answer contract question | Retrieve and interpret contract terms |

### Mutation Skills (Take Action)

| Example | Description |
|---------|-------------|
| Create Jira ticket | Create ticket from context |
| Send follow-up email | Draft and send email |
| Update Salesforce field | Modify CRM record |
| Draft QBR deck outline | Generate structured output |

### Composite Skills (Read + Write)

| Example | Description |
|---------|-------------|
| Prepare renewal risk brief | Research and generate brief |
| Triage support escalation | Analyze, classify, route |
| Process inbound lead | Enrich, score, assign |
| Audit open customer risks | Scan, compile, flag |

## Integration with Onyx

Onyx supports actions through OpenAPI and MCP. The skill layer sits above that:

- **Onyx handles:** retrieval, tool access, action execution
- **CoreContext handles:** skill registry, variable forms, approvals, evals, versioning

## Starter Skills (Phase 2)

Target 10-15 query skills for initial deployment:

1. Summarize account
2. Find related tickets
3. Search knowledge base
4. Get recent activity for customer
5. Pull meeting notes
6. Find prior decisions on topic
7. Summarize Slack thread
8. Get project status
9. Find similar past issues
10. Generate account timeline
11. List open risks for customer
12. Summarize recent changes
13. Find relevant documentation
14. Compare two accounts
15. Get team activity summary
