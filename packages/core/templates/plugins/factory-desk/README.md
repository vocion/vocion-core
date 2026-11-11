# Factory desk

Vocion in front of a delivery factory. People ask where they talk; the factory builds; the desk carries
everything between the two.

| Step | Who | How |
| --- | --- | --- |
| Asked | a person, in a thread or the app's chat | mention the desk |
| Clarified | the desk | at most one round of questions, only for what the ticket cannot start without |
| Filed | the desk | `mcp_act` → the factory's filing tool; the ticket link is posted in the thread |
| Needs a person | the factory | it pings the workspace, which reads its updates then; the desk answers from the thread when the thread settled it, else asks the thread |
| Answered or approved | a person, in the thread | the desk passes it on with `mcp_act` → the factory's reply tool, in their name: every step, to the merge |
| Handed over | a person says "answer it for me" | the desk reads it, decides with its own judgment, records it as theirs decided by the desk, and says why |
| Shipped | the factory | the release page is posted in the thread |

## Setting it up

1. Add a source named `factory` to the workspace (`sources/factory.yaml`):

   ```yaml
   slug: factory
   name: Factory
   kind: mcp
   config:
     readTools: [ticket_status, ticket_updates, list_tickets, list_blockers, release_get]
     actTools: [request_ticket, reply_ticket, watch_updates]
     updatesTool: ticket_updates
     updatesWatchTool: watch_updates
   ```

   The tool names are the factory's own; these are the Metacto Factory's. A factory fits when it has a tool that
   files a request and takes an `origin` object, one that answers what a ticket waits on, and a read that returns
   `{updates: [{id, conversation, text, url, asks}]}` and takes `{ack: [ids]}`.
2. On Connectors, add **REST or MCP API (bearer token)** for that source: the factory's MCP endpoint and a token
   that reaches only this team's tickets.
3. Turn the plugin on (`plugins: [factory-desk]`) and bind the channel to `factory-desk`.
4. To let the desk answer the factory on its own when the thread already settled the question, add to the
   workspace's `trust.yaml`:

   ```yaml
   - action: mcp.act.factory.reply_ticket
     autoApproveAbove: 0.85
     enabled: true
     rung: execute-within-bounds
     risk: low
   ```

   Without it the desk's own answer is a card for a person. What a person says in the thread is passed on
   either way: their word runs.
