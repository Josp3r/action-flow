import { snapshotTraceValue } from "./snapshot.js";
import type { ExecutionRecord, TraceEvent, TraceField, TraceListener, TraceOptions, TraceQuery, TraceStore } from "./types.js";

export function createTraceStore(configuration: boolean | TraceOptions) {
  const enabled = configuration !== false;
  const options = typeof configuration === "object" ? configuration : {};
  const maxRecords = options.maxRecords ?? 1_000;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new TypeError("Trace maxRecords must be a positive safe integer.");
  }
  const capture = Object.freeze({ ...options.capture });
  const redact = options.redact;
  const records = new Map<string, ExecutionRecord>();
  const listeners = new Set<TraceListener>();
  let dropped = 0;

  const addDetail = (record: ExecutionRecord, field: TraceField, value: unknown): ExecutionRecord => {
    if (!enabled || !capture[field]) return record;
    try {
      const snapshot = snapshotTraceValue(value);
      const transformed = redact === undefined ? snapshot : redact(snapshot, field, record);
      if (transformed instanceof Promise) {
        void transformed.catch(() => {});
        return record;
      }
      const detail = redact === undefined ? snapshot : snapshotTraceValue(transformed);
      return Object.freeze({ ...record, [field]: detail });
    } catch {
      // Diagnostic failure must neither expose the original value nor affect the Action.
      return record;
    }
  };

  const emit = (type: TraceEvent["type"], record: ExecutionRecord) => {
    const event: TraceEvent = Object.freeze({ type, record });
    for (const listener of [...listeners]) {
      try {
        const returned: unknown = listener(event);
        // Async functions can be assigned to void callbacks; handle their rejections too.
        if (returned !== null && (typeof returned === "object" || typeof returned === "function")) {
          void Promise.resolve(returned).catch(() => {});
        }
      } catch { /* Observers cannot change execution results. */ }
    }
  };

  const list = (query: TraceQuery = {}): readonly ExecutionRecord[] => Object.freeze([...records.values()].filter((record) =>
    (query.traceId === undefined || record.traceId === query.traceId)
    && (query.actionId === undefined || record.actionId === query.actionId)
    && (query.status === undefined || record.status === query.status)
    && (query.scenarioId === undefined || record.scenarioId === query.scenarioId)
    && (query.scenarioRunId === undefined || record.scenarioRunId === query.scenarioRunId)));

  const store: TraceStore = Object.freeze({
    enabled,
    get size() { return records.size; },
    get droppedRecords() { return dropped; },
    get: (executionId: string) => records.get(executionId),
    list,
    getTrace: (traceId: string) => list({ traceId }),
    subscribe(listener: TraceListener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    clear() { records.clear(); dropped = 0; },
  });

  return {
    store,
    start(initial: ExecutionRecord, input: unknown) {
      if (!enabled) return initial;
      const record = addDetail(initial, "input", input);
      records.set(record.executionId, record);
      while (records.size > maxRecords) {
        records.delete(records.keys().next().value!);
        dropped++;
      }
      emit("start", record);
      return record;
    },
    finish(record: ExecutionRecord, field: "output" | "error", value: unknown) {
      if (!enabled) return;
      const finalRecord = addDetail(record, field, value);
      // Finishing must not resurrect a record that was evicted or explicitly cleared.
      if (records.has(record.executionId)) records.set(record.executionId, finalRecord);
      emit("finish", finalRecord);
    },
  };
}
