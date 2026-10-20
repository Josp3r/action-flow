import { createActionFactory, createRuntime, defineModule } from "@action-flow/core";
import { createScenarioRunner } from "@action-flow/scenario";
import { createDevToolsController, mountDevTools } from "../src/index.js";
const action = createActionFactory<{ prefix: string }>();
const module = defineModule("app", { echo: action.define({ handler: (input: string, ctx) => ctx.providers.prefix + input }) });
const runtime = createRuntime({ providers: { prefix: "base" }, modules: [module], environment: "development" });
function assertTypes(target: HTMLElement) {
  const runner = createScenarioRunner(runtime);
  mountDevTools({ target, runtime, runner, initialPayloads: { "app.echo": '"hello"' } });
  // @ts-expect-error payload presets retain registered Action IDs
  mountDevTools({ target, runtime, initialPayloads: { "app.missing": "{}" } });
  // @ts-expect-error editor presets are JSON text
  mountDevTools({ target, runtime, initialPayloads: { "app.echo": 1 } });
  // @ts-expect-error mounting requires an HTML element
  mountDevTools({ target: "#app", runtime });
  // @ts-expect-error trace capacity is numeric
  createDevToolsController({ runtime, trace: { maxRecords: "invalid" } });
  const incompatible = createRuntime({ providers: { prefix: "base", extra: 1 }, modules: [module], environment: "test" });
  // @ts-expect-error a Runner requiring extra providers cannot match this Runtime
  mountDevTools({ target, runtime, runner: createScenarioRunner(incompatible) });
}
void assertTypes;
