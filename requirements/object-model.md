# Object Model

## Identity and Policy Objects

Exposed to customer admins.

| Object | Description |
|--------|-------------|
| **Workspace** | Top-level tenant (maps to Clerk organization) |
| **User** | Individual user within a workspace |
| **Team** | Group of users within a workspace |
| **Role** | Permission role (org:admin, org:member, etc.) |
| **Access Policy** | Rules governing data visibility |
| **Approval Policy** | Rules governing who can approve what |

### Three Permission Layers

1. **Who can see data** - data visibility policies
2. **Who can run skills/actions** - execution policies
3. **Who can approve workflows** - approval policies

## Context Objects

Exposed to admins and domain owners.

| Object | Description |
|--------|-------------|
| **Source System** | External system (Slack, Google Drive, Salesforce, Jira, etc.) |
| **Connector** | Configured connection into a source system |
| **Knowledge Domain** | Business domain (Sales, Support, Product, Finance) |
| **Business Object** | Canonical entity (Account, Deal, Ticket, Project, Product, Contract, Customer) |
| **Object Mapping** | Rules mapping source records into canonical business objects |
| **Citation / Evidence Item** | Source unit shown to the user in answers |

### Business Object Mapping Examples

This is the primary differentiator. A managed solution maps enterprise reality, not just documents.

```
Account = Salesforce account
        + Slack customer channel
        + Drive folder
        + Jira epic
        + Notion docs

Project = Jira project
        + GitHub repo
        + decision docs
        + release notes

Incident = PagerDuty incident
          + Slack thread
          + postmortem
          + Jira tasks
```

## Capability Objects

Exposed to users and builders.

| Object | Description |
|--------|-------------|
| **Skill** | Atomic packaged capability (prompt + retrieval scope + variables + output contract + allowed mutations + evals) |
| **Assistant** | Conversational surface that can choose or invoke skills |
| **Action** | Concrete mutation or API call |
| **Workflow** | Graph of steps, often using multiple skills |
| **Trigger** | What starts a workflow (manual, scheduled, event-driven) |
| **Hook** | Response to an event (e.g., "after approval, notify Slack") |
| **Run** | One execution instance of a skill or workflow |
| **Approval Task** | Human checkpoint within a workflow |

## Optimization and Governance Objects

Mostly internal, but admins see outcomes.

| Object | Description |
|--------|-------------|
| **Prompt Version** | Versioned prompt template |
| **Retrieval Profile** | Scoped retrieval configuration |
| **Eval Set** | Gold-standard test cases |
| **Feedback Event** | User feedback (thumbs, corrections, reports) |
| **Audit Event** | System audit trail entry |
| **Usage Record** | Usage metrics per workspace/user |
| **Incident / Error Record** | System error or failure record |
