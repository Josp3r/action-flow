import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "action-flow-consumer-"));
function run(command, args, cwd = directory) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  for (const name of ["@action-flow/core", "@action-flow/scenario", "@action-flow/devtools"]) {
    run("pnpm", ["--filter", name, "pack", "--pack-destination", directory], root);
  }
  const archives = (await readdir(directory)).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 3) throw new Error("Expected Core, Scenario and DevTools archives.");
  await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--cache", join(directory, "cache"), ...archives.map((archive) => join(directory, archive))]);
  run(process.execPath, ["--input-type=module", "--eval", `
    import { createRuntime, defineAction, defineModule } from '@action-flow/core';
    import { createScenarioRunner } from '@action-flow/scenario';
    import { createDevToolsController, mountDevTools } from '@action-flow/devtools';
    if (typeof document !== 'undefined' || typeof mountDevTools !== 'function') throw new Error('DevTools must import without DOM globals');
    const runtime = createRuntime({ providers: {}, environment: 'test', trace: true, modules: [defineModule('consumer', {
      double: defineAction({ handler: (input) => input * 2 }),
      parent: defineAction({ handler: (input, ctx) => ctx.dispatch('consumer.double', input) }),
    })] });
    if (await runtime.dispatch('consumer.parent', 3) !== 6) throw new Error('Incorrect packaged result');
    const [parent, child] = runtime.trace.list();
    if (child.parentExecutionId !== parent.executionId || child.traceId !== parent.traceId || child.status !== 'success') {
      throw new Error('Incorrect packaged trace');
    }
    const controller = new AbortController();
    controller.abort('packaged cancellation');
    try {
      await runtime.dispatch('consumer.double', 3, { signal: controller.signal });
      throw new Error('Packaged cancellation was ignored');
    } catch (error) {
      if (error !== controller.signal.reason) throw error;
    }
    const runner = createScenarioRunner(runtime);
    let released = false;
    const scenario = runner.defineScenario({ id: 'packaged.mock', action: 'consumer.parent', input: 3,
      mocks: { 'consumer.double': { type: 'return', value: 42 } },
      setup(ctx) { ctx.defer(() => { released = true; }); },
    });
    const result = await runner.run(scenario);
    if (result.status !== 'success' || result.output !== 42 || result.trace.length !== 2 || !released) throw new Error('Packaged Scenario failed');
    if (result.trace.some(record => record.scenarioRunId !== result.runId)) throw new Error('Packaged Scenario trace tags failed');
    if (await runtime.dispatch('consumer.parent', 3) !== 6) throw new Error('Packaged mocks leaked');
    if (runner.runtime !== runtime) throw new Error('Packaged Runner identity failed');
    const tools = createDevToolsController({ runtime, runner });
    const [direct, mocked] = await Promise.all([tools.runAction('consumer.parent', '3'), tools.runScenario('packaged.mock')]);
    if (direct.output !== 6 || mocked.output !== 42 || direct.traceId === mocked.traceId) throw new Error('Packaged DevTools execution failed');
    if (mocked.trace.length !== 2 || !mocked.scenarioRunId) throw new Error('Packaged live Scenario observation failed');
    await tools.dispose();
    const disabled = createScenarioRunner(createRuntime({ providers: {}, modules: [defineModule('prod', { run: defineAction({ handler: () => 1 }) })] }));
    try {
      await disabled.run(disabled.defineScenario({ id: 'disabled', action: 'prod.run' }));
      throw new Error('Production scenarios enabled by default');
    } catch (error) { if (error.name !== 'DebugDisabledError') throw error; }
  `]);
  await writeFile(join(directory, "consumer.ts"), `
    import { createActionFactory, createRuntime, defineModule } from '@action-flow/core';
    import type { ActionSignature, ExecutionRecord, TraceEvent } from '@action-flow/core';
    import { createScenarioRunner } from '@action-flow/scenario';
    import type { ScenarioResult } from '@action-flow/scenario';
    import { createDevToolsController, mountDevTools } from '@action-flow/devtools';
    interface Contract {
      'consumer.double': ActionSignature<number, number>;
      'consumer.parent': ActionSignature<number, number>;
    }
    const action = createActionFactory<object, Contract>();
    const parent = action.define({ async handler(input: number, ctx) {
      const result: number = await ctx.dispatch('consumer.double', input);
      const signal: AbortSignal = ctx.signal;
      const executionId: string = ctx.executionId;
      // @ts-expect-error packaged Context Dispatch rejects incorrect input
      ctx.dispatch('consumer.double', 'incorrect');
      // @ts-expect-error packaged Context Dispatch rejects unknown IDs
      ctx.dispatch('missing.action', input);
      void signal; void executionId;
      return result + 1;
    } });
    const consumer = defineModule('consumer', {
      double: action.define({ handler: (input: number) => input * 2 }), parent,
    });
    const runtime = createRuntime({ providers: {}, modules: [consumer], trace: { maxRecords: 10 } });
    const result: Promise<number> = runtime.dispatch('consumer.double', 3);
    const controlled: Promise<number> = runtime.dispatch('consumer.parent', 3, { signal: new AbortController().signal });
    const records: readonly ExecutionRecord[] = runtime.trace.list();
    runtime.trace.subscribe((event: TraceEvent) => { void event.record.status; });
    // @ts-expect-error packaged declarations reject incorrect input
    runtime.dispatch('consumer.double', 'incorrect');
    // @ts-expect-error packaged declarations retain Action IDs
    runtime.dispatch('missing.action', 3);
    // @ts-expect-error packaged declarations reject missing nested implementations
    createRuntime({ providers: {}, modules: [defineModule('consumer', { parent })] });
    // @ts-expect-error packaged options preserve AbortSignal types
    runtime.dispatch('consumer.parent', 3, { signal: 'incorrect' });
    const runner = createScenarioRunner(runtime);
    const scenario = runner.defineScenario({ id: 'typed', action: 'consumer.parent', input: 3,
      mocks: { 'consumer.double': { type: 'return', value: 9 } },
    });
    const scenarioResult: Promise<ScenarioResult<number>> = runner.run(scenario);
    // @ts-expect-error Scenario input follows selected Action
    runner.defineScenario({ id: 'bad', action: 'consumer.parent', input: 'incorrect' });
    // @ts-expect-error Scenario mocks follow target output
    runner.defineScenario({ id: 'bad', action: 'consumer.parent', input: 3, mocks: { 'consumer.double': { type: 'return', value: 'incorrect' } } });
    // @ts-expect-error Scenario rejects unknown IDs
    runner.defineScenario({ id: 'bad', action: 'missing.action', input: 3 });
    void scenarioResult;
    const tools = createDevToolsController({ runtime, runner });
    const target = document.createElement('div');
    mountDevTools({ target, runtime, runner, initialPayloads: { 'consumer.parent': '3' } });
    // @ts-expect-error DevTools preset IDs retain registration types
    mountDevTools({ target, runtime, initialPayloads: { 'missing.action': '3' } });
    // @ts-expect-error DevTools payload editor expects JSON text
    mountDevTools({ target, runtime, initialPayloads: { 'consumer.parent': 3 } });
    void tools;
    void result; void controlled; void records;
  `);
  run(resolve(root, "node_modules/.bin/tsc"), ["--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--noEmit", "consumer.ts"]);
  const metadata = JSON.parse(await readFile(join(directory, "node_modules/@action-flow/core/package.json"), "utf8"));
  if (Object.keys(metadata.dependencies ?? {}).length !== 0) throw new Error("Core must have no runtime dependencies.");
  const scenarioMetadata = JSON.parse(await readFile(join(directory, "node_modules/@action-flow/scenario/package.json"), "utf8"));
  if (Object.keys(scenarioMetadata.dependencies).join() !== "@action-flow/core" || scenarioMetadata.dependencies["@action-flow/core"] !== metadata.version) throw new Error("Scenario must depend only on the released Core version.");
  const toolsMetadata = JSON.parse(await readFile(join(directory, "node_modules/@action-flow/devtools/package.json"), "utf8"));
  if (Object.keys(toolsMetadata.dependencies).sort().join() !== "@action-flow/core,@action-flow/scenario" || Object.values(toolsMetadata.dependencies).some((version) => version !== metadata.version)) throw new Error("DevTools must depend only on the released Core and Scenario versions.");
  for (const packageName of ["core", "scenario", "devtools"]) {
    for (const name of ["README.md", "LICENSE"]) await readFile(join(directory, `node_modules/@action-flow/${packageName}`, name));
  }
  console.log("Packaged consumers passed: Core + Scenario + DevTools ESM, DOM-free import, isolated executions, live traces, fixtures, production guard, exported types, negative type checks, dependencies, READMEs and licenses.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
