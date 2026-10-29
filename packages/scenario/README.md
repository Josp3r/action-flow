# @action-flow/scenario

Typed debug scenarios for `@action-flow/core`. Requires a Runtime created with `environment: "development"`, `environment: "test"` or an explicit `allowDebug: true`.

```sh
npm install @action-flow/core @action-flow/scenario
```

```ts
import { createRuntime, defineAction, defineModule } from "@action-flow/core";
import { createScenarioRunner } from "@action-flow/scenario";

const runtime = createRuntime({
  providers: {}, environment: "development",
  modules: [defineModule("math", { double: defineAction({ handler: (n: number) => n * 2 }) })],
});
const runner = createScenarioRunner(runtime);
const scenario = runner.defineScenario({ id: "double", action: "math.double", input: 3 });
const result = await runner.run(scenario);
if (result.status === "success") console.log(result.output); // number: 6
```

Definitions support `providers`, `mocks`, `setup`, `cleanup` and mutually exclusive `input` / `inputFactory`. Input and return mocks are checked against the selected registered Action. `providers` and `mocks` can be async factories receiving a per-run context. A provider factory initially sees the Runtime's base providers; subsequent hooks see the scoped bindings. Call `ctx.defer(release)` immediately after allocating a fixture to release it even if setup later fails.

`runner.runtime` exposes the associated Runtime. `runner.run(definition, { onTrace })` streams this run's live events only; synchronous and asynchronous observer failures are isolated. The separate `@action-flow/devtools` package uses this interface for its browser panel. Scenario does not import DevTools or access DOM globals.

Overrides and mocks propagate to nested Dispatch through an execution scope. They never replace Runtime bindings or handlers. Static objects retain their business object references; use factories for fresh mutable providers, inputs and mock values on repeated or concurrent runs. Overrides replace top-level bindings and are not deep merged or cloned.

The runner drains all started descendants before cleanup, then calls definition cleanup (if setup was entered) and all deferred releases in reverse order. Cancellation is cooperative and does not force a pending handler or hook to settle. Escaped calls made after scope closure reject. A caught or detached child failure stays in the trace; the root outcome determines execution success.

Results include `status`, `scenarioId`, `runId`, optional root IDs, a bounded local `trace`, `droppedRecords` and `cleanupErrors`. Failures preserve the thrown value. Cleanup failures return an `AggregateError` containing the primary failure (if any) followed by cleanup errors, and set status to `error`. Invalid/foreign definitions and disabled debug execution reject before lifecycle callbacks. The local trace defaults to 1,000 records and no payload capture, independently of Runtime retention and capture settings; configure `createScenarioRunner(runtime, { trace: ... })` when needed.

ESM only. The sole runtime dependency is `@action-flow/core`. This package does not manage application state. Production debug opt-in is an execution policy, not authentication or a security boundary for an exposed remote endpoint. See the changelog for 0.x API changes.
