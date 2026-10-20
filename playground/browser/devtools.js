import { createActionFactory, createRuntime, defineAction, defineModule } from "@action-flow/core";
import { createScenarioRunner } from "@action-flow/scenario";
import { mountDevTools } from "@action-flow/devtools";

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function nameOf(input) {
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new TypeError("请输入非空的 name 字符串。");
  return input.name;
}
const action = createActionFactory();
const session = defineModule("session", {
  start: action.define({ description: "登录并写入会话，查看跨模块调用链", tags: ["auth", "登录"],
    async handler(input, ctx) {
      nameOf(input);
      const user = await ctx.dispatch("auth.login", input);
      return ctx.dispatch("session.commit", user);
    },
  }),
  commit: action.define({ description: "通过注入的 Store 保存用户会话", tags: ["store"], handler(user, ctx) {
    if (!user || typeof user.id !== "string") throw new TypeError("用户需要 id 字符串。");
    ctx.providers.session.user = user;
    return { authenticated: true, user };
  } }),
});
const auth = defineModule("auth", {
  login: action.define({ description: "调用注入的登录 API，约 450 ms", tags: ["auth"], handler(input, ctx) {
    return ctx.providers.api.login(nameOf(input), ctx.signal);
  } }),
});
const demo = defineModule("demo", {
  echo: defineAction({ description: "返回任意输入，结果自动隐藏常见敏感字段", handler: (input) => input }),
  slow: defineAction({ description: "8 秒协作任务，可在运行历史中选择并取消", async handler(_, ctx) { await delay(8_000, ctx.signal); return { finished: true }; } }),
  fail: defineAction({ description: "主动抛出业务异常，检查错误展示", handler() { throw Object.assign(new Error("示例业务异常"), { code: "DEMO_FAILURE" }); } }),
});
const runtime = createRuntime({
  environment: "development", trace: { maxRecords: 200, capture: { input: true, output: true, error: true } },
  providers: { session: { user: undefined }, api: { async login(name, signal) { await delay(450, signal); return { id: "live-user", name }; } } },
  modules: [session, auth, demo],
});
const runner = createScenarioRunner(runtime, { trace: { maxRecords: 200, capture: { input: true, output: true, error: true } } });
const fresh = () => ({ session: { user: undefined } });
const input = { name: "Ada" };
runner.defineScenario({ id: "login.success", description: "固定成功响应，使用独立会话 Store", action: "session.start", input, providers: fresh,
  mocks: { "auth.login": { type: "return", value: { id: "fixture-user", name: "Ada" } } },
  setup(ctx) { ctx.defer(() => { ctx.providers.session.user = undefined; }); },
});
runner.defineScenario({ id: "login.network-error", description: "复现登录 API 网络异常", action: "session.start", input, providers: fresh,
  mocks: { "auth.login": { type: "throw", error: new Error("Network unavailable") } },
});
runner.defineScenario({ id: "login.conflict", description: "复现已有会话冲突分支", action: "session.start", input, providers: fresh,
  mocks: { "auth.login": { type: "throw", error: Object.assign(new Error("Already signed in elsewhere"), { code: "SESSION_CONFLICT" }) } },
});
runner.defineScenario({ id: "login.cleanup-error", description: "执行成功后 Fixture 释放失败，保留组合错误", action: "session.start", input, providers: fresh,
  mocks: { "auth.login": { type: "return", value: { id: "fixture-user", name: "Ada" } } },
  setup(ctx) { ctx.defer(() => { throw new Error("Fixture release failed"); }); },
});
runner.defineScenario({ id: "login.setup-error", description: "环境准备阶段失败，尚未进入 Dispatch", action: "session.start", input, providers: fresh,
  setup() { throw new Error("Fixture setup failed"); },
});
const handle = mountDevTools({ target: document.querySelector("#app"), runtime, runner,
  trace: { maxRecords: 200, capture: { input: true, output: true, error: true } },
  initialPayloads: {
    "session.start": '{\n  "name": "Ada"\n}', "auth.login": '{\n  "name": "Ada"\n}',
    "session.commit": '{\n  "id": "manual-user",\n  "name": "Ada"\n}',
    "demo.echo": '{\n  "message": "Hello ActionFlow",\n  "token": "demo-secret"\n}',
  },
});
globalThis.actionFlowDevtoolsDemo = Object.freeze({ runtime, runner, handle });
