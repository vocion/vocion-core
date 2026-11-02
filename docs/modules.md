# Apps, modules, and shared data

An app is a product surface. A module is an installable capability. Vocion's
existing `plugin.yaml`, dependency resolver, bundle installer and upgrade
history implement modules; there is no second registry or deployment system.
The internal name remains **plugin** for compatibility.

GTM hosts the optional native CRM foundation. Other apps can consume its
records without copying them. Identity, workspace access, objects, collection
tables, jobs, events, reviews and auditing remain platform responsibilities.

## Data contracts

A module owns the definitions in its `objects/` folder. It can export types
for another module to use, import declared exports from direct dependencies,
and mount list/table pages over either. Collection views contain no records.

```yaml
slug: customer-delivery
name: Customer delivery
version: 1.0.0
description: Delivery views over the workspace's native customer records.
depends: [native-crm]
data:
  imports:
    - module: native-crm
      objects: [crm_company]
  collections:
    - page: delivery-customers
      objectType: crm_company
```

The module also ships `pages/delivery-customers.yaml`:

```yaml
slug: delivery-customers
title: Customers
archetype: list
layout: table
source: {kind: objects, objectType: crm_company}
fields:
  - {key: name, label: Company, from: meta.name}
rowLink: /dashboard/objects/{id}
```

The owning module declares `data.exports: [crm_company]`. The loader rejects
competing object ownership, missing exports, imports without direct dependencies,
and missing or miswired collection pages before composition or installation.
Existing modules without `data` remain compatible. Workspace overrides still
follow the existing composition rules; these checks validate shipped module
contracts, not every possible runtime customization.

Exports are schema contracts, not access grants. Every record operation must
still enforce the requesting workspace and actor's permissions. A module import
never exposes personal Lists or grants access to a different workspace.

## Lifecycle

Install and upgrade use the existing additive bundle applier and its version
history. Disabling a dependency removes all transitive dependents from the
requested module set so dependency resolution cannot silently turn it back on.
Disabling retains business records and history. Re-enabling uses the same type
identities. Destructive schema migrations and record deletion are separate work.

The existing install path can report partial apply errors. Data contracts add
preflight validation; they do not make every module installation transactional.
Do not treat an enabled flag as proof that all resources installed successfully.

## Lists and authoritative records

Objects are domain records; tables and collection lists are views over them.
Personal/shared dynamic Lists are a platform capability being developed
separately, not a new per-module database. Keep their ownership and access rules
in that service. A module must call that service rather than query private List
rows directly or copy the List engine into its own implementation.

This release mounts object-backed collections. It does not yet install dynamic
List templates through `data`, convert personal Lists to CRM objects, or provide
a generic object/List adapter. That integration must preserve IDs or explicit
source mappings, provenance, revisions, permissions, and retry safety; a CRM
starter List is not automatically the authoritative native CRM.

## Native CRM Sprint 1

`native-crm` supplies company, contact, deal and activity object definitions,
exports and GTM table pages. Install explicitly to pilot it. Existing workspaces
are not automatically opted in. Adding GTM to a new workspace includes the feature.
See [the module README](../packages/core/templates/plugins/native-crm/README.md).

Acceptance covered by automated checks: valid module composition; rejected
invalid contracts; transitive disable; idempotent CRM installation; workspace
isolation for record reads; retained IDs on disable/re-enable; collection pages
visible only with the feature enabled.

Before a HubSpot cutover: enforce CRM-specific commands and references; integrate
the dynamic List promotion path; add a native provider for existing agents;
map and reconcile all HubSpot data and workflows; replace sending/sequence and
handoff execution; validate historical reporting and rollback. HubSpot remains
the operational authority until that migration is explicitly performed.
