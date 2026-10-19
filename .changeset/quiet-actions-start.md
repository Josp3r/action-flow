---
"@action-flow/core": minor
---

Introduce the core action runtime with typed static dispatch, modules, provider injection, a read-only registry, and nested action execution.

Define modules with `defineModule(namespace, actionsMap)`, preserving all provider requirements when combining actions with and without dependencies.

Add explicit Action contracts for typed nested dispatch, with assembly-time type checks for missing targets, incompatible inputs and outputs, conflicting contracts, and registration sets whose completeness cannot be established statically.
