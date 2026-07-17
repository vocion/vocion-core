# Contributing to Vocion

Thanks for your interest in improving Vocion. This document covers **how** to
contribute (commit conventions, checks) and the **licensing terms** your
contributions are made under.

## Contributor licensing terms

Vocion is released under the [Mozilla Public License 2.0](LICENSE), and Metacto,
Inc. also offers Vocion under separate [commercial licenses](COMMERCIAL-LICENSE.md).
For that dual model to work, Metacto must hold sufficient rights in the whole
codebase — including your contributions — to keep offering it under both the MPL
and commercial terms.

By submitting a contribution (a pull request, patch, or any other change) you
agree to both of the following:

1. **Inbound license & relicensing grant.** You license your contribution to
   Metacto and to all recipients of the software under the MPL 2.0, **and** you
   grant Metacto, Inc. a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable license — with the right to sublicense — to use, reproduce,
   modify, distribute, and **relicense** your contribution, including as part of
   a proprietary or commercial distribution of Vocion. You retain copyright in
   your contribution; this grant does not transfer ownership.

2. **Developer Certificate of Origin (DCO).** You certify the
   [DCO 1.1](https://developercertificate.org/) for every commit — in short,
   that you wrote the contribution or otherwise have the right to submit it under
   these terms. Certify it by signing off each commit:

   ```
   git commit -s
   ```

   which appends a `Signed-off-by: Your Name <you@example.com>` trailer.

If you cannot agree to these terms, please do not submit a contribution. For
substantial contributions from a company, or if you need a signed Contributor
License Agreement instead of the DCO, contact **licensing@metacto.com**.

## Commit conventions

Conventional commits, enforced by commitlint + lefthook:

| Type | Purpose |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `refactor` | Code change (no feature/fix) |
| `test` | Tests |
| `chore` | Build/tooling |

## Before you push

Run these locally (the pre-commit hook also handles auto-fix + type check +
unused-dep check):

```
npm run check:types
npm test
npm run lint
```
