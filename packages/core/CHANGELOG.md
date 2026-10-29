# @action-flow/core

## 0.1.0

### Minor Changes

- f429d19: Add execution IDs, trace IDs and parent context propagation for nested and concurrent dispatches. Provide bounded in-memory traces with lifecycle subscriptions, immutable detail snapshots, opt-in capture and redaction.

  Add environment-controlled tracing, onion middleware and cooperative AbortSignal propagation, including linked child signals and cancellation records. Keep original business results and errors at the dispatch boundary.
- Initial public release of ActionFlow.

  - Core: typed Action definitions, modules, dispatch, explicit contracts, provider injection, middleware, cancellation and bounded execution traces.
  - Scenario: isolated provider overrides and Action mocks, fixture setup/cleanup, per-run observation and trace inspection.
  - DevTools: an explicitly mounted browser panel for Action search, JSON input, Scenario execution, live call trees, history and cooperative cancellation.
- b85fa13: Introduce the core action runtime with typed static dispatch, modules, provider injection, a read-only registry, and nested action execution.

  Define modules with `defineModule(namespace, actionsMap)`, preserving all provider requirements when combining actions with and without dependencies.

  Add explicit Action contracts for typed nested dispatch, with assembly-time type checks for missing targets, incompatible inputs and outputs, conflicting contracts, and registration sets whose completeness cannot be established statically.
