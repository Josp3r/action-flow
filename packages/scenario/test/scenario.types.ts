import { expectTypeOf } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule } from "@action-flow/core";
import { createScenarioRunner } from "../src/index.js";
import type { ScenarioResult } from "../src/index.js";

interface Providers { prefix: string; state: { count: number } }
const action = createActionFactory<Providers>();
const runtime = createRuntime({ providers: { prefix: "base", state: { count: 0 } }, modules: [defineModule("test", {
  text: action.define({ handler: (input: string, ctx) => ctx.providers.prefix + input }),
  number: defineAction({ handler: (input: number) => input * 2 }),
  empty: defineAction({ handler: () => true }),
  optional: defineAction({ handler: (input: string | undefined) => input }),
  impossible: defineAction({ handler: (_: never) => 0 }),
  callback: defineAction({ handler: (input: () => string) => input() }),
})] });
const runner = createScenarioRunner(runtime);
function assertScenarioTypes() {
  const text = runner.defineScenario({ id: "text", action: "test.text", input: "hello", providers: { prefix: "override" }, mocks: {
    "test.text": { type: "return", value: "mock" }, "test.number": { type: "throw", error: undefined },
  }, setup(ctx) { expectTypeOf(ctx.providers.state.count).toEqualTypeOf<number>(); } });
  expectTypeOf(runner.run(text)).toEqualTypeOf<Promise<ScenarioResult<string>>>();
  const number = runner.defineScenario({ id: "number", action: "test.number", inputFactory: async (ctx) => ctx.providers.state.count });
  expectTypeOf(runner.run(number)).toEqualTypeOf<Promise<ScenarioResult<number>>>();
  runner.defineScenario({ id: "empty", action: "test.empty" });
  runner.defineScenario({ id: "optional", action: "test.optional", input: undefined });
  runner.defineScenario({ id: "callback", action: "test.callback", input: () => "literal function payload" });
  // @ts-expect-error ID is associated with its input
  runner.defineScenario({ id: "bad", action: "test.text", input: 1 });
  // @ts-expect-error input is required
  runner.defineScenario({ id: "bad", action: "test.text" });
  // @ts-expect-error unknown Action
  runner.defineScenario({ id: "bad", action: "test.missing", input: 1 });
  // @ts-expect-error optional undefined value still requires explicit input
  runner.defineScenario({ id: "bad", action: "test.optional" });
  // @ts-expect-error never cannot omit input
  runner.defineScenario({ id: "bad", action: "test.impossible" });
  // @ts-expect-error input and inputFactory are mutually exclusive
  runner.defineScenario({ id: "bad", action: "test.text", input: "text", inputFactory: () => "text" });
  // @ts-expect-error inputFactory must return the selected Action input
  runner.defineScenario({ id: "bad", action: "test.number", inputFactory: () => "text" });
  // @ts-expect-error provider override keeps service types
  runner.defineScenario({ id: "bad", action: "test.text", input: "", providers: { prefix: 1 } });
  // @ts-expect-error return mocks must match the target output
  runner.defineScenario({ id: "bad", action: "test.text", input: "", mocks: { "test.number": { type: "return", value: "text" } } });
  // @ts-expect-error unknown mock ID
  runner.defineScenario({ id: "bad", action: "test.text", input: "", mocks: { "test.missing": { type: "return", value: 1 } } });
  // @ts-expect-error async mock factories also preserve output types
  runner.defineScenario({ id: "bad", action: "test.text", input: "", mocks: async () => ({ "test.number": { type: "return", value: "text" } }) });
  const uncertain = "" as "test.text" | "test.number";
  // @ts-expect-error union ID with uncorrelated payload is unsafe
  runner.defineScenario({ id: "bad", action: uncertain, input: "text" });
  // @ts-expect-error run signal is typed
  runner.run(text, { signal: "bad" });
}
void assertScenarioTypes;
