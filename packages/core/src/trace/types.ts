export type ExecutionStatus = "running" | "success" | "error" | "cancelled";

export interface ExecutionRecord {
  readonly executionId: string;
  readonly traceId: string;
  readonly parentExecutionId?: string;
  readonly actionId: string;
  readonly status: ExecutionStatus;
  /** Unix milliseconds, suitable for display alongside other application events. */
  readonly startTime: number;
  readonly endTime?: number;
  /** Elapsed milliseconds measured with a monotonic clock when available. */
  readonly duration?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
}

export type TraceField = "input" | "output" | "error";

export interface TraceOptions {
  /** Defaults to 1,000. Oldest records are evicted, including active ones. */
  readonly maxRecords?: number;
  /** Payloads are not collected unless explicitly enabled. */
  readonly capture?: Readonly<Partial<Record<TraceField, boolean>>>;
  /** Receives a detached snapshot with common sensitive keys already removed. */
  readonly redact?: (value: unknown, field: TraceField, record: ExecutionRecord) => unknown;
}

export interface TraceEvent {
  readonly type: "start" | "finish";
  readonly record: ExecutionRecord;
}

export interface TraceQuery {
  readonly traceId?: string;
  readonly actionId?: string;
  readonly status?: ExecutionStatus;
}

export type TraceListener = (event: TraceEvent) => void;

export interface TraceStore {
  readonly enabled: boolean;
  readonly size: number;
  /** Number evicted by capacity since creation or the most recent clear(). */
  readonly droppedRecords: number;
  get(executionId: string): ExecutionRecord | undefined;
  list(query?: TraceQuery): readonly ExecutionRecord[];
  getTrace(traceId: string): readonly ExecutionRecord[];
  subscribe(listener: TraceListener): () => void;
  /** Clears retained records, without cancelling executions or removing listeners. */
  clear(): void;
}
