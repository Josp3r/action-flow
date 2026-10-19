import type { ActionContext, ContextDispatch } from "../action/types.js";
import type { ValidateContracts } from "../contract/validation.js";
import type { Dispatch, RequiredProviders, RuntimeActions } from "../dispatch/types.js";
import { runMiddleware } from "../dispatch/middleware.js";
import type { Middleware, MiddlewareContext } from "../dispatch/middleware.js";
import type { DispatchOptions, RuntimeEnvironment } from "../dispatch/options.js";
import { executionSignal, throwIfAborted } from "../dispatch/signals.js";
import type { AnyModule } from "../module/define-module.js";
import { buildRegistry, UnknownActionError } from "../registry/action-registry.js";
import type { ActionRegistry } from "../registry/action-registry.js";
import { createTraceStore } from "../trace/store.js";
import type { ExecutionRecord, TraceOptions, TraceStore } from "../trace/types.js";
import { DebugDisabledError, DebugScopeClosedError } from "./debug-scope.js";
import type { DebugScope, DebugScopeOptions } from "./debug-scope.js";

export interface Runtime<Actions, Providers extends object = object> {
  readonly dispatch: Dispatch<Actions>;
  readonly registry: ActionRegistry;
  readonly trace: TraceStore;
  readonly environment: RuntimeEnvironment;
  readonly providers: Readonly<Providers>;
  readonly debugEnabled: boolean;
  createDebugScope(options?: DebugScopeOptions<Providers>): DebugScope<Actions, Providers>;
}

interface ScopeState<Providers extends object> {
  readonly providers: Providers;
  readonly middleware: readonly Middleware<Providers>[];
  readonly trace: ReturnType<typeof createTraceStore>;
  readonly scenario: DebugScopeOptions<Providers>["scenario"];
  readonly pending: Set<Promise<unknown>>;
  readonly active: Set<string>;
  closed: boolean;
  closing?: Promise<void>;
}

export function createRuntime<
  const Modules extends readonly AnyModule[],
  Providers extends object & RequiredProviders<Modules>,
>(options: {
  readonly providers: Providers;
  readonly modules: Modules & NoInfer<ValidateContracts<Modules>>;
  readonly environment?: RuntimeEnvironment;
  readonly trace?: boolean | TraceOptions;
  readonly middleware?: readonly Middleware<NoInfer<Providers>>[];
  readonly allowDebug?: boolean;
}): Runtime<RuntimeActions<Modules>, Providers> {
  const { registry, handlers } = buildRegistry(options.modules);
  // Snapshot bindings, retaining external API/store object identity.
  const providers = Object.freeze({ ...options.providers });
  const environment = options.environment ?? "production";
  if (!["development", "test", "production"].includes(environment)) {
    throw new TypeError("Runtime environment must be development, test or production.");
  }
  const trace = createTraceStore(options.trace ?? environment !== "production");
  const debugEnabled = options.allowDebug ?? environment !== "production";
  const middleware = Object.freeze([...(options.middleware ?? [])]);
  let sequence = 0;
  const prefix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const id = (kind: string) => `af-${prefix}-${kind}-${++sequence}`;
  const monotonicTime = () => globalThis.performance?.now() ?? Date.now();

  const execute = async (
    actionId: string, input: unknown, dispatchOptions: DispatchOptions | undefined,
    parent?: ActionContext<Providers>,
    scope?: ScopeState<Providers>,
  ): Promise<unknown> => {
    const executionId = id("execution");
    const traceId = parent?.traceId ?? id("trace");
    const linked = executionSignal(parent?.signal, dispatchOptions?.signal);
    const dispatch: ContextDispatch = (childId, childInput, childOptions) => scope === undefined
      ? execute(childId, childInput, childOptions, context)
      : scopedExecute(scope, childId, childInput, childOptions, context);
    const scenario = scope?.scenario === undefined ? {} : { scenarioId: scope.scenario.id, scenarioRunId: scope.scenario.runId };
    const context: ActionContext<Providers> = Object.freeze({
      providers: scope?.providers ?? providers, dispatch, actionId, executionId, traceId, signal: linked.signal, ...scenario,
      ...(parent === undefined ? {} : { parentExecutionId: parent.executionId }),
    });
    const start = monotonicTime();
    scope?.active.add(executionId);
    const initial: ExecutionRecord = Object.freeze({
      executionId, traceId, actionId, status: "running", startTime: Date.now(), ...scenario,
      ...(parent === undefined ? {} : { parentExecutionId: parent.executionId }),
    });
    const sinks = scope === undefined ? [trace] : [trace, scope.trace];
    const started = sinks.map((sink) => sink.start(initial, input));
    const finish = (status: ExecutionRecord["status"], field: "output" | "error", value: unknown) => {
      const endTime = Date.now();
      const duration = Math.max(0, monotonicTime() - start);
      sinks.forEach((sink, index) => sink.finish(Object.freeze({ ...started[index]!, status, endTime, duration }), field, value));
    };
    try {
      throwIfAborted(linked.signal);
      const handler = handlers.get(actionId);
      if (!handler) throw new UnknownActionError(actionId);
      const invokeHandler = async () => {
        throwIfAborted(linked.signal);
        // Registry signatures are erased; public dispatch and Contracts check the call boundary.
        const invoke = handler as (input: unknown, ctx: ActionContext<Providers>) => unknown;
        return await invoke(input, context);
      };
      const middlewareContext: MiddlewareContext<Providers> = Object.freeze({ ...context, input });
      const stack = scope?.middleware ?? middleware;
      const output = stack.length === 0 ? await invokeHandler() : await runMiddleware(stack, middlewareContext, invokeHandler);
      throwIfAborted(linked.signal);
      finish("success", "output", output);
      return output;
    } catch (error) {
      finish(linked.signal.aborted ? "cancelled" : "error", "error", error);
      throw error;
    } finally {
      linked.release();
      scope?.active.delete(executionId);
    }
  };
  const scopedExecute = (
    scope: ScopeState<Providers>, actionId: string, input: unknown,
    dispatchOptions: DispatchOptions | undefined, parent?: ActionContext<Providers>,
  ): Promise<unknown> => {
    if (scope.closed && (parent === undefined || !scope.active.has(parent.executionId))) {
      const rejected = Promise.reject(new DebugScopeClosedError());
      void rejected.catch(() => {});
      return rejected;
    }
    // Register before starting: even a synchronous trace observer can safely close the scope.
    const pending = Promise.resolve().then(() => execute(actionId, input, dispatchOptions, parent, scope));
    scope.pending.add(pending);
    void pending.then(() => scope.pending.delete(pending), () => scope.pending.delete(pending));
    return pending;
  };
  const dispatch: ContextDispatch = (actionId, input, dispatchOptions) => execute(actionId, input, dispatchOptions);

  return Object.freeze({
    dispatch: dispatch as unknown as Dispatch<RuntimeActions<Modules>>,
    registry,
    trace: trace.store,
    environment,
    providers,
    debugEnabled,
    createDebugScope(scopeOptions: DebugScopeOptions<Providers> = {}) {
      if (!debugEnabled) throw new DebugDisabledError();
      const scenario = scopeOptions.scenario;
      if (scenario !== undefined && (typeof scenario.id !== "string" || !scenario.id.trim() || typeof scenario.runId !== "string" || !scenario.runId.trim())) {
        throw new TypeError("Scenario scope identifiers must be non-empty strings.");
      }
      const scope: ScopeState<Providers> = {
        providers: Object.freeze({ ...providers, ...scopeOptions.providers }),
        middleware: Object.freeze([...middleware, ...(scopeOptions.middleware ?? [])]),
        trace: createTraceStore(scopeOptions.trace ?? true),
        scenario: scenario === undefined ? undefined : Object.freeze({ ...scenario }),
        pending: new Set(), active: new Set(), closed: false,
      };
      return Object.freeze({
        providers: scope.providers,
        dispatch: ((actionId: string, input?: unknown, dispatchOptions?: DispatchOptions) => scopedExecute(scope, actionId, input, dispatchOptions)) as unknown as Dispatch<RuntimeActions<Modules>>,
        trace: scope.trace.store,
        close() {
          scope.closed = true;
          scope.closing ??= (async () => {
            while (scope.pending.size > 0) await Promise.allSettled([...scope.pending]);
          })();
          return scope.closing;
        },
      });
    },
  });
}
