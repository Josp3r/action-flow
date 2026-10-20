import { describe, expect, it, vi } from "vitest";
import { createActionFactory, createRuntime, DebugDisabledError, defineAction, defineModule } from "@action-flow/core";
import { createScenarioRunner } from "@action-flow/scenario";
import { createDevToolsController } from "../src/index.js";
import { buildTraceForest, formatValue } from "../src/format.js";
import type { ExecutionRecord } from "@action-flow/core";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const action = createActionFactory<{ prefix: string }>();
  const gate = deferred(); const entered = deferred();
  const handler = vi.fn((input: string, ctx: { providers: { prefix: string } }) => `${ctx.providers.prefix}:${input}`);
  const runtime = createRuntime({ providers: { prefix: "base" }, environment: "test", trace: false, modules: [defineModule("test", {
    parent: action.define({ handler: (input: string, ctx) => ctx.dispatch("test.child", input) }),
    child: action.define({ handler }),
    wait: defineAction({ async handler(_: void, ctx) {
      entered.resolve(); await gate.promise; ctx.signal.throwIfAborted(); return "finished";
    } }),
    abortable: defineAction({ handler: (_: void, ctx) => new Promise<void>((_, reject) => {
      ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }); entered.resolve();
    }) }),
    fail: defineAction({ handler: () => { throw undefined; } }),
  })] });
  const runner = createScenarioRunner(runtime);
  runner.defineScenario({ id: "mock", action: "test.parent", input: "scenario", providers: { prefix: "scoped" }, mocks: { "test.child": { type: "return", value: "mocked" } } });
  return { runtime, runner, handler, gate, entered };
}

describe("DevTools controller", () => {
  it("imports in Node without DOM globals and executes direct/scenario runs independently", async () => {
    expect(typeof document).toBe("undefined");
    const { runtime, runner, handler } = fixture();
    const controller = createDevToolsController({ runtime, runner });
    expect(controller.scenarios()).toEqual([{ id: "mock", action: "test.parent" }]);
    const [direct, scenario] = await Promise.all([controller.runAction("test.parent", '"hello"'), controller.runScenario("mock")]);
    expect(direct).toMatchObject({ status: "success", output: "base:hello" });
    expect(scenario).toMatchObject({ status: "success", output: "mocked", scenarioId: "mock" });
    expect(scenario.scenarioRunId).toBeDefined();
    expect(direct.trace).toHaveLength(2); expect(scenario.trace).toHaveLength(2);
    expect(direct.traceId).not.toBe(scenario.traceId);
    expect(scenario.trace.every((record) => record.scenarioRunId === scenario.scenarioRunId)).toBe(true);
    expect(handler).toHaveBeenCalledOnce(); expect(runtime.trace.size).toBe(0);
    expect(Object.isFrozen(controller.runs())).toBe(true);
    await controller.dispose();
  });

  it("rejects invalid JSON, unknown targets and oversized input before executing handlers", async () => {
    const { runtime, runner, handler } = fixture(); const controller = createDevToolsController({ runtime, runner });
    await expect(controller.runAction("test.child", "{")).rejects.toThrow("JSON");
    await expect(controller.runAction("missing")).rejects.toThrow("not registered");
    await expect(controller.runScenario("missing")).rejects.toThrow("not registered");
    await expect(controller.runAction("test.child", " ".repeat(100_001))).rejects.toThrow("100,000");
    expect(handler).not.toHaveBeenCalled(); expect(controller.runs()).toEqual([]);
  });

  it("preserves falsey/undefined results and errors without requiring JSON serialization of business values", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      echo: defineAction({ handler: (input: unknown) => input }),
      fail: defineAction({ handler: () => { throw undefined; } }),
    })] });
    const controller = createDevToolsController({ runtime });
    for (const [payload, output] of [["", undefined], ["null", null], ["false", false], ["0", 0]] as const) {
      expect(await controller.runAction("test.echo", payload)).toMatchObject({ status: "success", output });
    }
    expect(await controller.runAction("test.fail")).toMatchObject({ status: "error", error: undefined });
  });

  it("bounds traces without resurrecting evicted parents on finish and reports truncation", async () => {
    const { runtime, runner } = fixture();
    const controller = createDevToolsController({ runtime, runner, trace: { maxRecords: 1 } });
    for (const result of [await controller.runAction("test.parent", '"x"'), await controller.runScenario("mock")]) {
      expect(result.trace).toHaveLength(1); expect(result.droppedRecords).toBe(1);
      expect(result.trace[0]!.parentExecutionId).toBe(result.executionId);
      expect(buildTraceForest(result.trace)[0]!.missingParent).toBe(true);
    }
  });

  it("does not retain business references or execute getters/toJSON and redacts common secret keys", async () => {
    const getter = vi.fn(() => "should never run"); const toJSON = vi.fn();
    const output = Object.assign(Object.create(null) as Record<string, unknown>, { password: "secret", token: "secret", bigint: 1n, toJSON });
    Object.defineProperty(output, "accessor", { get: getter, enumerable: true }); output.self = output;
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", { run: defineAction({ handler: () => output }) })] });
    const controller = createDevToolsController({ runtime });
    const result = await controller.runAction("test.run");
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    expect(result.output === output).toBe(false);
    expect(result.output).toMatchObject({ password: "[REDACTED]", token: "[REDACTED]", bigint: "1n", accessor: "[Accessor]", self: "[Circular]" });
    expect(Object.isFrozen(result.output)).toBe(true); expect(Object.isFrozen(output)).toBe(false);
  });

  it("keeps active runs when clearing history and evicts completed runs first", async () => {
    const { runtime, gate, entered } = fixture(); const controller = createDevToolsController({ runtime, maxRuns: 2 });
    const waiting = controller.runAction("test.wait"); await entered.promise;
    const completed = await controller.runAction("test.child", '"1"');
    const next = await controller.runAction("test.child", '"2"');
    expect(controller.runs().map((run) => run.id)).toEqual(["run-1", next.id]);
    expect(controller.cancel(completed.id)).toBe(false);
    controller.clear(); expect(controller.runs()).toHaveLength(1);
    gate.resolve(); await waiting; controller.clear(); expect(controller.runs()).toHaveLength(0);
  });

  it("rejects new work at active capacity and waits for uncooperative work after cancellation", async () => {
    const { runtime, gate, entered } = fixture(); const controller = createDevToolsController({ runtime, maxRuns: 1 });
    const pending = controller.runAction("test.wait"); await entered.promise;
    await expect(controller.runAction("test.child", '"x"')).rejects.toThrow("上限");
    expect(controller.cancel("run-1")).toBe(true); expect(controller.cancel("run-1")).toBe(false);
    expect(controller.runs()[0]).toMatchObject({ status: "running", cancelRequested: true });
    gate.resolve(); expect(await pending).toMatchObject({ status: "cancelled" });
    expect(await controller.runAction("test.child", '"after"')).toMatchObject({ status: "success" });
  });

  it("streams Scenario traces during execution and isolates throwing/async observers", async () => {
    const { runtime, runner, entered, gate } = fixture(); runner.defineScenario({ id: "wait", action: "test.wait" });
    const controller = createDevToolsController({ runtime, runner });
    controller.subscribe(() => { throw new Error("observer failure"); });
    controller.subscribe(async () => { throw new Error("async observer failure"); });
    const pending = controller.runScenario("wait"); await entered.promise;
    expect(controller.runs()[0]!.trace[0]!.status).toBe("running");
    gate.resolve(); expect(await pending).toMatchObject({ status: "success" });
  });

  it("cancels while draining detached descendants even if the root already succeeded", async () => {
    const gate = deferred(); const entered = deferred();
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", {
      root: defineAction({ handler: (_: void, ctx) => { void ctx.dispatch("test.child"); return 1; } }),
      child: defineAction({ async handler(_: void, ctx) { entered.resolve(); await gate.promise; ctx.signal.throwIfAborted(); } }),
    })] });
    const controller = createDevToolsController({ runtime });
    const pending = controller.runAction("test.root"); await entered.promise;
    await vi.waitFor(() => expect(controller.runs()[0]!.trace[0]!.status).toBe("success"));
    expect(controller.runs()[0]!.status).toBe("running");
    controller.cancel("run-1"); gate.resolve();
    expect(await pending).toMatchObject({ status: "cancelled" });
  });

  it("disposes from a synchronous start observer without losing work, drains fixtures and stops observation", async () => {
    const { runtime, runner } = fixture(); const cleanup = vi.fn();
    runner.defineScenario({ id: "abortable", action: "test.abortable", cleanup });
    const controller = createDevToolsController({ runtime, runner });
    let disposal: Promise<void> | undefined; let notices = 0;
    controller.subscribe(() => {
      notices++;
      if (controller.runs()[0]?.trace.length) disposal = controller.dispose();
    });
    const result = await controller.runScenario("abortable");
    expect(result.status).toBe("cancelled"); await disposal;
    expect(cleanup).toHaveBeenCalledOnce(); expect(controller.dispose()).toBe(disposal);
    const before = notices; await runtime.dispatch("test.child", "normal"); expect(notices).toBe(before);
    await expect(controller.runAction("test.child", '"late"')).rejects.toThrow("disposed");
    expect(() => controller.subscribe(() => {})).toThrow("disposed");
  });

  it("shows setup and cleanup errors, including aggregate constituents", async () => {
    const { runtime, runner } = fixture();
    runner.defineScenario({ id: "setup", action: "test.child", input: "x", setup() { throw "setup failure"; } });
    runner.defineScenario({ id: "cleanup", action: "test.fail", cleanup() { throw new Error("release failure"); } });
    const controller = createDevToolsController({ runtime, runner });
    expect(await controller.runScenario("setup")).toMatchObject({ status: "error", error: "setup failure", trace: [] });
    const cleanup = await controller.runScenario("cleanup");
    expect(cleanup.cleanupErrors).toHaveLength(1);
    expect(formatValue(cleanup.error)).toContain("release failure");
    expect(formatValue(cleanup.error)).toContain('"errors"');
  });

  it("refuses production debug and a Runner associated with a different Runtime", () => {
    const { runtime } = fixture(); const foreign = fixture();
    expect(() => createDevToolsController({ runtime, runner: foreign.runner })).toThrow("belong");
    const production = createRuntime({ providers: {}, modules: [] });
    expect(() => createDevToolsController({ runtime: production })).toThrow(DebugDisabledError);
  });

  it.each([{ maxRuns: 0 }, { maxRuns: 101 }, { trace: { maxRecords: 0 } }, { trace: { maxRecords: 1_001 } }])("validates bounded retention options %o", (options) => {
    expect(() => createDevToolsController({ runtime: fixture().runtime, ...options })).toThrow("integer");
  });
});

describe("trace forest and display", () => {
  const record = (id: string, parent?: string, traceId = "trace"): ExecutionRecord => ({ executionId: id, actionId: id, traceId, startTime: 0, status: "success", ...(parent === undefined ? {} : { parentExecutionId: parent }) });
  it("reconstructs nested and concurrent trees, preserving record order", () => {
    const forest = buildTraceForest([record("a"), record("b", "a"), record("c", "a"), record("d")]);
    expect(forest.map((node) => node.record.executionId)).toEqual(["a", "d"]);
    expect(forest[0]!.children.map((node) => node.record.executionId)).toEqual(["b", "c"]);
  });
  it("renders orphaned, cross-trace and cyclic records without hiding or duplicating them", () => {
    const forest = buildTraceForest([record("orphan", "missing"), record("a", "b"), record("b", "a"), record("self", "self"), record("cross", "a", "other")]);
    expect(forest).toHaveLength(5); expect(forest.every((node) => node.missingParent)).toBe(true);
  });
});
