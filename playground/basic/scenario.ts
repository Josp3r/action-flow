import { createActionFactory, createRuntime, defineModule } from "@action-flow/core";
import type { ActionSignature } from "@action-flow/core";
import { createScenarioRunner } from "@action-flow/scenario";

interface User { id: string; name: string }
interface Providers {
  api: { login(name: string): Promise<User> };
  session: { user: User | undefined };
}
interface Contract {
  "auth.login": ActionSignature<{ name: string }, User>;
  "session.start": ActionSignature<{ name: string }, User>;
}
const action = createActionFactory<Providers, Contract>();
const modules = [
  defineModule("auth", {
    login: action.define({ handler: (input: { name: string }, ctx) => ctx.providers.api.login(input.name) }),
  }),
  defineModule("session", {
    start: action.define({ async handler(input: { name: string }, ctx) {
      const user = await ctx.dispatch("auth.login", input);
      ctx.providers.session.user = user;
      return user;
    } }),
  }),
] as const;
const providers: Providers = {
  api: { async login(name) { return { id: "live-user", name }; } },
  session: { user: undefined },
};
const runtime = createRuntime({ providers, modules, environment: "development" });
export const runner = createScenarioRunner(runtime);
const cleanup: string[] = [];
const success = runner.defineScenario({
  id: "login.success", action: "session.start", input: { name: "Ada" },
  providers: () => ({ session: { user: undefined } }),
  mocks: { "auth.login": { type: "return", value: { id: "fixture-user", name: "Ada" } } },
  setup(ctx) { ctx.defer(() => { ctx.providers.session.user = undefined; cleanup.push(ctx.scenarioId); }); },
});
const failure = runner.defineScenario({
  id: "login.network-error", action: "session.start", input: { name: "Ada" },
  providers: () => ({ session: { user: undefined } }),
  mocks: { "auth.login": { type: "throw", error: new Error("Network unavailable") } },
});
const conflict = runner.defineScenario({
  id: "login.conflict", action: "session.start", input: { name: "Ada" },
  providers: () => ({ session: { user: undefined } }),
  mocks: { "auth.login": { type: "throw", error: Object.assign(new Error("Already signed in elsewhere"), { code: "SESSION_CONFLICT" }) } },
});
const results = await Promise.all([runner.run(success), runner.run(failure), runner.run(conflict)]);
for (const result of results) {
  console.log(`\n${result.scenarioId}: ${result.status}`);
  console.log(result.status === "success" ? result.output : result.error);
  for (const record of result.trace) console.log(`  ${record.parentExecutionId ? "└─" : "●"} ${record.actionId}: ${record.status}`);
}
const normal = await runtime.dispatch("session.start", { name: "Normal dispatch" });
if (normal.id !== "live-user" || results[0]?.status !== "success" || results.slice(1).some((result) => result.status !== "error")) throw new Error("Scenario isolation failed.");
console.log("\nNormal dispatch:", normal);
console.log("Fixture releases:", cleanup);
console.log("Scenarios:", runner.list().map((scenario) => scenario.id));
