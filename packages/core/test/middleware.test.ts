import { describe, expect, it, vi } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule, MiddlewareNextError } from "../src/index.js";
import type { Middleware } from "../src/index.js";

describe("onion middleware", () => {
  it("wraps handlers in registration order and provides execution context", async () => {
    const order: string[] = [];
    const runtime = createRuntime({ providers: { label: "injected" }, trace: { capture: { output: true } }, middleware: [
      async (ctx, next) => {
        expect(ctx.providers.label).toBe("injected");
        expect(ctx.actionId).toBe("test.run");
        expect(ctx.input).toBe(2);
        expect(ctx.executionId).toEqual(expect.any(String));
        expect(Object.isFrozen(ctx)).toBe(true);
        order.push("outer:before");
        const result = await next();
        order.push("outer:after");
        return result;
      },
      async (_, next) => {
        order.push("inner:before");
        const result = await next();
        order.push("inner:after");
        return result;
      },
    ], modules: [defineModule("test", { run: defineAction({ handler: (input: number) => { order.push("handler"); return input * 2; } }) })] });
    await expect(runtime.dispatch("test.run", 2)).resolves.toBe(4);
    expect(order).toEqual(["outer:before", "inner:before", "handler", "inner:after", "outer:after"]);
    expect(runtime.trace.list()[0]).toMatchObject({ status: "success", output: 4 });
  });

  it("allows short-circuiting without invoking the handler", async () => {
    const handler = vi.fn(() => 1);
    const runtime = createRuntime({ providers: {}, trace: true, middleware: [() => 42], modules: [defineModule("test", { run: defineAction({ handler }) })] });
    await expect(runtime.dispatch("test.run")).resolves.toBe(42);
    expect(handler).not.toHaveBeenCalled();
    expect(runtime.trace.list()[0]!.status).toBe("success");
  });

  it("can recover a handler error and records the recovered result", async () => {
    const failure = new Error("Expected failure");
    const runtime = createRuntime({ providers: {}, trace: { capture: { output: true } }, middleware: [async (_, next) => {
      try { return await next(); } catch (error) { expect(error).toBe(failure); return "recovered"; }
    }], modules: [defineModule("test", { run: defineAction({ handler: (): string => { throw failure; } }) })] });
    await expect(runtime.dispatch("test.run")).resolves.toBe("recovered");
    expect(runtime.trace.list()[0]).toMatchObject({ status: "success", output: "recovered" });
  });

  it("runs middleware for nested Actions and preserves ancestry for dispatch from middleware", async () => {
    const visited: string[] = [];
    const action = createActionFactory<object>();
    const runtime = createRuntime({ providers: {}, trace: true, middleware: [async (ctx, next) => {
      visited.push(ctx.actionId);
      if (ctx.actionId === "test.parent") await ctx.dispatch("test.child", 2);
      return next();
    }], modules: [defineModule("test", {
      parent: action.define({ handler: () => 1 }),
      child: action.define({ handler: (input: number) => input * 2 }),
    })] });
    await expect(runtime.dispatch("test.parent")).resolves.toBe(1);
    expect(visited).toEqual(["test.parent", "test.child"]);
    const [parent, child] = runtime.trace.list();
    expect(child!.parentExecutionId).toBe(parent!.executionId);
    expect(child!.traceId).toBe(parent!.traceId);
  });

  it("rejects calling next twice and never invokes the handler twice", async () => {
    const handler = vi.fn(() => 1);
    const runtime = createRuntime({ providers: {}, trace: true, middleware: [async (_, next) => { await next(); return next(); }], modules: [defineModule("test", { run: defineAction({ handler }) })] });
    await expect(runtime.dispatch("test.run")).rejects.toBeInstanceOf(MiddlewareNextError);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(runtime.trace.list()[0]!.status).toBe("error");
  });

  it("rejects next invoked after the middleware has settled", async () => {
    let late!: () => Promise<unknown>;
    const handler = vi.fn(() => 1);
    const runtime = createRuntime({ providers: {}, middleware: [(_, next) => { late = next; return 42; }], modules: [defineModule("test", { run: defineAction({ handler }) })] });
    await expect(runtime.dispatch("test.run")).resolves.toBe(42);
    await expect(late()).rejects.toBeInstanceOf(MiddlewareNextError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("drains unawaited downstream work before reporting the middleware protocol error", async () => {
    let finish!: () => void;
    const runtime = createRuntime({ providers: {}, trace: true, middleware: [(_, next) => { void next(); return 42; }], modules: [defineModule("test", {
      run: defineAction({ handler: () => new Promise<void>((resolve) => { finish = resolve; }) }),
    })] });
    const result = runtime.dispatch("test.run");
    expect(runtime.trace.list()[0]!.status).toBe("running");
    finish();
    await expect(result).rejects.toBeInstanceOf(MiddlewareNextError);
    expect(runtime.trace.list()[0]!.status).toBe("error");
  });

  it("snapshots the middleware array and preserves original middleware failures", async () => {
    const failure = new Error("Middleware failed");
    const middleware: Middleware[] = [() => { throw failure; }];
    const handler = vi.fn(() => 1);
    const runtime = createRuntime({ providers: {}, trace: true, middleware, modules: [defineModule("test", { run: defineAction({ handler }) })] });
    middleware.splice(0);
    await expect(runtime.dispatch("test.run")).rejects.toBe(failure);
    expect(handler).not.toHaveBeenCalled();
  });
});
