import type { Middleware } from "../dispatch/middleware.js";
import type { Dispatch } from "../dispatch/types.js";
import type { TraceOptions, TraceStore } from "../trace/types.js";

export interface DebugScopeOptions<Providers extends object> {
  readonly providers?: Partial<Providers>;
  readonly middleware?: readonly Middleware<Providers>[];
  readonly trace?: boolean | TraceOptions;
  readonly scenario?: { readonly id: string; readonly runId: string };
}

export interface DebugScope<Actions, Providers extends object> {
  readonly providers: Readonly<Providers>;
  readonly dispatch: Dispatch<Actions>;
  readonly trace: TraceStore;
  /** Rejects new root calls, drains started descendants, and prevents late escaped calls. */
  close(): Promise<void>;
}

export class DebugDisabledError extends Error {
  constructor() {
    super("Debug execution is disabled. Enable allowDebug explicitly or use a development/test Runtime.");
    this.name = "DebugDisabledError";
  }
}

export class DebugScopeClosedError extends Error {
  constructor() {
    super("This debug execution scope has been closed.");
    this.name = "DebugScopeClosedError";
  }
}
