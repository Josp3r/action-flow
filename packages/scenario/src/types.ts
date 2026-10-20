import type { ActionInput, ActionOutput, ExecutionRecord, Runtime, TraceListener, TraceOptions } from "@action-flow/core";

type Action = { readonly handler: (...args: never[]) => unknown };
export type ScenarioActionId<Actions> = keyof Actions & string;
type Input<Actions, Id extends ScenarioActionId<Actions>> = ActionInput<Extract<Actions[Id], Action>>;
type Output<Actions, Id extends ScenarioActionId<Actions>> = ActionOutput<Extract<Actions[Id], Action>>;

export interface ScenarioContext<Providers extends object> {
  readonly providers: Readonly<Providers>;
  readonly scenarioId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  /** Register a release immediately after allocating a fixture; releases run in reverse order. */
  defer(cleanup: () => void | Promise<void>): void;
}

export type ScenarioMock<Output> =
  | { readonly type: "return"; readonly value: Output }
  | { readonly type: "throw"; readonly error: unknown };
export type ScenarioMocks<Actions> = {
  readonly [Id in ScenarioActionId<Actions>]?: ScenarioMock<Output<Actions, Id>>;
};
type PerRun<Value, Providers extends object> = Value | ((context: ScenarioContext<Providers>) => Value | Promise<Value>);
type ScenarioInput<Value, Providers extends object> =
  | ([Value] extends [never] ? { readonly input: Value; readonly inputFactory?: never }
    : [Value] extends [void] ? { readonly input?: Value; readonly inputFactory?: never } : { readonly input: Value; readonly inputFactory?: never })
  | { readonly input?: never; readonly inputFactory: (context: ScenarioContext<Providers>) => Value | Promise<Value> };

export type ScenarioDefinition<Actions, Providers extends object, Id extends ScenarioActionId<Actions> = ScenarioActionId<Actions>> =
  Id extends ScenarioActionId<Actions> ? {
    readonly id: string;
    readonly action: Id;
    readonly description?: string;
    readonly providers?: PerRun<Partial<Providers>, Providers>;
    readonly mocks?: PerRun<ScenarioMocks<Actions>, Providers>;
    readonly setup?: (context: ScenarioContext<Providers>) => void | Promise<void>;
    readonly cleanup?: (context: ScenarioContext<Providers>) => void | Promise<void>;
  } & ScenarioInput<Input<Actions, Id>, Providers> : never;

interface ScenarioResultBase {
  readonly scenarioId: string;
  readonly runId: string;
  /** Absent when execution did not reach Dispatch (for example, setup failed). */
  readonly executionId?: string;
  readonly traceId?: string;
  readonly trace: readonly ExecutionRecord[];
  readonly droppedRecords: number;
  readonly cleanupErrors: readonly unknown[];
}
export type ScenarioResult<Output> = ScenarioResultBase & (
  | { readonly status: "success"; readonly output: Output }
  | { readonly status: "error" | "cancelled"; readonly error: unknown }
);
export interface ScenarioRunnerOptions { readonly trace?: TraceOptions }
export interface ScenarioRunOptions {
  readonly signal?: AbortSignal;
  /** Live events from this run only; observer errors never change its outcome. */
  readonly onTrace?: TraceListener;
}

export interface ScenarioRunner<Actions, Providers extends object> {
  readonly runtime: Runtime<Actions, Providers>;
  defineScenario<const Id extends ScenarioActionId<Actions>>(
    definition: ScenarioDefinition<Actions, Providers, Id>,
  ): ScenarioDefinition<Actions, Providers, Id>;
  list(): readonly ScenarioDefinition<Actions, Providers>[];
  get(id: string): ScenarioDefinition<Actions, Providers> | undefined;
  run<Id extends ScenarioActionId<Actions>>(
    definition: ScenarioDefinition<Actions, Providers, Id>, options?: ScenarioRunOptions,
  ): Promise<ScenarioResult<Output<Actions, Id>>>;
}
