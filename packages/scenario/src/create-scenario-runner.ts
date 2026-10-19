import { DebugDisabledError, UnknownActionError } from "@action-flow/core";
import type { ContextDispatch, DebugScope, ExecutionRecord, Runtime } from "@action-flow/core";
import type {
  ScenarioContext, ScenarioDefinition, ScenarioMock, ScenarioMocks, ScenarioRunner, ScenarioRunnerOptions,
} from "./types.js";

export function createScenarioRunner<Actions, Providers extends object>(
  runtime: Runtime<Actions, Providers>, options: ScenarioRunnerOptions = {},
): ScenarioRunner<Actions, Providers> {
  const definitions = new Map<string, ScenarioDefinition<Actions, Providers>>();
  const traceOptions = options.trace === undefined ? undefined : Object.freeze({ ...options.trace,
    ...(options.trace.capture === undefined ? {} : { capture: Object.freeze({ ...options.trace.capture }) }),
  });
  let sequence = 0;
  const prefix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  function snapshotMocks(mocks: ScenarioMocks<Actions>): ReadonlyMap<string, ScenarioMock<unknown>> {
    if (mocks === null || typeof mocks !== "object") throw new TypeError("Scenario mocks must be an object.");
    const entries = new Map<string, ScenarioMock<unknown>>();
    for (const [id, mock] of Object.entries(mocks)) {
      if (!runtime.registry.has(id)) throw new UnknownActionError(id);
      const candidate = mock as ScenarioMock<unknown> | undefined;
      if (!candidate || !((candidate.type === "return" && "value" in candidate) || (candidate.type === "throw" && "error" in candidate))) {
        throw new TypeError(`Invalid mock for "${id}". Expected a return value or thrown error.`);
      }
      entries.set(id, candidate.type === "return"
        ? Object.freeze({ type: "return", value: candidate.value })
        : Object.freeze({ type: "throw", error: candidate.error }));
    }
    return entries;
  }
  const runner: ScenarioRunner<Actions, Providers> = {
    defineScenario(definition) {
      if (typeof definition.id !== "string" || !definition.id.trim()) throw new TypeError("Scenario ID must be a non-empty string.");
      if (definitions.has(definition.id)) throw new Error(`Scenario "${definition.id}" is already registered.`);
      if (!runtime.registry.has(definition.action)) throw new UnknownActionError(definition.action);
      if (definition.inputFactory !== undefined && (typeof definition.inputFactory !== "function" || "input" in definition)) {
        throw new TypeError("Use either input or inputFactory for a Scenario.");
      }
      for (const hook of [definition.setup, definition.cleanup]) {
        if (hook !== undefined && typeof hook !== "function") throw new TypeError("Scenario lifecycle hooks must be functions.");
      }
      const mocks = definition.mocks === undefined || typeof definition.mocks === "function" ? definition.mocks
        : Object.freeze(Object.fromEntries(snapshotMocks(definition.mocks)));
      const providers = definition.providers === undefined || typeof definition.providers === "function" ? definition.providers
        : Object.freeze({ ...definition.providers });
      const snapshot = Object.freeze({ ...definition,
        ...(mocks === undefined ? {} : { mocks }), ...(providers === undefined ? {} : { providers }),
      }) as typeof definition;
      definitions.set(snapshot.id, snapshot);
      return snapshot;
    },
    list: () => Object.freeze([...definitions.values()]),
    get: (id) => definitions.get(id),
    async run(definition, runOptions = {}) {
      // Reject misuse before running factories or touching business fixtures.
      if (!runtime.debugEnabled) throw new DebugDisabledError();
      if (definitions.get(definition.id) !== definition) throw new Error("Scenario must be defined by this runner.");
      const scenarioId = definition.id;
      const runId = `af-scenario-${prefix}-${++sequence}`;
      const signal = runOptions.signal ?? new AbortController().signal;
      const releases: (() => void | Promise<void>)[] = [];
      const cleanupErrors: unknown[] = [];
      let cleaning = false;
      const context = (providers: Readonly<Providers>): ScenarioContext<Providers> => Object.freeze({
        providers, scenarioId, runId, signal,
        defer(cleanup: () => void | Promise<void>) {
          if (cleaning) throw new Error("Cannot register fixtures after Scenario cleanup has started.");
          if (typeof cleanup !== "function") throw new TypeError("Fixture cleanup must be a function.");
          releases.push(cleanup);
        },
      });
      let ctx = context(runtime.providers);
      let scope: DebugScope<Actions, Providers> | undefined;
      let unsubscribe: (() => void) | undefined;
      let root: ExecutionRecord | undefined;
      let setupEntered = false;
      let failed = false;
      let error: unknown;
      let output: unknown;
      const checkAbort = () => { if (signal.aborted) throw signal.reason; };
      try {
        checkAbort();
        const providers = typeof definition.providers === "function" ? await definition.providers(ctx) : definition.providers;
        checkAbort();
        let mocks: ReadonlyMap<string, ScenarioMock<unknown>> = new Map();
        scope = runtime.createDebugScope({
          ...(providers === undefined ? {} : { providers }),
          ...(traceOptions === undefined ? {} : { trace: traceOptions }),
          scenario: { id: scenarioId, runId },
          middleware: [async (call, next) => {
            const mock = mocks.get(call.actionId);
            if (mock === undefined) return await next();
            if (mock.type === "throw") throw mock.error;
            return mock.value;
          }],
        });
        ctx = context(scope.providers);
        const configured = typeof definition.mocks === "function" ? await definition.mocks(ctx) : definition.mocks;
        mocks = snapshotMocks(configured ?? {});
        checkAbort();
        setupEntered = true;
        await definition.setup?.(ctx);
        checkAbort();
        const input = definition.inputFactory === undefined ? definition.input : await definition.inputFactory(ctx);
        checkAbort();
        unsubscribe = scope.trace.subscribe((event) => {
          if (event.type === "start" && event.record.parentExecutionId === undefined) root ??= event.record;
        });
        // Definition validation preserves the ID/input relationship; execution erases only that internal union.
        const dispatch = scope.dispatch as unknown as ContextDispatch;
        output = await dispatch(definition.action, input, { signal });
      } catch (caught) {
        failed = true;
        error = caught;
      } finally {
        await scope?.close();
        unsubscribe?.();
        cleaning = true;
        if (setupEntered) {
          try { await definition.cleanup?.(ctx); } catch (caught) { cleanupErrors.push(caught); }
        }
        for (const release of releases.reverse()) {
          try { await release(); } catch (caught) { cleanupErrors.push(caught); }
        }
      }
      if (!failed && signal.aborted) { failed = true; error = signal.reason; }
      const result = {
        scenarioId, runId,
        ...(root === undefined ? {} : { executionId: root.executionId, traceId: root.traceId }),
        trace: scope?.trace.list() ?? Object.freeze([]),
        droppedRecords: scope?.trace.droppedRecords ?? 0,
        cleanupErrors: Object.freeze(cleanupErrors),
      };
      if (cleanupErrors.length > 0) {
        return Object.freeze({ ...result, status: "error" as const, error: failed
          ? new AggregateError([error, ...cleanupErrors], "Scenario execution and cleanup failed.", { cause: error })
          : new AggregateError(cleanupErrors, "Scenario cleanup failed."),
        });
      }
      if (failed) return Object.freeze({ ...result, status: signal.aborted ? "cancelled" as const : "error" as const, error });
      // The public generic keeps the selected Action's awaited output; mocks are checked against the same type.
      return Object.freeze({ ...result, status: "success" as const, output }) as Awaited<ReturnType<typeof runner.run>>;
    },
  };
  return Object.freeze(runner);
}
