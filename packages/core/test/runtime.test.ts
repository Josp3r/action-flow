import { describe, expect, it, vi } from "vitest";
import {
  createActionFactory, createRuntime, defineAction, defineModule,
  DuplicateActionError, UnknownActionError,
} from "../src/index.js";
import type { ActionContext, ContextDispatch } from "../src/index.js";

describe("action runtime", () => {
  it("executes sync and async handlers and awaits their results", async () => {
    const runtime = createRuntime({
      providers: {},
      modules: [defineModule("math", {
        double: defineAction({ handler: (input: number) => input * 2 }),
        increment: defineAction({ handler: async (input: number) => input + 1 }),
        ping: defineAction({ handler: () => "pong" as const }),
      })],
    });
    await expect(runtime.dispatch("math.double", 3)).resolves.toBe(6);
    await expect(runtime.dispatch("math.increment", 3)).resolves.toBe(4);
    await expect(runtime.dispatch("math.ping")).resolves.toBe("pong");
  });

  it("injects external dependencies and composes across modules", async () => {
    const api = { login: vi.fn(async (name: string) => ({ name })) };
    const events: string[] = [];
    const action = createActionFactory<{ api: typeof api; events: string[] }>();
    const runtime = createRuntime({
      providers: { api, events },
      modules: [
        defineModule("auth", {
          login: action.define({ handler: (input: string, ctx) => ctx.providers.api.login(input) }),
        }),
        defineModule("account.migration", {
          execute: action.define({ async handler(input: string, ctx) {
            const user = await ctx.dispatch("auth.login", input);
            ctx.providers.events.push("migrated");
            return user;
          } }),
        }),
      ],
    });
    await expect(runtime.dispatch("account.migration.execute", "Ada")).resolves.toEqual({ name: "Ada" });
    expect(api.login).toHaveBeenCalledExactlyOnceWith("Ada");
    expect(events).toEqual(["migrated"]);
  });

  it.each([false, true])("preserves the exact nested error (async: %s)", async (asyncHandler) => {
    const failure = new Error("Login failed");
    const fail = () => { throw failure; };
    const runtime = createRuntime({
      providers: {},
      modules: [defineModule("errors", {
        child: defineAction({ handler: asyncHandler ? async () => fail() : fail }),
        parent: defineAction({ handler: (_: void, ctx) => ctx.dispatch("errors.child") }),
      })],
    });
    await expect(runtime.dispatch("errors.parent")).rejects.toBe(failure);
    await expect(runtime.dispatch("errors.child")).rejects.toBe(failure);
  });

  it("rejects unknown actions at both execution entry points", async () => {
    const runtime = createRuntime({
      providers: {},
      modules: [defineModule("test", {
        parent: defineAction({ handler: (_: void, ctx) => ctx.dispatch("missing.child") }),
      })],
    });
    const dynamicDispatch = runtime.dispatch as ContextDispatch;
    await expect(dynamicDispatch("missing.root")).rejects.toMatchObject({
      name: "UnknownActionError", actionId: "missing.root",
    });
    await expect(runtime.dispatch("test.parent")).rejects.toBeInstanceOf(UnknownActionError);
  });

  it("does not invoke inherited object properties as handlers", async () => {
    const runtime = createRuntime({ providers: {}, modules: [] });
    const dispatch = runtime.dispatch as ContextDispatch;
    for (const id of ["toString", "constructor", "__proto__"]) {
      await expect(dispatch(id)).rejects.toBeInstanceOf(UnknownActionError);
    }
  });

  it("provides a fresh immutable context for each concurrent dispatch", async () => {
    const contexts: ActionContext[] = [];
    const finishes = new Map<number, () => void>();
    const action = defineAction({ async handler(input: number, ctx) {
      contexts.push(ctx);
      await new Promise<void>((resolve) => finishes.set(input, resolve));
      return input;
    } });
    const runtime = createRuntime({
      providers: {}, modules: [defineModule("job", { run: action })],
    });
    const first = runtime.dispatch("job.run", 1);
    const second = runtime.dispatch("job.run", 2);
    expect(finishes.size).toBe(2);
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(contexts.every(Object.isFrozen)).toBe(true);
    finishes.get(2)!();
    await expect(second).resolves.toBe(2);
    finishes.get(1)!();
    await expect(first).resolves.toBe(1);
  });

  it("keeps provider bindings stable while preserving service identity", async () => {
    const service = { count: 0 };
    const providers = { service };
    const action = createActionFactory<typeof providers>();
    const runtime = createRuntime({
      providers,
      modules: [defineModule("counter", {
        increment: action.define({ handler: (_: void, ctx) => {
          expect(ctx.providers.service).toBe(service);
          expect(Object.isFrozen(ctx.providers)).toBe(true);
          return ++ctx.providers.service.count;
        } }),
      })],
    });
    providers.service = { count: 100 };
    await expect(runtime.dispatch("counter.increment")).resolves.toBe(1);
    expect(service.count).toBe(1);
  });

  it("does not share providers or registries between runtimes", async () => {
    const action = createActionFactory<{ name: string }>();
    const module = defineModule("app", {
      name: action.define({ handler: (_: void, ctx) => ctx.providers.name }),
    });
    const left = createRuntime({ providers: { name: "left" }, modules: [module] });
    const right = createRuntime({ providers: { name: "right" }, modules: [module] });
    expect(await Promise.all([left.dispatch("app.name"), right.dispatch("app.name")])).toEqual(["left", "right"]);
    expect(left.registry).not.toBe(right.registry);
  });

  it("allows a parent to catch an error and recover", async () => {
    const runtime = createRuntime({ providers: {}, modules: [defineModule("test", {
      recover: defineAction({ async handler(_: void, ctx) {
        try { await ctx.dispatch("missing.action"); } catch { return "recovered"; }
        return "unexpected";
      } }),
    })] });
    await expect(runtime.dispatch("test.recover")).resolves.toBe("recovered");
  });
});

describe("registry and definitions", () => {
  it("exposes immutable action metadata in registration order", () => {
    const tags = ["auth"];
    const login = defineAction({ description: "Log in", tags, handler: () => true });
    const actions = { "session.login": login };
    const module = defineModule("app.auth", actions);
    tags.push("mutated");
    actions["session.login"] = defineAction({ handler: () => false });
    const runtime = createRuntime({ providers: {}, modules: [module] });
    expect(runtime.registry.size).toBe(1);
    expect(runtime.registry.has("app.auth.session.login")).toBe(true);
    expect(runtime.registry.has("unknown")).toBe(false);
    expect(runtime.registry.get("unknown")).toBeUndefined();
    expect(runtime.registry.list()).toEqual([{
      id: "app.auth.session.login", namespace: "app.auth", name: "session.login",
      description: "Log in", tags: ["auth"],
    }]);
    expect(Object.isFrozen(runtime.registry.list())).toBe(true);
    expect(Object.isFrozen(runtime.registry.get("app.auth.session.login"))).toBe(true);
    expect(Object.isFrozen(runtime.registry.get("app.auth.session.login")?.tags)).toBe(true);
  });

  it("rejects collisions including differently partitioned namespaces", () => {
    const action = defineAction({ handler: () => undefined });
    const module = defineModule("a", { "b.c": action });
    for (const other of [module, defineModule("a.b", { c: action })]) {
      expect(() => createRuntime({ providers: {}, modules: [module, other] })).toThrow(DuplicateActionError);
    }
  });

  it.each(["", ".auth", "auth.", "auth..login", "auth login", "auth.\nlogin"])(
    "rejects invalid namespaces and action names: %j", (value) => {
      const action = defineAction({ handler: () => undefined });
      expect(() => defineModule(value, { run: action })).toThrow(TypeError);
      expect(() => defineModule("auth", { [value]: action })).toThrow(TypeError);
    },
  );

  it("validates structural modules from JavaScript callers too", () => {
    expect(() => createRuntime({
      providers: {}, modules: [{ namespace: "bad..path", actions: {} }],
    })).toThrow(TypeError);
    const valid = defineAction({ handler: () => undefined });
    const invalid = { handler: "not a function" } as unknown as typeof valid;
    expect(() => defineAction(invalid)).toThrow(TypeError);
    expect(() => defineModule("bad", { run: invalid })).toThrow(TypeError);
    expect(() => createRuntime({
      providers: {}, modules: [{ namespace: "bad", actions: { run: invalid } }],
    })).toThrow(TypeError);
    for (const namespace of [null, undefined, 123]) {
      expect(() => defineModule(namespace as unknown as string, {})).toThrow(TypeError);
    }
    for (const actions of [null, undefined, [], "invalid"]) {
      const invalidActions = actions as unknown as { run: typeof invalid };
      expect(() => defineModule("bad", invalidActions)).toThrow(TypeError);
    }
  });

  it("supports an empty runtime", () => {
    const runtime = createRuntime({ providers: {}, modules: [] });
    expect(runtime.registry.size).toBe(0);
    expect(runtime.registry.list()).toEqual([]);
  });
});
