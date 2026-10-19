import { describe, expect, it, vi } from "vitest";
import { createActionFactory, createRuntime, DebugDisabledError, defineAction, defineModule, UnknownActionError } from "@action-flow/core";
import type { ActionContext, ContextDispatch } from "@action-flow/core";
import { createScenarioRunner } from "../src/index.js";
import type { ScenarioContext } from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
interface Providers { prefix: string; state: { count: number } }
const action = createActionFactory<Providers>();
function makeRuntime(options: { production?: boolean; allowDebug?: boolean; traceOff?: boolean } = {}) {
  const handler = vi.fn((input: string, ctx: ActionContext<Providers>) => `${ctx.providers.prefix}:${input}:${++ctx.providers.state.count}`);
  const events: string[] = [];
  const runtime = createRuntime({ providers: { prefix: "base", state: { count: 0 } },
    environment: options.production ? "production" : "test",
    ...(options.allowDebug === undefined ? {} : { allowDebug: options.allowDebug }),
    ...(options.traceOff ? { trace: false } : {}),
    middleware: [async (ctx, next) => { events.push(`before:${ctx.actionId}:${ctx.providers.prefix}`); const out = await next(); events.push(`after:${ctx.actionId}`); return out; }],
    modules: [defineModule("test", {
      child: action.define({ handler }),
      parent: action.define({ handler: (input: string, ctx) => ctx.dispatch("test.child", input) }),
      fail: defineAction({ handler: () => { throw undefined; } }),
      ping: defineAction({ handler: () => "pong" }),
    })],
  });
  return { runtime, handler, events, runner: createScenarioRunner(runtime) };
}

describe("Scenario execution", () => {
  it("isolates concurrent scenarios and ordinary Dispatch, including descendants and middleware", async () => {
    const { runner, runtime, events } = makeRuntime();
    const first = runner.defineScenario({ id: "one", action: "test.parent", input: "hello", providers: () => ({ prefix: "one", state: { count: 0 } }) });
    const second = runner.defineScenario({ id: "two", action: "test.parent", input: "hello", providers: { prefix: "two" }, mocks: { "test.child": { type: "return", value: "mock" } } });
    const [one, two, normal] = await Promise.all([runner.run(first), runner.run(second), runtime.dispatch("test.parent", "normal")]);
    expect(one).toMatchObject({ status: "success", output: "one:hello:1" });
    expect(two).toMatchObject({ status: "success", output: "mock" });
    expect(normal).toBe("base:normal:1");
    expect(events).toContain("before:test.child:two");
    for (const result of [one, two]) {
      expect(result.trace).toHaveLength(2);
      expect(result.trace.every((record) => record.scenarioId === result.scenarioId && record.scenarioRunId === result.runId)).toBe(true);
      expect(result.trace[1]!.parentExecutionId).toBe(result.executionId);
      expect(runtime.trace.list({ scenarioRunId: result.runId })).toEqual(result.trace);
    }
    expect(runtime.trace.list().filter((record) => record.scenarioId === undefined)).toHaveLength(2);
    expect(runtime.providers.prefix).toBe("base");
  });

  it("allocates fresh providers, inputs and mock values for repeated concurrent runs", async () => {
    const { runner, runtime, handler } = makeRuntime();
    const ids: string[] = [];
    const scenario = runner.defineScenario({ id: "fresh", action: "test.parent",
      providers: async (ctx) => { ids.push(ctx.runId); return { state: { count: 0 } }; },
      inputFactory: (ctx) => { expect(ctx.providers.state.count).toBe(10); return "fresh"; },
      setup: (ctx) => { ctx.providers.state.count = 10; },
      mocks: async (ctx) => ({ "test.child": { type: "return", value: `${ctx.runId}:${++ctx.providers.state.count}` } }),
    });
    const results = await Promise.all([runner.run(scenario), runner.run(scenario)]);
    expect(new Set(ids).size).toBe(2);
    results.forEach((result) => expect(result).toMatchObject({ status: "success", output: `${result.runId}:1` }));
    expect(handler).not.toHaveBeenCalled();
    expect(runtime.providers.state.count).toBe(0);
  });

  it("preserves thrown mock identity and records nested failure", async () => {
    const { runner, handler } = makeRuntime();
    const error = { code: "conflict" };
    const scenario = runner.defineScenario({ id: "conflict", action: "test.parent", input: "", mocks: { "test.child": { type: "throw", error } } });
    const result = await runner.run(scenario);
    expect(result).toMatchObject({ status: "error", error });
    if (result.status !== "success") expect(result.error).toBe(error);
    expect(result.trace.map((record) => record.status)).toEqual(["error", "error"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports an undefined mock return and an undefined thrown value", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      empty: defineAction({ handler: (): void => {} }),
    })] });
    const runner = createScenarioRunner(runtime);
    const returned = runner.defineScenario({ id: "undefined return", action: "test.empty", mocks: { "test.empty": { type: "return", value: undefined } } });
    expect(await runner.run(returned)).toMatchObject({ status: "success", output: undefined });
    const thrown = runner.defineScenario({ id: "undefined throw", action: "test.empty", mocks: { "test.empty": { type: "throw", error: undefined } } });
    expect(await runner.run(thrown)).toMatchObject({ status: "error", error: undefined });
  });

  it("creates fresh mutable mock outputs and inputs through factories", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      child: defineAction({ handler: () => ({ values: [] as string[] }) }),
      parent: defineAction({ async handler(input: { values: string[] }, ctx) {
        const child = await ctx.dispatch("test.child") as { values: string[] };
        child.values.push("child"); input.values.push("parent"); return { child, input };
      } }),
    })] });
    const runner = createScenarioRunner(runtime);
    const scenario = runner.defineScenario({ id: "mutable", action: "test.parent", inputFactory: () => ({ values: [] }),
      mocks: () => ({ "test.child": { type: "return", value: { values: [] } } }),
    });
    const [one, two] = await Promise.all([runner.run(scenario), runner.run(scenario)]);
    expect(one).toMatchObject({ output: { child: { values: ["child"] }, input: { values: ["parent"] } } });
    expect(two).toMatchObject({ output: { child: { values: ["child"] }, input: { values: ["parent"] } } });
    if (one.status !== "success" || two.status !== "success") throw new Error("expected success");
    expect(one.output.child).not.toBe(two.output.child);
    expect(one.output.input).not.toBe(two.output.input);
    expect(Object.isFrozen(one.output.child)).toBe(false);
  });

  it("collects local traces even when the Runtime trace is disabled", async () => {
    const { runner, runtime } = makeRuntime({ traceOff: true });
    const scenario = runner.defineScenario({ id: "local", action: "test.parent", input: "local" });
    const result = await runner.run(scenario);
    expect(result.trace).toHaveLength(2);
    expect(runtime.trace.size).toBe(0);
    expect(Object.isFrozen(result.trace)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("retains root identity when bounded local traces evict the root, with independent capture policies", async () => {
    const { runtime } = makeRuntime();
    const runner = createScenarioRunner(runtime, { trace: { maxRecords: 1, capture: { input: true, output: true } } });
    const scenario = runner.defineScenario({ id: "bounded", action: "test.parent", input: "value" });
    const result = await runner.run(scenario);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({ input: "value", parentExecutionId: result.executionId });
    expect(result.droppedRecords).toBe(1);
    expect(runtime.trace.list().every((record) => !("input" in record) && !("output" in record))).toBe(true);
  });

  it("snapshots registration bindings without freezing business objects", async () => {
    const { runner } = makeRuntime();
    const providers = { prefix: "initial" };
    const mocks = { "test.child": { type: "return" as const, value: "initial mock" } };
    const scenario = runner.defineScenario({ id: "stable", action: "test.parent", input: "", providers, mocks });
    providers.prefix = "mutated"; mocks["test.child"].value = "mutated";
    expect(await runner.run(scenario)).toMatchObject({ output: "initial mock" });
    expect(runner.get("stable")).toBe(scenario);
    expect(runner.list()).toEqual([scenario]);
    expect(Object.isFrozen(scenario)).toBe(true);
    expect(Object.isFrozen(providers)).toBe(false);
  });
});

describe("fixtures and cancellation", () => {
  it.each(["success", "error", "cancelled"] as const)("cleans fixtures on %s in LIFO order", async (status) => {
    const { runner } = makeRuntime();
    const controller = new AbortController();
    const order: string[] = [];
    const scenario = runner.defineScenario({ id: status, action: "test.ping",
      ...(status === "error" ? { mocks: { "test.ping": { type: "throw" as const, error: undefined } } } : {}),
      setup(ctx) { ctx.defer(() => { order.push("first"); }); ctx.defer(() => { order.push("second"); }); if (status === "cancelled") controller.abort("stop"); },
      cleanup() { order.push("definition"); },
    });
    expect(await runner.run(scenario, { signal: controller.signal })).toMatchObject({ status });
    expect(order).toEqual(["definition", "second", "first"]);
  });

  it("cleans partially initialized setup and preserves all failures, including undefined", async () => {
    const { runner } = makeRuntime();
    const setupError = new Error("partial setup");
    const cleanupError = new Error("cleanup");
    const order: number[] = [];
    const scenario = runner.defineScenario({ id: "partial", action: "test.ping",
      setup(ctx) { ctx.defer(() => { order.push(1); throw undefined; }); ctx.defer(async () => { order.push(2); throw cleanupError; }); throw setupError; },
      cleanup() { throw "definition cleanup"; },
    });
    const result = await runner.run(scenario);
    expect(result.status).toBe("error");
    if (result.status === "success") throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(AggregateError);
    expect((result.error as AggregateError).errors).toEqual([setupError, "definition cleanup", cleanupError, undefined]);
    expect((result.error as AggregateError).cause).toBe(setupError);
    expect(result.cleanupErrors).toEqual(["definition cleanup", cleanupError, undefined]);
    expect(order).toEqual([2, 1]);
    expect(result.trace).toHaveLength(0);
  });

  it("releases resources allocated by a provider factory that fails before setup", async () => {
    const { runner } = makeRuntime();
    const cleanup = vi.fn();
    const release = vi.fn();
    const scenario = runner.defineScenario({ id: "factory failure", action: "test.ping",
      providers(ctx) { ctx.defer(release); throw undefined; }, cleanup,
    });
    expect(await runner.run(scenario)).toMatchObject({ status: "error", error: undefined, trace: [] });
    expect(release).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("returns cleanup failures after successful execution and rejects late defer registrations", async () => {
    const { runner } = makeRuntime();
    let saved!: ScenarioContext<Providers>;
    const scenario = runner.defineScenario({ id: "cleanup failure", action: "test.ping",
      setup(ctx) { saved = ctx; }, cleanup(ctx) { ctx.defer(() => {}); },
    });
    const result = await runner.run(scenario);
    expect(result.status).toBe("error");
    expect(result.trace[0]!.status).toBe("success");
    expect(result.cleanupErrors).toHaveLength(1);
    expect(() => saved.defer(() => {})).toThrow("cleanup has started");
  });

  it("cleans fixtures if inputFactory fails after setup", async () => {
    const { runner } = makeRuntime();
    const cleanup = vi.fn(); const release = vi.fn();
    const scenario = runner.defineScenario({ id: "input failure", action: "test.parent",
      setup(ctx) { ctx.defer(release); }, inputFactory() { throw "input failed"; }, cleanup,
    });
    expect(await runner.run(scenario)).toMatchObject({ status: "error", error: "input failed", trace: [] });
    expect(cleanup).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });

  it("releases factory resources for invalid async mocks without entering setup", async () => {
    const { runner } = makeRuntime();
    const setup = vi.fn(); const cleanup = vi.fn(); const release = vi.fn();
    const scenario = runner.defineScenario({ id: "bad factory", action: "test.ping", providers(ctx) { ctx.defer(release); return {}; },
      // @ts-expect-error exercise dynamic JavaScript boundary
      mocks: async () => ({ "test.unknown": { type: "return", value: 0 } }), setup, cleanup,
    });
    const result = await runner.run(scenario);
    expect(result.status).toBe("error");
    if (result.status === "success") throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(UnknownActionError);
    expect(setup).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  });

  it("preserves cancellation together with cleanup failure in an AggregateError", async () => {
    const { runner } = makeRuntime(); const controller = new AbortController();
    const scenario = runner.defineScenario({ id: "cancel + cleanup", action: "test.ping",
      setup() { controller.abort("cancel reason"); }, cleanup() { throw "release failed"; },
    });
    const result = await runner.run(scenario, { signal: controller.signal });
    expect(result.status).toBe("error");
    if (result.status === "success") throw new Error("expected failure");
    expect((result.error as AggregateError).errors).toEqual(["cancel reason", "release failed"]);
  });

  it("keeps caught and detached child errors in trace while preserving root success", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      root: defineAction({ async handler(_: void, ctx) { await ctx.dispatch("test.fail").catch(() => {}); void ctx.dispatch("test.fail"); return 1; } }),
      fail: defineAction({ handler: () => { throw "child failure"; } }),
    })] });
    const runner = createScenarioRunner(runtime);
    const result = await runner.run(runner.defineScenario({ id: "detached errors", action: "test.root" }));
    expect(result).toMatchObject({ status: "success", output: 1 });
    expect(result.trace.map((record) => record.status)).toEqual(["success", "error", "error"]);
  });

  it("skips all lifecycle side effects for pre-aborted runs", async () => {
    const { runner, handler } = makeRuntime();
    const providers = vi.fn(() => ({})); const setup = vi.fn(); const cleanup = vi.fn();
    const controller = new AbortController(); controller.abort("before");
    const scenario = runner.defineScenario({ id: "preabort", action: "test.child", input: "", providers, setup, cleanup });
    expect(await runner.run(scenario, { signal: controller.signal })).toMatchObject({ status: "cancelled", error: "before", trace: [] });
    [providers, setup, cleanup, handler].forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it("waits for cooperative in-flight cancellation before fixture cleanup", async () => {
    const entered = deferred(); const controller = new AbortController(); const cleanup = vi.fn();
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      wait: defineAction({ handler: (_: void, ctx) => new Promise<void>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }); entered.resolve();
      }) }),
    })] });
    const runner = createScenarioRunner(runtime);
    const scenario = runner.defineScenario({ id: "cancel", action: "test.wait", cleanup });
    const pending = runner.run(scenario, { signal: controller.signal });
    await entered.promise; expect(cleanup).not.toHaveBeenCalled(); controller.abort("during");
    expect(await pending).toMatchObject({ status: "cancelled", error: "during" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("drains detached descendants and their later children before releasing fixtures", async () => {
    const entered = deferred(); const gate = deferred(); const order: string[] = [];
    let escaped!: ContextDispatch;
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      root: defineAction({ handler: (_: void, ctx) => { escaped = ctx.dispatch; void ctx.dispatch("test.detached"); return "root done"; } }),
      detached: defineAction({ async handler(_: void, ctx) { entered.resolve(); await gate.promise; return ctx.dispatch("test.leaf"); } }),
      leaf: defineAction({ handler: () => { order.push("leaf"); } }),
    })] });
    const runner = createScenarioRunner(runtime);
    const scenario = runner.defineScenario({ id: "drain", action: "test.root", cleanup() { order.push("cleanup"); } });
    const pending = runner.run(scenario);
    await entered.promise; await Promise.resolve(); expect(order).toEqual([]); gate.resolve();
    const result = await pending;
    expect(result.trace).toHaveLength(3);
    expect(order).toEqual(["leaf", "cleanup"]);
    await expect(escaped("test.leaf")).rejects.toThrow("closed");
  });
});

describe("Scenario registration and debug policy", () => {
  it("disables debug in production before executing any callbacks, while normal Dispatch works", async () => {
    const { runner, runtime } = makeRuntime({ production: true });
    const providers = vi.fn(() => ({})); const mocks = vi.fn(() => ({})); const setup = vi.fn(); const cleanup = vi.fn();
    const scenario = runner.defineScenario({ id: "disabled", action: "test.ping", providers, mocks, setup, cleanup });
    await expect(runner.run(scenario)).rejects.toBeInstanceOf(DebugDisabledError);
    expect(() => runtime.createDebugScope()).toThrow(DebugDisabledError);
    [providers, mocks, setup, cleanup].forEach((fn) => expect(fn).not.toHaveBeenCalled());
    await expect(runtime.dispatch("test.ping")).resolves.toBe("pong");
  });

  it("supports explicit production opt-in and test opt-out", async () => {
    const enabled = makeRuntime({ production: true, allowDebug: true });
    expect(await enabled.runner.run(enabled.runner.defineScenario({ id: "enabled", action: "test.ping" }))).toMatchObject({ status: "success" });
    const disabled = makeRuntime({ allowDebug: false });
    await expect(disabled.runner.run(disabled.runner.defineScenario({ id: "disabled", action: "test.ping" }))).rejects.toBeInstanceOf(DebugDisabledError);
  });

  it("rejects duplicate IDs and foreign definitions before lifecycle effects", async () => {
    const { runner } = makeRuntime();
    const setup = vi.fn();
    const scenario = runner.defineScenario({ id: "same", action: "test.ping", setup });
    expect(() => runner.defineScenario({ id: "same", action: "test.ping" })).toThrow("already registered");
    await expect(makeRuntime().runner.run(scenario)).rejects.toThrow("this runner");
    expect(setup).not.toHaveBeenCalled();
  });

  it("validates runtime IDs and malformed mock descriptors from JavaScript", async () => {
    const { runner } = makeRuntime();
    expect(() => runner.defineScenario({ id: "", action: "test.ping" })).toThrow("non-empty");
    // @ts-expect-error exercise JavaScript boundary
    expect(() => runner.defineScenario({ id: "unknown", action: "test.missing" })).toThrow(UnknownActionError);
    // @ts-expect-error exercise JavaScript boundary
    expect(() => runner.defineScenario({ id: "mock", action: "test.ping", mocks: { "test.missing": { type: "return", value: 1 } } })).toThrow(UnknownActionError);
    // @ts-expect-error exercise JavaScript boundary
    expect(() => runner.defineScenario({ id: "mock", action: "test.ping", mocks: { "test.ping": { type: "return" } } })).toThrow("Invalid mock");
    const scenario = runner.defineScenario({ id: "dynamic mock", action: "test.ping", mocks: () => ({ "test.ping": { type: "return", value: "dynamic" } }) });
    expect(await runner.run(scenario)).toMatchObject({ status: "success", output: "dynamic" });
  });
});
