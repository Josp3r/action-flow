# @action-flow/core

Framework-agnostic, dispatch-driven action runtime for TypeScript.

```ts
import { createRuntime, defineAction, defineModule } from "@action-flow/core";

const math = defineModule("math", {
  double: defineAction({ handler: (input: number) => input * 2 }),
});

const runtime = createRuntime({ providers: {}, modules: [math] });
const result = await runtime.dispatch("math.double", 3); // number: 6
```

Define modules with `defineModule(namespace, actionsMap)`. The namespace and action types are preserved.

Includes typed static dispatch, modules, injected providers, a read-only action registry, and nested execution. Use `createActionFactory<Providers, Contract>()` with `ActionSignature<Input, Output>` entries for typed cross-module `ctx.dispatch`. Runtime assembly checks that each required target is registered with a compatible implementation. Contract-enabled module lists must be statically known; use `as const` when storing the list in a variable. Factories without a contract retain the dynamic `Promise<unknown>` boundary. Contracts are compile-time checks, not runtime schemas.

Execution context includes IDs, parent linkage and an AbortSignal. Enable structural tracing with `environment: "development"` or `trace: true`, then inspect `runtime.trace.list()`, `getTrace(traceId)` and lifecycle subscriptions. Tracing defaults off in the default production environment, and payload capture is opt-in. Retention is bounded and snapshots support redaction. Onion middleware can wrap, recover or short-circuit execution. Cancellation is cooperative and does not roll back side effects.

The separate `@action-flow/scenario` package provides typed scenarios, scoped provider overrides, result/error mocks and fixture cleanup. Core exposes `createDebugScope()` with isolated bindings, Middleware and Trace, plus `close()` to drain started descendants. Debug execution defaults off in production; `allowDebug` overrides the environment default. Scenario records and contexts include `scenarioId` and `scenarioRunId`. DevTools is planned.

See the [repository documentation](https://github.com/Josp3r/action-flow) for provider factories, development commands, and design boundaries. This package is ESM and has no runtime dependencies.

MIT
