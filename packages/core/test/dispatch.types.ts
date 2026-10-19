import { expectTypeOf } from "vitest";
import { createActionFactory, createRuntime, defineAction, defineModule } from "../src/index.js";
import type { ActionInput, ActionOutput } from "../src/index.js";

interface User { id: number; name: string }
interface Providers { api: { login(name: string): Promise<User> } }

const action = createActionFactory<Providers>();
const login = action.define({
  async handler(input: { name: string }, ctx) {
    expectTypeOf(ctx.providers).toEqualTypeOf<Providers>();
    // @ts-expect-error providers are inferred from the factory
    ctx.providers.router;
    return ctx.providers.api.login(input.name);
  },
});
const auth = defineModule("auth", { login });
const math = defineModule("math.deep", {
  double: defineAction({ handler: (input: number) => input * 2 }),
  ping: defineAction({ handler: () => "pong" as const }),
  optional: defineAction({ handler: (input: string | undefined) => input ?? "default" }),
});
const providers: Providers = { api: { login: async (name) => ({ id: 1, name }) } };
const runtime = createRuntime({ providers, modules: [auth, math] });

// This function is typechecked, never executed. Negative assertions cannot cause runtime side effects.
function assertDispatchTypes() {
  expectTypeOf(runtime.dispatch("auth.login", { name: "Ada" })).toEqualTypeOf<Promise<User>>();
  expectTypeOf(runtime.dispatch("math.deep.double", 2)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(runtime.dispatch("math.deep.ping")).toEqualTypeOf<Promise<"pong">>();
  expectTypeOf(runtime.dispatch("math.deep.ping", undefined)).toEqualTypeOf<Promise<"pong">>();
  expectTypeOf(runtime.dispatch("math.deep.optional", undefined)).toEqualTypeOf<Promise<string>>();
  expectTypeOf<ActionInput<typeof login>>().toEqualTypeOf<{ name: string }>();
  expectTypeOf<ActionOutput<typeof login>>().toEqualTypeOf<User>();

  // @ts-expect-error unknown action
  runtime.dispatch("auth.logout", {});
  // @ts-expect-error incorrect input
  runtime.dispatch("auth.login", { name: 1 });
  // @ts-expect-error missing input
  runtime.dispatch("auth.login");
  // @ts-expect-error no input action rejects arbitrary input
  runtime.dispatch("math.deep.ping", 1);
  // @ts-expect-error explicitly undefined input still needs an argument for a non-void action
  runtime.dispatch("math.deep.optional");
  // @ts-expect-error known ID must retain its own payload requirements
  runtime.dispatch("math.deep.double", { name: "Ada" });

  const uncertainId = "" as "auth.login" | "math.deep.double";
  // @ts-expect-error an uncorrelated union ID and payload is unsafe
  runtime.dispatch(uncertainId, 2);
  const dynamicId: string = "auth.login";
  // @ts-expect-error dynamic strings have no static registration guarantee
  runtime.dispatch(dynamicId, { name: "Ada" });

  // @ts-expect-error missing required provider
  createRuntime({ providers: {}, modules: [auth] });
  // @ts-expect-error incorrect provider method
  createRuntime({ providers: { api: { login: () => false } }, modules: [auth] });

  const withRouter = createActionFactory<{ router: { push(path: string): void } }>();
  const navigation = defineModule("navigation", {
    go: withRouter.define({ handler: (path: string, ctx) => ctx.providers.router.push(path) }),
  });
  // @ts-expect-error providers from every module are required
  createRuntime({ providers, modules: [auth, navigation] });
  const combined = createRuntime({ providers: { ...providers, router: { push() {} } }, modules: [auth, navigation] });
  expectTypeOf(combined.dispatch("navigation.go", "/home")).toEqualTypeOf<Promise<void>>();

  const mixed = defineModule("mixed", {
    login,
    go: navigation.actions.go,
  });
  // @ts-expect-error heterogeneous actions in the same module also require all providers
  createRuntime({ providers, modules: [mixed] });
  const mixedRuntime = createRuntime({
    providers: { ...providers, router: { push() {} } }, modules: [mixed],
  });
  expectTypeOf(mixedRuntime.dispatch("mixed.login", { name: "Ada" })).toEqualTypeOf<Promise<User>>();

  const moduleArray = [auth, math];
  const fromArray = createRuntime({ providers, modules: moduleArray });
  expectTypeOf(fromArray.dispatch("math.deep.double", 2)).toEqualTypeOf<Promise<number>>();
  // @ts-expect-error module arrays still preserve the known action IDs
  fromArray.dispatch("not.registered", 2);

  const impossible = defineModule("never", {
    run: defineAction({ handler: (_: never) => 1 }),
  });
  const impossibleRuntime = createRuntime({ providers: {}, modules: [impossible] });
  // @ts-expect-error a never input must not turn into an optional payload
  impossibleRuntime.dispatch("never.run");

  const noInputFactory = createActionFactory<Providers>();
  const factoryModule = defineModule("factory", {
    ping: noInputFactory.define({ handler: () => "pong" as const }),
  });
  const factoryRuntime = createRuntime({ providers, modules: [factoryModule] });
  expectTypeOf(factoryRuntime.dispatch("factory.ping")).toEqualTypeOf<Promise<"pong">>();

  const mixedFreeModule = defineModule("mixedFree", {
    login,
    ping: defineAction({ handler: () => "pong" as const }),
  });
  const mixedFreeRuntime = createRuntime({ providers, modules: [mixedFreeModule, math] });
  expectTypeOf(mixedFreeRuntime.dispatch("mixedFree.login", { name: "Ada" })).toEqualTypeOf<Promise<User>>();
  expectTypeOf(mixedFreeRuntime.dispatch("mixedFree.ping")).toEqualTypeOf<Promise<"pong">>();
  // @ts-expect-error mixed actions retain input type checks
  mixedFreeRuntime.dispatch("mixedFree.login", { name: 123 });
  // @ts-expect-error module namespaces retain their literal types
  mixedFreeRuntime.dispatch("other.login", { name: "Ada" });
  // @ts-expect-error provider-free actions must not erase other actions' requirements
  createRuntime({ providers: {}, modules: [mixedFreeModule] });
  // @ts-expect-error provider-free modules must not erase other modules' requirements
  createRuntime({ providers: {}, modules: [auth, math] });
  // @ts-expect-error defineModule requires a namespace and an action map
  defineModule("missing");
  // @ts-expect-error the previous object configuration signature is no longer supported
  defineModule({ namespace: "legacy", actions: { login } });

  const empty = createRuntime({ providers: {}, modules: [] });
  // @ts-expect-error an empty runtime has no dispatchable IDs
  empty.dispatch("anything");
}
void assertDispatchTypes;
