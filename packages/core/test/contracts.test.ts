import { describe, expect, it } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule } from "../src/index.js";
import type { ActionSignature } from "../src/index.js";

interface LoginInput { name: string }
interface User { id: string; name: string }
interface Receipt { userId: string; label: string }
interface Providers { api: { login(input: LoginInput): Promise<User> } }
interface AppContract {
  "auth.login": ActionSignature<LoginInput, User>;
  "account.start": ActionSignature<LoginInput, Receipt>;
}

function createApp(providers: Providers) {
  const action = createActionFactory<Providers, AppContract>();
  const auth = defineModule("auth", {
    login: action.define({ handler: (input: LoginInput, ctx) => ctx.providers.api.login(input) }),
  });
  const account = defineModule("account", {
    start: action.define({ async handler(input: LoginInput, ctx) {
      const user = await ctx.dispatch("auth.login", input);
      // No assertion or cast is needed to use the nested Action's output.
      return { userId: user.id, label: `Welcome, ${user.name}` };
    } }),
  });
  return createRuntime({ providers, modules: [auth, account] });
}

describe("contract-enabled composition", () => {
  it("uses the child result across modules with inferred input and output", async () => {
    const runtime = createApp({ api: { login: async (input) => ({ id: "user-1", name: input.name.toUpperCase() }) } });
    await expect(runtime.dispatch("account.start", { name: "Ada" })).resolves.toEqual({
      userId: "user-1", label: "Welcome, ADA",
    });
    expect(runtime.registry.list().map((entry) => entry.id)).toEqual(["auth.login", "account.start"]);
  });

  it("preserves an error from a typed nested Action", async () => {
    const failure = new Error("Account is blocked");
    const runtime = createApp({ api: { async login() { throw failure; } } });
    await expect(runtime.dispatch("account.start", { name: "blocked" })).rejects.toBe(failure);
  });

  it("keeps concurrent nested results associated when children finish in reverse order", async () => {
    const finish = new Map<string, (user: User) => void>();
    const runtime = createApp({ api: {
      login: (input) => new Promise<User>((resolve) => finish.set(input.name, resolve)),
    } });
    const first = runtime.dispatch("account.start", { name: "first" });
    const second = runtime.dispatch("account.start", { name: "second" });
    finish.get("second")!({ id: "2", name: "second" });
    await expect(second).resolves.toEqual({ userId: "2", label: "Welcome, second" });
    finish.get("first")!({ id: "1", name: "first" });
    await expect(first).resolves.toEqual({ userId: "1", label: "Welcome, first" });
  });

  it("can fulfil a contract with an independent provider-free Action", async () => {
    const action = createActionFactory<object, { "utility.double": ActionSignature<number, number> }>();
    const consumer = defineModule("consumer", {
      run: action.define({ async handler(input: number, ctx) {
        return await ctx.dispatch("utility.double", input) + 1;
      } }),
    });
    const utility = defineModule("utility", {
      double: defineAction({ handler: (input: number) => input * 2 }),
    });
    const runtime = createRuntime({ providers: {}, modules: [consumer, utility] });
    await expect(runtime.dispatch("consumer.run", 3)).resolves.toBe(7);
  });
});
