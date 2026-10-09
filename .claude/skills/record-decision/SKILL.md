---
name: record-decision
description: Record a product or architecture decision and keep the planning docs in sync (docs/decisions.md, docs/project-description.md, docs/build-plan.md). Use this whenever the user decides, changes or settles something about scope, features, rules, the business model, tech choices or the plan, answers an open question, or says "let's go with", "we decided", "change the plan" or "add a feature".
---

# Record a decision

The three docs must agree. Update all affected ones in the same change.

1. **decisions.md** — add or edit one row in the right table (Product / Architecture). State the
   decision and the essential detail in one or two sentences. If it answers an item under
   "Still open", remove it there.
2. **project-description.md** — update every section the decision touches (Scope, Business model,
   Key flows, Data model, Security, Risks/open questions). Search for the old wording so nothing
   contradictory remains.
3. **build-plan.md** — add, move or remove checklist items in the phase where the work lands. If
   timing changes, update the gantt chart.
4. **Code** — if the decision is a rule, add or update the function in `packages/domain` and its
   tests, and the invariants list in `CLAUDE.md`.
5. **README / flows** — for major product features, add Need-to-know bullets in root `README.md`
   and a Mermaid diagram under `docs/flows/` when client → API → DB calls are non-trivial.
6. Summarize to the user what changed, and flag any assumption you made that they may want to
   overrule.
