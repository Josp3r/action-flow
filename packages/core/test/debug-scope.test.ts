import { describe, expect, it } from "vitest";
import { createActionFactory, createRuntime, DebugScopeClosedError, defineAction, defineModule } from "../src/index.js";

describe("debug scopes", () => {
  it("combines local middleware with Runtime middleware and snapshots overrides", async () => {
    const action = createActionFactory<{ prefix: string }>();
    const order: string[] = [];
    const runtime = createRuntime({ providers: { prefix: "base" }, environment: "test", middleware: [async (_, next) => {
      order.push("runtime before"); const output = await next(); order.push("runtime after"); return output;
    }], modules: [defineModule("test", { run: action.define({ handler: (_: void, ctx) => ctx.providers.prefix }) })] });
    const overrides = { prefix: "scoped" };
    const scope = runtime.createDebugScope({ providers: overrides, middleware: [async (_, next) => {
      order.push("scope before"); const output = await next(); order.push("scope after"); return output;
    }] });
    overrides.prefix = "mutated";
    expect(await scope.dispatch("test.run")).toBe("scoped");
    expect(order).toEqual(["runtime before", "scope before", "scope after", "runtime after"]);
    await scope.close();
    expect(await runtime.dispatch("test.run")).toBe("base");
  });

  it("drains calls already queued before close and rejects new roots immediately", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", { run: defineAction({ handler: () => 1 }) })] });
    const scope = runtime.createDebugScope();
    const pending = scope.dispatch("test.run");
    const closing = scope.close();
    expect(scope.close()).toBe(closing);
    await expect(scope.dispatch("test.run")).rejects.toBeInstanceOf(DebugScopeClosedError);
    expect(await pending).toBe(1);
    await closing;
    expect(scope.trace.list()[0]!.status).toBe("success");
  });

  it("keeps local and global capture policies independent in both directions", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", trace: { capture: { input: true, output: true } }, modules: [defineModule("test", {
      run: defineAction({ handler: (input: { password: string; name: string }) => input }),
    })] });
    const scope = runtime.createDebugScope();
    const input = { password: "secret", name: "Ada" };
    expect(await scope.dispatch("test.run", input)).toBe(input);
    await scope.close();
    expect(runtime.trace.list()[0]!.input).toEqual({ password: "[REDACTED]", name: "Ada" });
    expect(scope.trace.list()[0]).not.toHaveProperty("input");
    expect(scope.trace.list()[0]).not.toHaveProperty("output");
  });

  it("accepts close from synchronous trace observers without losing queued execution", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", { run: defineAction({ handler: () => 1 }) })] });
    const scope = runtime.createDebugScope();
    let closing: Promise<void> | undefined;
    scope.trace.subscribe((event) => { if (event.type === "start") closing = scope.close(); });
    expect(await scope.dispatch("test.run")).toBe(1);
    await closing;
    expect(scope.trace.list()[0]!.status).toBe("success");
  });

  it("validates scenario identifiers and supports disabling local traces", async () => {
    const runtime = createRuntime({ providers: {}, environment: "test", modules: [defineModule("test", { run: defineAction({ handler: () => 1 }) })] });
    expect(() => runtime.createDebugScope({ scenario: { id: "", runId: "run" } })).toThrow("non-empty");
    const scope = runtime.createDebugScope({ trace: false });
    await scope.dispatch("test.run"); await scope.close();
    expect(scope.trace.size).toBe(0);
    expect(runtime.trace.size).toBe(1);
  });
});
