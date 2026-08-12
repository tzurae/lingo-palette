# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area about to be changed.

If either location does not exist, proceed silently. Do not suggest creating it upfront. The `/domain-modeling` skill creates domain documentation lazily when terms or decisions are actually resolved.

## File structure

This repo uses a single-context layout:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

`CONTEXT.md` contains the shared domain glossary. `docs/adr/` contains architectural and product decisions that apply to this codebase.

Do not introduce `CONTEXT-MAP.md` or context-scoped `CONTEXT.md` files unless the repo later develops genuinely independent domain contexts.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, test name, or implementation plan, use the term defined in `CONTEXT.md`.

Do not drift to synonyms that the glossary explicitly marks with `_Avoid_`.

If a required concept is absent from the glossary, reconsider whether the output is inventing language the project does not use. If the gap is real, note it for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision:

> _Contradicts ADR-0007 — but worth reopening because…_
