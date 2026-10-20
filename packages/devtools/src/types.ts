import type { ActionRegistration, ExecutionRecord, ExecutionStatus, Runtime, TraceOptions } from "@action-flow/core";
import type { ScenarioRunner } from "@action-flow/scenario";

export interface DevToolsOptions<Actions, Providers extends object> {
  readonly runtime: Runtime<Actions, Providers>;
  readonly runner?: ScenarioRunner<NoInfer<Actions>, NoInfer<Providers>>;
  /** Maximum retained runs, including active runs. Defaults to 20. */
  readonly maxRuns?: number;
  /** Per-run retained executions. Defaults to 200. Scenario capture follows its Runner. */
  readonly trace?: TraceOptions;
}
export interface MountDevToolsOptions<Actions, Providers extends object> extends DevToolsOptions<Actions, Providers> {
  readonly target: HTMLElement;
  /** JSON text, keyed by registered Action ID. Empty text dispatches undefined. */
  readonly initialPayloads?: Readonly<Partial<Record<keyof Actions & string, string>>>;
}
export interface DevToolsScenario {
  readonly id: string;
  readonly action: string;
  readonly description?: string;
}
export interface DevToolsRun {
  readonly id: string;
  readonly actionId: string;
  readonly scenarioId?: string;
  readonly scenarioRunId?: string;
  readonly executionId?: string;
  readonly traceId?: string;
  readonly status: ExecutionStatus;
  readonly cancelRequested: boolean;
  readonly startTime: number;
  readonly duration?: number;
  /** Detached, bounded, redacted snapshots. Business objects are never retained here. */
  readonly output?: unknown;
  readonly error?: unknown;
  readonly cleanupErrors: readonly unknown[];
  readonly trace: readonly ExecutionRecord[];
  readonly droppedRecords: number;
}
export interface DevToolsController {
  readonly actions: readonly ActionRegistration[];
  scenarios(): readonly DevToolsScenario[];
  runs(): readonly DevToolsRun[];
  subscribe(listener: () => void): () => void;
  /** UI boundary: parses JSON, validates the registered ID, then calls a debug scope. */
  runAction(actionId: string, payload?: string): Promise<DevToolsRun>;
  runScenario(scenarioId: string): Promise<DevToolsRun>;
  cancel(runId: string): boolean;
  /** Removes completed runs, retaining executions that still own active resources. */
  clear(): void;
  /** Stops observation, requests cancellation, and drains all started work. */
  dispose(): Promise<void>;
}
export interface DevToolsHandle {
  readonly controller: DevToolsController;
  refresh(): void;
  unmount(): Promise<void>;
}
