import { describe, expect, it, vi } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule } from "../src/index.js";
import type { ActionSignature } from "../src/index.js";

describe("cooperative cancellation", () => {
  it("rejects pre-aborted dispatch without entering the handler", async () => {
    const controller = new AbortController();
    const reason = new Error("Stopped before execution");
    controller.abort(reason);
    const handler = vi.fn(() => 1);
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("test", { run: defineAction({ handler }) })] });
    await expect(runtime.dispatch("test.run", undefined, { signal: controller.signal })).rejects.toBe(reason);
    expect(handler).not.toHaveBeenCalled();
    expect(runtime.trace.list()[0]!.status).toBe("cancelled");
  });

  it("propagates one signal through typed nested Dispatch and records both cancellations", async () => {
    interface Contract { "test.parent": ActionSignature<void, number>; "test.child": ActionSignature<void, number> }
    const action = createActionFactory<object, Contract>();
    const signals: AbortSignal[] = [];
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("test", {
      parent: action.define({ handler: (_: void, ctx) => { signals.push(ctx.signal); return ctx.dispatch("test.child"); } }),
      child: action.define({ handler: (_: void, ctx) => {
        signals.push(ctx.signal);
        return new Promise<number>((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }));
      } }),
    })] });
    const controller = new AbortController();
    const reason = new Error("Stop chain");
    const result = runtime.dispatch("test.parent", undefined, { signal: controller.signal });
    expect(signals).toEqual([controller.signal, controller.signal]);
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(runtime.trace.list().map((record) => record.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("does not complete uncooperative work until its Promise settles", async () => {
    let finish!: (value: number) => void;
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("test", {
      run: defineAction({ handler: () => new Promise<number>((resolve) => { finish = resolve; }) }),
    })] });
    const controller = new AbortController();
    const result = runtime.dispatch("test.run", undefined, { signal: controller.signal });
    controller.abort("stop");
    expect(runtime.trace.list()[0]!.status).toBe("running");
    finish(42);
    await expect(result).rejects.toBe("stop");
    expect(runtime.trace.list()[0]!.status).toBe("cancelled");
  });

  it.each(["parent", "child"] as const)("links explicit child signals to parent cancellation (%s aborts)", async (source) => {
    const parent = new AbortController();
    const child = new AbortController();
    const parentRemove = vi.spyOn(parent.signal, "removeEventListener");
    const childRemove = vi.spyOn(child.signal, "removeEventListener");
    let actualSignal!: AbortSignal;
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("test", {
      parent: defineAction({ handler: (_: void, ctx) => ctx.dispatch("test.child", undefined, { signal: child.signal }) }),
      child: defineAction({ handler: (_: void, ctx) => {
        actualSignal = ctx.signal;
        return new Promise<void>((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }));
      } }),
    })] });
    const result = runtime.dispatch("test.parent", undefined, { signal: parent.signal });
    expect(actualSignal).not.toBe(parent.signal);
    expect(actualSignal).not.toBe(child.signal);
    const reason = new Error("Linked stop");
    (source === "parent" ? parent : child).abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(actualSignal.reason).toBe(reason);
    expect(parentRemove).toHaveBeenCalledTimes(1);
    expect(childRemove).toHaveBeenCalledTimes(1);
    const records = runtime.trace.list();
    expect(records[1]!.status).toBe("cancelled");
    // A child-only cancellation propagates an error to the otherwise active parent.
    expect(records[0]!.status).toBe(source === "parent" ? "cancelled" : "error");
  });

  it("isolates cancellation between concurrent root executions", async () => {
    const finish = new Map<number, () => void>();
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("test", {
      run: defineAction({ handler: (input: number, ctx) => new Promise<number>((resolve, reject) => {
        finish.set(input, () => resolve(input));
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      }) }),
    })] });
    const controller = new AbortController();
    const first = runtime.dispatch("test.run", 1, { signal: controller.signal });
    const second = runtime.dispatch("test.run", 2);
    controller.abort("first only");
    await expect(first).rejects.toBe("first only");
    finish.get(2)!();
    await expect(second).resolves.toBe(2);
    expect(runtime.trace.list().map((record) => record.status)).toEqual(["cancelled", "success"]);
  });

  it("checks cancellation between middleware and handler entry", async () => {
    const controller = new AbortController();
    const handler = vi.fn(() => 1);
    const runtime = createRuntime({ providers: {}, trace: true, middleware: [(_, next) => {
      controller.abort("during middleware");
      return next();
    }], modules: [defineModule("test", { run: defineAction({ handler }) })] });
    await expect(runtime.dispatch("test.run", undefined, { signal: controller.signal })).rejects.toBe("during middleware");
    expect(handler).not.toHaveBeenCalled();
  });
});
