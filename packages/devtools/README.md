# @action-flow/devtools

An explicitly mounted browser panel for ActionFlow. Lists and searches registered Actions, edits JSON inputs, runs Actions or Scenarios, and displays results, history and live nested traces with cancellation.

```ts
import { mountDevTools } from "@action-flow/devtools";

// runtime is a development/test Runtime; runner is optional and belongs to it.
const tools = mountDevTools({
  target: document.getElementById("devtools")!, runtime, runner,
  initialPayloads: { "session.start": '{"name":"Ada"}' },
});
// On teardown: remove the panel, request cancellation, and drain started work.
await tools.unmount();
```

Import it only from your application's development entry. Importing the package does not read DOM globals, mount a panel, register globals or modify the Runtime. Core and Scenario never import DevTools. Production mounting/execution is disabled by the Runtime's default debug policy; `allowDebug` is explicit opt-in, not authentication for a remote interface.

The UI uses native DOM elements in an isolated Shadow DOM and has no UI framework dependency. Each run gets its own scope and bounded trace. Scenario events come from its per-run `onTrace` observer. Runtime Middleware and base Providers are preserved; direct Action execution can still affect real injected services. Scenario definitions keep their configured input and fixture lifecycle. JSON parsing validates syntax only; business input validation remains in the Handler/application.

Defaults: 20 retained runs (maximum 100), 200 retained records per run (maximum 1,000), and 100,000 input characters. Completed runs are evicted first; new runs reject if active runs fill capacity. Clear keeps active work. Truncated traces show a notice and promote orphaned children to visible roots. Up to 40 nested tree levels are rendered; inspect the retained trace through the controller for deeper chains.

Results/errors are detached bounded snapshots using Core's `snapshotTraceValue`: common sensitive keys are redacted, getters/toJSON are not called, stacks are excluded, and AggregateError constituents remain inspectable. No raw business result references are retained. Trace payload capture defaults off for direct runs and follows the supplied Runner for Scenarios; the UI does not silently enable it. `trace.capture` and `trace.redact` configure direct-run trace details, while the result view uses the standard snapshot policy. Data is displayed as text and is not persisted or sent over the network.

For a custom frontend, `createDevToolsController({ runtime, runner?, maxRuns?, trace? })` exposes `actions`, `scenarios()`, `runs()`, `subscribe()`, `runAction(id, jsonText?)`, `runScenario(id)`, `cancel(id)`, `clear()` and `dispose()`. Its dynamic Action IDs are checked against the Registry before execution. Subscribe receives changes to immutable snapshots; observer errors cannot affect work. Dispose stops observation and requests cooperative cancellation, then waits for all started work. Uncooperative tasks can delay disposal.

ESM only. Runtime dependencies: Core and Scenario, with no UI framework. This is an unpublished 0.0.0 development package.
