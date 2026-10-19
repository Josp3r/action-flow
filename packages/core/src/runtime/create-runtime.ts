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

export interface Runtime<Actions> {
  readonly dispatch: Dispatch<Actions>;
  readonly registry: ActionRegistry;
  readonly trace: TraceStore;
  readonly environment: RuntimeEnvironment;
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
}): Runtime<RuntimeActions<Modules>> {
  const { registry, handlers } = buildRegistry(options.modules);
  // Snapshot bindings, retaining external API/store object identity.
  const providers = Object.freeze({ ...options.providers });
  const environment = options.environment ?? "production";
  if (!["development", "test", "production"].includes(environment)) {
    throw new TypeError("Runtime environment must be development, test or production.");
  }
  const trace = createTraceStore(options.trace ?? environment !== "production");
  const middleware = Object.freeze([...(options.middleware ?? [])]);
  let sequence = 0;
  const prefix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const id = (kind: string) => `af-${prefix}-${kind}-${++sequence}`;
  const monotonicTime = () => globalThis.performance?.now() ?? Date.now();

  const execute = async (
    actionId: string, input: unknown, dispatchOptions: DispatchOptions | undefined,
    parent?: ActionContext<Providers>,
  ): Promise<unknown> => {
    const executionId = id("execution");
    const traceId = parent?.traceId ?? id("trace");
    const linked = executionSignal(parent?.signal, dispatchOptions?.signal);
    const dispatch: ContextDispatch = (childId, childInput, childOptions) => execute(childId, childInput, childOptions, context);
    const context: ActionContext<Providers> = Object.freeze({
      providers, dispatch, actionId, executionId, traceId, signal: linked.signal,
      ...(parent === undefined ? {} : { parentExecutionId: parent.executionId }),
    });
    const start = monotonicTime();
    const record = trace.start(Object.freeze({
      executionId, traceId, actionId, status: "running", startTime: Date.now(),
      ...(parent === undefined ? {} : { parentExecutionId: parent.executionId }),
    }), input);
    const finish = (status: ExecutionRecord["status"], field: "output" | "error", value: unknown) => trace.finish(Object.freeze({
      ...record, status, endTime: Date.now(), duration: Math.max(0, monotonicTime() - start),
    }), field, value);
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
      const output = middleware.length === 0 ? await invokeHandler() : await runMiddleware(middleware, middlewareContext, invokeHandler);
      throwIfAborted(linked.signal);
      finish("success", "output", output);
      return output;
    } catch (error) {
      finish(linked.signal.aborted ? "cancelled" : "error", "error", error);
      throw error;
    } finally {
      linked.release();
    }
  };
  const dispatch: ContextDispatch = (actionId, input, dispatchOptions) => execute(actionId, input, dispatchOptions);

  return Object.freeze({
    dispatch: dispatch as unknown as Dispatch<RuntimeActions<Modules>>,
    registry,
    trace: trace.store,
    environment,
  });
}
