import { createActionFactory, createRuntime, defineModule } from "@action-flow/core";
import type { ActionSignature } from "@action-flow/core";

interface LoginInput { username: string }
interface User { id: string; name: string }
interface AppProviders { api: { login(input: LoginInput): Promise<User> } }
interface SessionReceipt { started: true; username: string; userId: string }
interface AppContract {
  "auth.login": ActionSignature<LoginInput, User>;
  "account.session.start": ActionSignature<LoginInput, SessionReceipt>;
}

const action = createActionFactory<AppProviders, AppContract>();

const auth = defineModule("auth", {
  login: action.define({
    description: "Authenticate through the injected API client",
    async handler(input: LoginInput, ctx) {
      return ctx.providers.api.login(input);
    },
  }),
});

const session = defineModule("account.session", {
  start: action.define({
    description: "Compose a login action and return a session receipt",
    async handler(input: LoginInput, ctx) {
      const user = await ctx.dispatch("auth.login", input);
      // user is inferred as User inside the Handler as well as at the public entry point.
      return { started: true as const, username: user.name, userId: user.id };
    },
  }),
});

const runtime = createRuntime({
  providers: {
    api: {
      async login(input: LoginInput): Promise<User> {
        if (input.username === "blocked") throw new Error("Account is blocked");
        return { id: "user-1", name: input.username };
      },
    },
  },
  modules: [auth, session],
});

console.log("Registered actions:", runtime.registry.list().map((entry) => entry.id));

// Both the payload and Promise<User> result are inferred from the Action ID.
const user = await runtime.dispatch("auth.login", { username: "Ada" });
console.log("Login result:", user);
console.log("Nested dispatch:", await runtime.dispatch("account.session.start", { username: user.name }));

try {
  await runtime.dispatch("account.session.start", { username: "blocked" });
} catch (error) {
  console.log("Nested error propagated:", error instanceof Error ? error.message : error);
}
