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
  run("pnpm", ["--filter", "@action-flow/core", "pack", "--pack-destination", directory], root);
  const archive = (await readdir(directory)).find((name) => name.endsWith(".tgz"));
  if (!archive) throw new Error("No package archive was produced.");
  await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--cache", join(directory, "cache"), join(directory, archive)]);
  run(process.execPath, ["--input-type=module", "--eval", `
    import { createRuntime, defineAction, defineModule } from '@action-flow/core';
    const runtime = createRuntime({ providers: {}, modules: [defineModule('consumer', {
      double: defineAction({ handler: (input) => input * 2 }),
    })] });
    if (await runtime.dispatch('consumer.double', 3) !== 6) throw new Error('Incorrect packaged result');
  `]);
  await writeFile(join(directory, "consumer.ts"), `
    import { createActionFactory, createRuntime, defineModule } from '@action-flow/core';
    import type { ActionSignature } from '@action-flow/core';
    interface Contract {
      'consumer.double': ActionSignature<number, number>;
      'consumer.parent': ActionSignature<number, number>;
    }
    const action = createActionFactory<object, Contract>();
    const parent = action.define({ async handler(input: number, ctx) {
      const result: number = await ctx.dispatch('consumer.double', input);
      // @ts-expect-error packaged Context Dispatch rejects incorrect input
      ctx.dispatch('consumer.double', 'incorrect');
      // @ts-expect-error packaged Context Dispatch rejects unknown IDs
      ctx.dispatch('missing.action', input);
      return result + 1;
    } });
    const consumer = defineModule('consumer', {
      double: action.define({ handler: (input: number) => input * 2 }), parent,
    });
    const runtime = createRuntime({ providers: {}, modules: [consumer] });
    const result: Promise<number> = runtime.dispatch('consumer.double', 3);
    // @ts-expect-error packaged declarations reject incorrect input
    runtime.dispatch('consumer.double', 'incorrect');
    // @ts-expect-error packaged declarations retain Action IDs
    runtime.dispatch('missing.action', 3);
    // @ts-expect-error packaged declarations reject missing nested implementations
    createRuntime({ providers: {}, modules: [defineModule('consumer', { parent })] });
    void result;
  `);
  run(resolve(root, "node_modules/.bin/tsc"), ["--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--noEmit", "consumer.ts"]);
  const metadata = JSON.parse(await readFile(join(directory, "node_modules/@action-flow/core/package.json"), "utf8"));
  if (Object.keys(metadata.dependencies ?? {}).length !== 0) throw new Error("Core must have no runtime dependencies.");
  for (const name of ["README.md", "LICENSE"]) await readFile(join(directory, "node_modules/@action-flow/core", name));
  console.log("Packaged consumer passed: ESM execution, exported types, negative type checks, zero dependencies, README and license.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
