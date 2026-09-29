# Any REST API as a live source

A workspace with an internal REST API — a delivery tracker, a billing system, a
headless CMS — can give its agents live tools over it, and let them propose
writes to it, by declaring the endpoints in one source file. No code: the
source is `kind: rest`, its `config` lists the endpoints, and the credential
is a base URL plus a bearer token kept in the vault.

Each entry under `tools` becomes one agent tool, called live at chat time.
Each entry under `actions` is a write the agent can only reach through the
`rest.request` action, which lands on the review queue and the
[trust ladder](../entities/trust.md) like every other connector write — a
person approves it until the workspace's `trust.yaml` says an endpoint has
earned autonomy.

It is one mechanism, not a connector per product (design principle 12): the
paths, the arguments and the review wording all come from the workspace.

Not to be confused with the `strapi` connector: `strapi` syncs a Strapi
instance's collections into search on a schedule (read-only, indexed, found
with `search_knowledge`), while `rest` calls any bearer-token API live at the
moment of the question and can propose writes to it — nothing is indexed. A
Strapi instance can be both, as two sources.

## The source file

```yaml
# sources/acme-delivery.yaml
slug: acme-delivery
name: Acme Delivery API
kind: rest
config:
  toolPrefix: delivery # default: the slug with '-' turned into '_'
  healthPath: /api/users/me # GET used by Test connection; default '/'
  tools: # READ endpoints — one agent tool each: <toolPrefix>_<name>
    - name: list_projects
      description: List projects visible to the account. Filter by status.
      method: GET
      path: /api/projects
      input: # JSON Schema (the subset below) → the tool's arguments
        type: object
        properties:
          status: {type: string, enum: [active, archived], description: Project status}
          search: {type: string, description: Substring of the project name}
        required: []
      query: # argument → query parameter; one whose template resolves to nothing is left out
        'filters[status][$eq]': '{status}'
        'filters[name][$containsi]': '{search}'
        'pagination[pageSize]': '100'
      response:
        pick: data # optional dotted path into the JSON to return
        maxChars: 40000 # default 40000; past it the text is cut and says how long it was
    - name: get_project
      method: GET
      path: /api/projects/{documentId} # path parameters come from the input, and must be required
      input: {type: object, properties: {documentId: {type: string}}, required: [documentId]}
  actions: # WRITE endpoints — reachable only through the rest.request action
    - name: update_milestone
      description: Change a milestone's name or due date.
      method: PUT
      path: /api/milestones/{documentId}
      input:
        type: object
        properties:
          documentId: {type: string}
          name: {type: string}
          dueDate: {type: string, format: date}
        required: [documentId]
      body: {data: {name: '{name}', dueDate: '{dueDate}'}} # template; a key whose value resolves to nothing is dropped
      reversible: false # false puts an Irreversible badge on the card
      review: # review card wording, templated from the input
        title: Update milestone {documentId}
        fields:
          - {label: Name, value: '{name}'}
          - {label: Due, value: '{dueDate}'}
```

`npm run workspace:check` validates every entry at apply, with the entry
named: a mistyped key, an input schema outside the subset, a `{placeholder}`
that names no argument, a path parameter that is not required, two tools with
one name. Nothing reaches an agent until the file is right.

### Fields

| Field | Default | What it does |
|---|---|---|
| `toolPrefix` | the slug, `-` → `_` | The first word of every tool name. |
| `healthPath` | `/` | What Test connection GETs with the token. Any 2xx counts. |
| `tools[]` | `[]` | Live reads. Each becomes `<toolPrefix>_<name>` for every agent that holds the source. |
| `actions[]` | `[]` | Writes. Reachable only through `rest.request`. |

Every tool or action:

| Field | Required | What it does |
|---|---|---|
| `name` | yes | snake_case. The tool suffix, or the action name `rest.request` takes. `list_actions` is reserved. |
| `description` | no | What the model reads. Defaults to `<METHOD> <path>`. |
| `method` | yes | `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `path` | yes | Under the credential's base URL. `{param}` segments are substituted from the input, URL-encoded; each must be a required input property. |
| `input` | no | The arguments, as JSON Schema — see the subset below. Default: no arguments. |
| `query` | no | Parameter name → template, on a tool or an action alike. A parameter whose template resolves to nothing is not sent. |
| `response.pick` | no | Dotted path into the JSON to return, e.g. `data.items`. A missing path is reported, not papered over. |
| `response.maxChars` | 40000 | Longest text handed back. Past it the text is cut and ends with a notice giving the total length. |

An action also takes:

| Field | Default | What it does |
|---|---|---|
| `body` | none | The JSON body as a template. Keys whose value resolves to nothing are dropped. |
| `reversible` | `false` | Whether a person could put the write back by hand. `false` badges the card Irreversible. |
| `review.title` | `<description> — <source name>` | The card's title, templated. |
| `review.fields[]` | `[]` | `{ label, value }` rows, templated. A row whose value resolves to nothing is left off. |

### Templates

`{argName}` inside any string is filled from the validated input. Three rules:

1. A string that is exactly one placeholder keeps the argument's own type —
   `'{count}'` sends `3`, not `"3"` — so numbers and booleans survive into a body.
2. An argument that was not supplied resolves to nothing: a lone placeholder
   becomes nothing, a mixed string whose every placeholder is missing becomes
   nothing (so `Due: {dueDate}` vanishes from the card), and a mixed string
   with some arguments present renders the missing ones empty.
3. An object key, an array entry or a query parameter that resolved to nothing
   is dropped — and an object whose every key dropped is dropped with them,
   recursively, so `priority: { name: '{priority}' }` with no priority never
   sends `priority: {}`. A literal `{}` in the template is kept; an emptied
   array stays `[]`.

A path is stricter: a missing path parameter refuses the call, because
`/api/projects/` is a different endpoint from `/api/projects/{id}`.

#### Built-in dates

Agents never do date arithmetic, and an API takes absolute dates, so a
template can name a date the server works out at call time, in the
workspace's timezone (`defaults.timezone`; the person's own zone for a chat
turn; UTC when neither is set), as `YYYY-MM-DD`:

| Placeholder | Resolves to |
|---|---|
| `{$today}` | today |
| `{$today-7d}`, `{$today+30d}` | today plus or minus a whole number of days |
| `{$weekStart}` | the Monday of this week |
| `{$monthStart}`, `{$monthEnd}` | the first and last day of this month |

They work anywhere an input placeholder does — a path, a query value, a body,
a review row — and beside one: `'{$today-7d}..{$today}'`. They are not
inputs: nothing about them reaches the model's tool schema, and the model
passes nothing for them. Any other `{$…}` is refused at apply.

```yaml
- name: due_this_week
  method: GET
  path: /api/milestones
  query:
    'filters[dueDate][$gte]': '{$weekStart}'
    'filters[dueDate][$lte]': '{$today+7d}'
```

### The input schema subset

An object whose properties are `string`, `number`, `integer`, `boolean`, or an
`array` of one of those; `enum` (strings) and `format` (`date`, `date-time`,
`email`, `uri`) on strings; `required`; `description` everywhere. Nothing
else — a nested object is refused with a message pointing at the `body`
template, which is where shape belongs. The subset is what converts to every
model provider's tool schema without a transform.

## Connecting it

1. Apply the workspace, or add the source at `/dashboard/connectors` → REST API
   (the form asks only for the prefix and the health path; the endpoints come
   from the file).
2. **Connect the credential** — two values kept together because a token is
   issued for one API:

   | Field | Shown |
   |---|---|
   | API base URL, e.g. `https://api.acme.example` | in full |
   | Bearer token | masked |

   The token goes out as `Authorization: Bearer <token>` on every call and
   nowhere else: never in a tool result, a card, a log line or an error. Give
   it read rights for the reads, and write rights only for the endpoints the
   source declares as actions. It is stored AES-256-GCM encrypted under the
   workspace's key (KMS-backed on a deployed install) and never written to
   the YAML.

   One live REST credential per workspace today (the `rest` platform is
   `one-live`, like Apollo, until the partial unique index behind the cap is
   rebuilt — `packages/core/src/libs/platforms/registry.ts` says why).

3. **Test connection** GETs the health path with the token and reports three
   checks: the API answered, the token was accepted, and what the source
   declares. Nothing is saved.
4. Give the source to an agent: `connectorSources: [acme-delivery]` in its
   YAML. An agent without the source has no such tool to call.

## What the agent gets

For the example above, an agent holding `acme-delivery` has:

| Tool | What it does |
|---|---|
| `delivery_list_projects` | `GET /api/projects` with the query built from its arguments; returns `data` as text. |
| `delivery_get_project` | `GET /api/projects/{documentId}`. |
| `delivery_list_actions` | The write catalog: each action's name, description, input schema and reversibility, and how to propose one. |

A read tool returns the API's own answer as pretty JSON. A failure is data
the model can say out loud, never a thrown error:

| `error` | When |
|---|---|
| `no_credentials` | Nothing is connected for the source — names the Connectors page. |
| `http_401`, `http_403` | The token was refused: it may have expired or lack rights. |
| `http_404` | Nothing at that path — check the identifier. |
| `http_4xx`, `http_5xx` | The API rejected the request, or failed on its side. |
| `timeout` | No answer within 15 seconds. |
| `invalid_json` | A 2xx whose body is not JSON. |
| `missing_path_param` | A call without a required path parameter; refused before any request. |
| `pick_missing` | The answer has no `response.pick` path; names the top-level keys it does have. |

## Writing: the `rest.request` action

An agent proposes a write with `propose_action`:

```json
{
  "action_id": "rest.request",
  "action_input": {
    "sourceSlug": "acme-delivery",
    "action": "update_milestone",
    "input": { "documentId": "m-12", "name": "Kickoff", "dueDate": "2026-10-01" },
    "summary": "Move the kickoff milestone to 1 October."
  },
  "confidence": 0.9,
  "rationale": "The client asked for it on Monday's call."
}
```

The why, the evidence and the confidence ride the proposal envelope, as they do
for every action; `action_input` carries only what the endpoint needs plus the
one-line `summary`. `input` is checked against the endpoint's declared schema
before any row is written: a source that does not exist or is not a REST source, an action the
source does not declare, an argument outside the schema, or a missing path
parameter is refused with a sentence the model can act on.

The proposal lands on Needs you as a card built from the endpoint's `review`
hints — the templated title, the rows that resolved, then Method and Path —
with the source name as its system badge, an Irreversible badge unless the
endpoint says `reversible: true`, and the exact request (method, path, query
and the rendered body) as a code block. Approving sends it with the source's
credential. A non-2xx is a failed run whose reason is the API's own answer;
a success records `{ status, method, path, body }` with the response picked
and capped the same way the reads are.

`rest.request` is external and has no undo, so by default every run waits for
a person. It carries no fixed source: the credential is the one connected to
the source the input names (`Action.sourceSlugFor`).

## Granting autonomy per endpoint

The trust ladder keys each run on `rest.request.<sourceSlug>.<action>`, so a
workspace promotes one endpoint while every other still waits:

```yaml
# trust.yaml
rules:
  - action: rest.request.acme-delivery.update_milestone
    autoApproveAbove: 0.95
    enabled: true
    rung: execute-within-bounds
```

A rule on the bare `rest.request` binds to nothing — each endpoint's ledger
stands alone, and earns its own evidence. An endpoint nobody has written a
rule for reads the action's default: external, high risk, execute with
approval.

## Where it lives

| | |
|---|---|
| Connector | `packages/core/src/libs/sources/rest.ts` |
| The contract and its validation | `packages/core/src/libs/rest/spec.ts`, `jsonSchema.ts`, `template.ts` |
| The HTTP client | `packages/core/src/libs/rest/client.ts` |
| The read tools | `packages/core/src/services/agents/tools/restDirect.ts` |
| The write action | `packages/core/src/libs/actions/rest.ts` |
| The credential platform | `rest` in `packages/core/src/libs/platforms/registry.ts` |
