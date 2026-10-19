import { expectTypeOf } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule } from "../src/index.js";
import type { ActionContext, ActionSignature } from "../src/index.js";

interface LoginInput { name: string }
interface User { id: string; name: string }
interface Providers { api: { login(input: LoginInput): Promise<User> } }
interface AppContract {
  "auth.login": ActionSignature<LoginInput, User>;
  "account.start": ActionSignature<LoginInput, string>;
  "utility.ping": ActionSignature<void, "pong">;
}

const action = createActionFactory<Providers, AppContract>();
const login = action.define({
  handler: (input: LoginInput, ctx) => ctx.providers.api.login(input),
});
const start = action.define({
  async handler(input: LoginInput, ctx) {
    const user = await ctx.dispatch("auth.login", input);
    expectTypeOf(user).toEqualTypeOf<User>();
    expectTypeOf(ctx.providers).toEqualTypeOf<Providers>();
    return user.id;
  },
});
const ping = action.define({ handler: () => "pong" as const });
const auth = defineModule("auth", { login });
const account = defineModule("account", { start });
const utility = defineModule("utility", { ping });
const providers: Providers = { api: { login: async (input) => ({ id: "1", name: input.name }) } };

function assertContext(ctx: ActionContext<Providers, AppContract>) {
  expectTypeOf(ctx.dispatch("auth.login", { name: "Ada" })).toEqualTypeOf<Promise<User>>();
  expectTypeOf(ctx.dispatch("account.start", { name: "Ada" })).toEqualTypeOf<Promise<string>>();
  expectTypeOf(ctx.dispatch("utility.ping")).toEqualTypeOf<Promise<"pong">>();
  // @ts-expect-error cross-module dispatch rejects unknown Action IDs
  ctx.dispatch("auth.missing", {});
  // @ts-expect-error cross-module dispatch rejects incorrect input
  ctx.dispatch("auth.login", { name: 42 });
  // @ts-expect-error cross-module dispatch requires the declared input
  ctx.dispatch("auth.login");
  // @ts-expect-error input-free contract Actions reject arbitrary input
  ctx.dispatch("utility.ping", 42);
  // @ts-expect-error inferred results are checked, rather than selected by the caller
  const incorrectResult: Promise<number> = ctx.dispatch("auth.login", { name: "Ada" });
  const uncertainId = "" as "auth.login" | "account.start" | "utility.ping";
  // @ts-expect-error union IDs cannot be paired with uncorrelated input
  ctx.dispatch(uncertainId, { name: "Ada" });
  void incorrectResult;
}

function assertRegistration() {
  const runtime = createRuntime({ providers, modules: [auth, account, utility] });
  expectTypeOf(runtime.dispatch("account.start", { name: "Ada" })).toEqualTypeOf<Promise<string>>();
  expectTypeOf(runtime.dispatch("utility.ping")).toEqualTypeOf<Promise<"pong">>();
  // @ts-expect-error contract-enabled Actions still require their Providers
  createRuntime({ providers: {}, modules: [auth, account, utility] });
  // @ts-expect-error all contract targets must be registered, including nested targets
  createRuntime({ providers, modules: [account, utility] });
  // @ts-expect-error registering an Action under a different namespace does not fulfil the contract
  createRuntime({ providers, modules: [defineModule("wrong", { login }), account, utility] });

  const wrongInput = defineModule("auth", {
    login: defineAction({ handler: (input: number): User => ({ id: String(input), name: "Ada" }) }),
  });
  // @ts-expect-error registered handler cannot accept the contract input
  createRuntime({ providers, modules: [wrongInput, account, utility] });
  const wrongOutput = defineModule("auth", {
    login: action.define({ handler: (_: LoginInput) => 42 }),
  });
  // @ts-expect-error registered handler returns an incompatible output
  createRuntime({ providers, modules: [wrongOutput, account, utility] });
  const wrongAsyncOutput = defineModule("auth", {
    login: defineAction({ handler: async (_: LoginInput) => "incorrect" }),
  });
  // @ts-expect-error resolved asynchronous outputs are checked too
  createRuntime({ providers, modules: [wrongAsyncOutput, account, utility] });

  const moduleArray = [auth, account, utility] as const;
  createRuntime({ providers, modules: moduleArray });
  const incompleteModuleArray = [account, utility] as const;
  // @ts-expect-error arrays do not erase missing contract targets
  createRuntime({ providers, modules: incompleteModuleArray });
  const widenedModuleArray = [auth, account, utility];
  // @ts-expect-error a mutable array cannot guarantee every required module is present
  createRuntime({ providers, modules: widenedModuleArray });
  const uncertainNamespace = "" as "auth" | "other";
  // @ts-expect-error a union namespace cannot guarantee the auth.login target
  createRuntime({ providers, modules: [defineModule(uncertainNamespace, { login }), account, utility] });
  const alternate = defineModule("other", { login });
  const uncertainModule = null as unknown as typeof auth | typeof alternate;
  // @ts-expect-error a union module might omit a required Action
  createRuntime({ providers, modules: [uncertainModule, account, utility] });
  const widenedNamespace = "auth" as string;
  // @ts-expect-error a general string does not prove the required namespace exists
  createRuntime({ providers, modules: [defineModule(widenedNamespace, { login }), account, utility] });
  const widenedActions: Record<string, typeof login> = { login };
  // @ts-expect-error an index signature cannot prove the required Action key exists
  createRuntime({ providers, modules: [defineModule("auth", widenedActions), account, utility] });
  const uncertainList = null as unknown as readonly [typeof auth, typeof account, typeof utility] | readonly [typeof account, typeof utility];
  // @ts-expect-error a union of module lists might omit a required module
  createRuntime({ providers, modules: uncertainList });

  // Extra actions need not appear in a contract: contracts describe required capabilities.
  const helpers = defineModule("helpers", { count: defineAction({ handler: () => 1 }) });
  createRuntime({ providers, modules: [auth, account, utility, helpers] });
  const compatibleWiderInput = defineModule("auth", {
    login: defineAction({ handler: (input: LoginInput | number): User => ({ id: "1", name: typeof input === "number" ? "Ada" : input.name }) }),
  });
  createRuntime({ providers, modules: [compatibleWiderInput, account, utility] });
}

function assertMultipleContracts() {
  const left = createActionFactory<object, { "shared.get": ActionSignature<void, string> }>();
  const right = createActionFactory<object, { "shared.get": ActionSignature<void, number> }>();
  const consumers = defineModule("consumer", {
    left: left.define({ handler: (_: void, ctx) => ctx.dispatch("shared.get") }),
    right: right.define({ handler: (_: void, ctx) => ctx.dispatch("shared.get") }),
  });
  const shared = defineModule("shared", { get: defineAction({ handler: () => "value" }) });
  // @ts-expect-error both contracts must be satisfied, even when they require the same ID
  createRuntime({ providers: {}, modules: [consumers, shared] });
  const compatible = defineModule("consumer", {
    left: left.define({ handler: (_: void, ctx) => ctx.dispatch("shared.get") }),
    other: defineAction({ handler: () => true }),
  });
  createRuntime({ providers: {}, modules: [compatible, shared] });

  const asynchronous = createActionFactory<object, { "async.get": ActionSignature<void, Promise<User>> }>();
  const asyncModule = defineModule("async", {
    get: asynchronous.define({ handler: async () => ({ id: "1", name: "Ada" }) }),
  });
  createRuntime({ providers: {}, modules: [asyncModule] });

  // @ts-expect-error every contract entry needs an input/output signature
  createActionFactory<Providers, { "invalid.shape": string }>();
  // @ts-expect-error contract IDs must be strings
  createActionFactory<Providers, { 42: ActionSignature<void, string> }>();
  // @ts-expect-error contract entries must be required, not optional targets
  createActionFactory<Providers, { "optional.get"?: ActionSignature<void, string> }>();
}

function assertDynamicBoundary(ctx: ActionContext<Providers>) {
  expectTypeOf(ctx.dispatch("external.dynamic", { arbitrary: true })).toEqualTypeOf<Promise<unknown>>();
  const structural = defineModule("structural", {
    double: { handler: (input: number) => input * 2 },
  });
  // The pre-existing, non-contract array API still works with structural Actions.
  const modules = [structural];
  const runtime = createRuntime({ providers: {}, modules });
  expectTypeOf(runtime.dispatch("structural.double", 3)).toEqualTypeOf<Promise<number>>();
}

void assertContext;
void assertRegistration;
void assertMultipleContracts;
void assertDynamicBoundary;
