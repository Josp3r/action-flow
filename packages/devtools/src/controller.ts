import { DebugDisabledError, snapshotTraceValue, UnknownActionError } from "@action-flow/core";
import type { ContextDispatch, ExecutionRecord, TraceEvent } from "@action-flow/core";
import type { DevToolsController, DevToolsOptions, DevToolsRun } from "./types.js";

interface Entry {
  value: DevToolsRun;
  readonly abort: AbortController;
  readonly records: Map<string, ExecutionRecord>;
  done?: Promise<DevToolsRun>;
}

export function createDevToolsController<Actions, Providers extends object>(options: DevToolsOptions<Actions, Providers>): DevToolsController {
  const { runtime, runner } = options;
  if (!runtime.debugEnabled) throw new DebugDisabledError();
  if (runner !== undefined && runner.runtime !== runtime) throw new TypeError("DevTools Runner must belong to the selected Runtime.");
  const maxRuns = options.maxRuns ?? 20;
  const maxRecords = options.trace?.maxRecords ?? 200;
  for (const [name, value, limit] of [["maxRuns", maxRuns, 100], ["maxRecords", maxRecords, 1_000]] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > limit) throw new TypeError(`${name} must be an integer between 1 and ${limit}.`);
  }
  const traceOptions = Object.freeze({ ...options.trace, maxRecords,
    ...(options.trace?.capture === undefined ? {} : { capture: Object.freeze({ ...options.trace.capture }) }),
  });
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const assertOpen = () => { if (disposed) throw new Error("DevTools has been disposed."); };
  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) {
      try { void Promise.resolve(listener()).catch(() => {}); } catch { /* Diagnostic observers cannot change work. */ }
    }
  };
  const update = (entry: Entry, patch: Partial<DevToolsRun>) => {
    entry.value = Object.freeze({ ...entry.value, ...patch });
    emit();
  };
  const observe = (entry: Entry, event: TraceEvent) => {
    const { record } = event;
    let droppedRecords = entry.value.droppedRecords;
    if (event.type === "start") {
      entry.records.set(record.executionId, record);
      while (entry.records.size > maxRecords) { entry.records.delete(entry.records.keys().next().value!); droppedRecords++; }
    } else if (entry.records.has(record.executionId)) entry.records.set(record.executionId, record);
    update(entry, {
      trace: Object.freeze([...entry.records.values()]), droppedRecords,
      ...(record.parentExecutionId === undefined ? { executionId: record.executionId, traceId: record.traceId } : {}),
      ...(record.scenarioRunId === undefined ? {} : { scenarioRunId: record.scenarioRunId }),
    });
  };
  const start = (actionId: string, scenarioId?: string): Entry => {
    assertOpen();
    while (entries.size >= maxRuns) {
      const oldest = [...entries].find(([, entry]) => entry.value.status !== "running");
      if (!oldest) throw new Error("运行数量已达上限，请等待或取消正在执行的任务。");
      entries.delete(oldest[0]);
    }
    const entry: Entry = { abort: new AbortController(), records: new Map(), value: Object.freeze({
      id: `run-${++sequence}`, actionId, ...(scenarioId === undefined ? {} : { scenarioId }), status: "running",
      cancelRequested: false, startTime: Date.now(), trace: Object.freeze([]), droppedRecords: 0, cleanupErrors: Object.freeze([]),
    }) };
    entries.set(entry.value.id, entry);
    // Work is scheduled and registered before observers can cancel/dispose this controller.
    return entry;
  };
  const finish = (entry: Entry, patch: Partial<DevToolsRun>) => {
    update(entry, { ...patch, duration: Math.max(0, Date.now() - entry.value.startTime) });
    return entry.value;
  };
  const controller: DevToolsController = {
    actions: runtime.registry.list(),
    scenarios: () => Object.freeze((runner?.list() ?? []).map(({ id, action, description }) => Object.freeze({
      id, action, ...(description === undefined ? {} : { description }),
    }))),
    runs: () => Object.freeze([...entries.values()].map((entry) => entry.value)),
    subscribe(listener) { assertOpen(); listeners.add(listener); return () => { listeners.delete(listener); }; },
    async runAction(actionId, payload = "") {
      assertOpen();
      if (!runtime.registry.has(actionId)) throw new UnknownActionError(actionId);
      if (payload.length > 100_000) throw new Error("输入过长，请限制在 100,000 个字符以内。");
      let input: unknown;
      try { input = payload.trim() ? JSON.parse(payload) : undefined; } catch { throw new Error("JSON 格式不正确，请修正后重试。"); }
      const entry = start(actionId);
      entry.done = Promise.resolve().then(async () => {
        const scope = runtime.createDebugScope({ trace: traceOptions });
        const unsubscribe = scope.trace.subscribe((event) => observe(entry, event));
        let failed = false; let error: unknown; let output: unknown;
        try { output = await (scope.dispatch as unknown as ContextDispatch)(actionId, input, { signal: entry.abort.signal }); }
        catch (caught) { failed = true; error = caught; }
        finally { await scope.close(); unsubscribe(); }
        if (!failed && entry.abort.signal.aborted) { failed = true; error = entry.abort.signal.reason; }
        return finish(entry, failed
          ? { status: entry.abort.signal.aborted ? "cancelled" : "error", error: snapshotTraceValue(error) }
          : { status: "success", output: snapshotTraceValue(output) });
      });
      emit();
      return entry.done;
    },
    async runScenario(scenarioId) {
      assertOpen();
      const scenario = runner?.get(scenarioId);
      if (!runner || !scenario) throw new Error(`Scenario "${scenarioId}" is not registered.`);
      const entry = start(scenario.action, scenarioId);
      entry.done = Promise.resolve().then(async () => {
        try {
          const result = await runner.run(scenario, { signal: entry.abort.signal, onTrace: (event) => observe(entry, event) });
          return finish(entry, {
            status: result.status, scenarioRunId: result.runId,
            cleanupErrors: Object.freeze(result.cleanupErrors.map((error) => snapshotTraceValue(error))),
            ...(result.status === "success" ? { output: snapshotTraceValue(result.output) } : { error: snapshotTraceValue(result.error) }),
          });
        } catch (error) { return finish(entry, { status: "error", error: snapshotTraceValue(error) }); }
      });
      emit();
      return entry.done;
    },
    cancel(runId) {
      const entry = entries.get(runId);
      if (!entry || entry.value.status !== "running" || entry.abort.signal.aborted) return false;
      entry.abort.abort(new Error("Cancelled from DevTools"));
      update(entry, { cancelRequested: true });
      return true;
    },
    clear() {
      assertOpen();
      for (const [id, entry] of entries) if (entry.value.status !== "running") entries.delete(id);
      emit();
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      listeners.clear();
      disposal = Promise.allSettled([...entries.values()].flatMap((entry) => entry.done === undefined ? [] : [entry.done])).then(() => {});
      for (const entry of entries.values()) if (entry.value.status === "running") controller.cancel(entry.value.id);
      return disposal;
    },
  };
  return Object.freeze(controller);
}
