import { describe, expect, it, vi } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule, UnknownActionError } from "../src/index.js";
import type { ActionSignature, ContextDispatch, ExecutionRecord, TraceEvent } from "../src/index.js";

const pingModule = defineModule("test", { ping: defineAction({ handler: () => "pong" }) });

describe("execution traces", () => {
  it("defaults to production without tracing, while execution metadata stays available", async () => {
    let metadata: { executionId: string; traceId: string; actionId: string } | undefined;
    const runtime = createRuntime({ providers: {}, modules: [defineModule("app", {
      run: defineAction({ handler: (_: void, ctx) => { metadata = ctx; return 1; } }),
    })] });
    const listener = vi.fn();
    runtime.trace.subscribe(listener);
    await expect(runtime.dispatch("app.run")).resolves.toBe(1);
    expect(runtime.environment).toBe("production");
    expect(runtime.trace.enabled).toBe(false);
    expect(runtime.trace.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(metadata).toMatchObject({ actionId: "app.run", executionId: expect.any(String), traceId: expect.any(String) });
  });

  it.each(["development", "test"] as const)("enables structural traces in %s", async (environment) => {
    const runtime = createRuntime({ providers: {}, modules: [pingModule], environment });
    await runtime.dispatch("test.ping");
    const record = runtime.trace.list()[0]!;
    expect(record).toMatchObject({ actionId: "test.ping", status: "success", startTime: expect.any(Number), endTime: expect.any(Number), duration: expect.any(Number) });
    expect(record.duration).toBeGreaterThanOrEqual(0);
    expect(record).not.toHaveProperty("input");
    expect(record).not.toHaveProperty("output");
    expect(record).not.toHaveProperty("error");
    expect(record).not.toHaveProperty("parentExecutionId");
    const disabled = createRuntime({ providers: {}, modules: [pingModule], environment, trace: false });
    await disabled.dispatch("test.ping");
    expect(disabled.trace.size).toBe(0);
  });

  it("preserves the real call tree across concurrent roots and reverse-finishing children", async () => {
    interface Contract {
      "job.parent": ActionSignature<number, number[]>;
      "job.child": ActionSignature<number, number>;
    }
    const action = createActionFactory<object, Contract>();
    const finish = new Map<number, () => void>();
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("job", {
      parent: action.define({ handler: (input: number, ctx) => Promise.all([
        ctx.dispatch("job.child", input), ctx.dispatch("job.child", input + 1),
      ]) }),
      child: action.define({ async handler(input: number) {
        await new Promise<void>((resolve) => finish.set(input, resolve));
        return input;
      } }),
    })] });
    const first = runtime.dispatch("job.parent", 1);
    const second = runtime.dispatch("job.parent", 10);
    const running = runtime.trace.list();
    expect(running).toHaveLength(6);
    expect(running.every((record) => record.status === "running")).toBe(true);
    const roots = running.filter((record) => record.parentExecutionId === undefined);
    expect(roots).toHaveLength(2);
    expect(roots[0]!.traceId).not.toBe(roots[1]!.traceId);
    for (const root of roots) {
      const tree = runtime.trace.getTrace(root.traceId);
      expect(tree).toHaveLength(3);
      expect(tree.slice(1).every((record) => record.parentExecutionId === root.executionId)).toBe(true);
    }
    for (const input of [11, 2, 10, 1]) finish.get(input)!();
    await expect(first).resolves.toEqual([1, 2]);
    await expect(second).resolves.toEqual([10, 11]);
    expect(runtime.trace.list({ status: "success" })).toHaveLength(6);
    expect(runtime.trace.list({ actionId: "job.child" })).toHaveLength(4);
    expect(new Set(running.map((record) => record.executionId)).size).toBe(6);
    expect(running.every((record) => record.status === "running")).toBe(true);
    expect(Object.isFrozen(runtime.trace.list())).toBe(true);
    expect(runtime.trace.list().every(Object.isFrozen)).toBe(true);
  });

  it("records unknown Action attempts and both sides of an uncaught nested failure", async () => {
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("test", {
      parent: defineAction({ handler: (_: void, ctx) => ctx.dispatch("missing.child") }),
    })] });
    await expect(runtime.dispatch("test.parent")).rejects.toBeInstanceOf(UnknownActionError);
    const records = runtime.trace.list();
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.status === "error")).toBe(true);
    expect(records[1]!.parentExecutionId).toBe(records[0]!.executionId);
    expect(records[1]!.traceId).toBe(records[0]!.traceId);
    expect(records.every((record) => !("error" in record))).toBe(true);
    const dispatch = runtime.dispatch as ContextDispatch;
    await expect(dispatch("missing.root")).rejects.toBeInstanceOf(UnknownActionError);
    expect(runtime.trace.list()).toHaveLength(3);
  });

  it("bounds retention and does not resurrect evicted active records", async () => {
    const finish: Array<() => void> = [];
    const runtime = createRuntime({ providers: {}, trace: { maxRecords: 2 }, modules: [defineModule("job", {
      run: defineAction({ handler: () => new Promise<void>((resolve) => finish.push(resolve)) }),
    })] });
    const events: TraceEvent[] = [];
    runtime.trace.subscribe((event) => events.push(event));
    const jobs = [runtime.dispatch("job.run"), runtime.dispatch("job.run"), runtime.dispatch("job.run")];
    const firstId = events[0]!.record.executionId;
    expect(runtime.trace.size).toBe(2);
    expect(runtime.trace.droppedRecords).toBe(1);
    expect(runtime.trace.get(firstId)).toBeUndefined();
    finish.forEach((resolve) => resolve());
    await Promise.all(jobs);
    expect(runtime.trace.get(firstId)).toBeUndefined();
    expect(events.filter((event) => event.type === "finish")).toHaveLength(3);
    expect(runtime.trace.list().every((record) => record.status === "success")).toBe(true);
  });

  it("clear removes retained records without cancelling work or restoring them on completion", async () => {
    let finish!: () => void;
    const runtime = createRuntime({ providers: {}, trace: true, modules: [defineModule("job", {
      run: defineAction({ handler: () => new Promise<void>((resolve) => { finish = resolve; }) }),
    })] });
    const listener = vi.fn();
    runtime.trace.subscribe(listener);
    const job = runtime.dispatch("job.run");
    runtime.trace.clear();
    finish();
    await job;
    expect(runtime.trace.size).toBe(0);
    expect(runtime.trace.droppedRecords).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("isolates throwing and rejecting listeners and supports unsubscribe", async () => {
    const runtime = createRuntime({ providers: {}, modules: [pingModule], trace: true });
    const received: TraceEvent[] = [];
    runtime.trace.subscribe(() => { throw new Error("Observer failed"); });
    runtime.trace.subscribe(async () => { throw new Error("Async observer failed"); });
    const unsubscribe = runtime.trace.subscribe((event) => received.push(event));
    await expect(runtime.dispatch("test.ping")).resolves.toBe("pong");
    expect(received.map((event) => event.type)).toEqual(["start", "finish"]);
    expect(received[0]!.record.status).toBe("running");
    expect(received[1]!.record.status).toBe("success");
    expect(received.every(Object.isFrozen)).toBe(true);
    unsubscribe();
    unsubscribe();
    await runtime.dispatch("test.ping");
    expect(received).toHaveLength(2);
  });

  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid trace capacity: %s", (maxRecords) => {
    expect(() => createRuntime({ providers: {}, modules: [], trace: { maxRecords } })).toThrow(TypeError);
  });
});

describe("Trace detail capture", () => {
  it("detaches and freezes captured data, redacts secret keys and leaves business objects unchanged", async () => {
    const input = { name: "before", password: "sensitive", nested: { accessToken: "secret" } };
    const output = { value: "original", apiKey: "hidden" };
    const capture = { input: true, output: true };
    const runtime = createRuntime({ providers: {}, trace: { capture }, modules: [defineModule("test", {
      run: defineAction({ handler: (value: typeof input) => { value.name = "after"; return output; } }),
    })] });
    capture.input = false;
    const result = await runtime.dispatch("test.run", input);
    expect(result).toBe(output);
    output.value = "mutated";
    const record = runtime.trace.list()[0]!;
    expect(record.input).toEqual({ name: "before", password: "[REDACTED]", nested: { accessToken: "[REDACTED]" } });
    expect(record.output).toEqual({ value: "original", apiKey: "[REDACTED]" });
    expect(input.password).toBe("sensitive");
    expect(output.apiKey).toBe("hidden");
    expect(Object.isFrozen(record.input)).toBe(true);
    expect(Object.isFrozen(record.output)).toBe(true);
  });

  it("does not invoke getters or toJSON and tolerates cyclic and hostile values", async () => {
    const getter = vi.fn(() => { throw new Error("Getter should not run"); });
    const value: Record<string, unknown> = { toJSON: getter };
    Object.defineProperty(value, "computed", { enumerable: true, get: getter });
    value.self = value;
    value.list = Array.from({ length: 150 }, (_, index) => index);
    value.hostile = new Proxy({}, { ownKeys() { throw new Error("Cannot inspect"); } });
    const runtime = createRuntime({ providers: {}, trace: { capture: { input: true } }, modules: [defineModule("test", {
      run: defineAction({ handler: (_: unknown) => 1 }),
    })] });
    await expect(runtime.dispatch("test.run", value)).resolves.toBe(1);
    const captured = runtime.trace.list()[0]!.input as Record<string, unknown>;
    expect(getter).not.toHaveBeenCalled();
    expect(captured).toMatchObject({ toJSON: "[function]", computed: "[Accessor]", self: "[Circular]", hostile: "[Unserializable]" });
    expect(captured.list).toHaveLength(101);
  });

  it("applies custom redaction to detached, already redacted values", async () => {
    const runtime = createRuntime({ providers: {}, trace: {
      capture: { input: true, output: true },
      redact(value, field, record) {
        expect(record.actionId).toBe("test.run");
        if (field === "input") {
          expect(value).toEqual({ password: "[REDACTED]", email: "private@example.test" });
          return { summary: "redacted input" };
        }
        return { summary: "redacted output" };
      },
    }, modules: [defineModule("test", { run: defineAction({ handler: (_: unknown) => "result" }) })] });
    await runtime.dispatch("test.run", { password: "secret", email: "private@example.test" });
    expect(runtime.trace.list()[0]).toMatchObject({ input: { summary: "redacted input" }, output: { summary: "redacted output" } });
  });

  it.each([false, true])("omits details when a redactor fails (async: %s)", async (asynchronous) => {
    const runtime = createRuntime({ providers: {}, trace: {
      capture: { input: true, output: true },
      redact: asynchronous ? async () => { throw new Error("Redactor failed"); } : () => { throw new Error("Redactor failed"); },
    }, modules: [pingModule] });
    await expect(runtime.dispatch("test.ping")).resolves.toBe("pong");
    expect(runtime.trace.list()[0]).not.toHaveProperty("input");
    expect(runtime.trace.list()[0]).not.toHaveProperty("output");
  });

  it("captures errors without changing the original rejection value", async () => {
    const failure = new TypeError("Expected failure");
    Object.defineProperty(failure, "stack", { enumerable: true, value: "sensitive stack details" });
    const runtime = createRuntime({ providers: {}, trace: { capture: { error: true } }, modules: [defineModule("test", {
      run: defineAction({ handler: () => { throw failure; } }),
    })] });
    await expect(runtime.dispatch("test.run")).rejects.toBe(failure);
    const record: ExecutionRecord = runtime.trace.list()[0]!;
    expect(record.error).toEqual({ name: "TypeError", message: "Expected failure" });
    expect(record.error).not.toBe(failure);
  });
});
