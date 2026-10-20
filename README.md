# ActionFlow

框架无关、以 Dispatch 为核心的 TypeScript Action Runtime。统一管理业务行为，通过依赖注入独立执行，并用 Trace 和 Scenario 复现业务分支。

目前已完成 **Core Runtime、Execution & Trace、Scenario 和 DevTools**：可从浏览器选择 Action、编辑输入、运行场景，并查看结果和实时调用树。MVP 的功能闭环已完成，下一阶段为版本与发布收尾。三个包尚未发布。

## 开发

需要 Node.js 22.12+（22.x）、24.x 或 26+，以及 pnpm 10.34.5。

```sh
pnpm install
pnpm check
pnpm example
pnpm example:trace
pnpm example:scenario
pnpm example:devtools
```

`pnpm check` 按依赖顺序构建 Core、Scenario、DevTools，再执行类型检查和 Vitest 测试；示例使用实际构建出的声明文件。`pnpm example` 运行 [基础示例](playground/basic/index.ts)，展示 Registry、类型推导、跨模块调用及异常传播。

`pnpm example:devtools` 启动本地服务，打开 [DevTools](http://127.0.0.1:4173/devtools/) 即可交互调试。接入和验收方式见 [DevTools 文档](docs/devtools.md)。

补充验收入口：

```sh
pnpm example:browser # 本机浏览器验收页：http://127.0.0.1:4173
pnpm check:package   # 在临时外部项目中安装打包产物，验证执行与类型声明
pnpm bench           # 运行可重复的微基准，输出环境信息与五次采样结果
pnpm release:pack    # 将可安装的包输出到 artifacts/
```

浏览器验收页直接导入构建后的 ESM，不依赖前端框架。`check:package` 会清理自己创建的临时项目。手动触发的 `Verify release package` 工作流会检查并保存打包产物；当前流程不执行 npm 发布。性能微基准仅用于对比本机改动，不能据此推断实际应用性能。

## 基本用法

```ts
import { createActionFactory, createRuntime, defineModule } from "@action-flow/core";
import type { ActionSignature } from "@action-flow/core";

interface Providers {
  api: { login(input: { username: string }): Promise<{ id: string }> };
}

interface AppContract {
  "auth.login": ActionSignature<{ username: string }, { id: string }>;
}

const action = createActionFactory<Providers, AppContract>();

const auth = defineModule("auth", {
  login: action.define({
    async handler(input: { username: string }, ctx) {
      return ctx.providers.api.login(input);
    },
  }),
});

const runtime = createRuntime({
  providers: {
    api: { async login() { return { id: "user-1" }; } },
  },
  modules: [auth],
});

const user = await runtime.dispatch("auth.login", { username: "Ada" });
// user: { id: string }

runtime.registry.list();
// [{ id: "auth.login", namespace: "auth", name: "login" }]
```

无依赖的 Action 可直接使用 `defineAction`。不接收参数的 Handler 自动推导为可省略 Payload 的 Action。同步和异步 Handler 均通过 Dispatch 返回 Promise。

`defineModule(namespace, actionsMap)` 的第一个参数是 Namespace 字符串，第二个参数直接传 Action 字典。

跨模块编排使用 `createActionFactory<Providers, AppContract>()`：Handler 内的 `ctx.dispatch` 根据同一 Contract 推导 ID、输入和结果；`createRuntime` 还会检查契约目标都已注册且实现兼容。完整示例见 [基础 Demo](playground/basic/index.ts)，其中会直接读取子调用返回的 User，无需类型断言。提前保存模块列表时使用 `as const` 保留静态注册信息。

## 执行追踪

创建 Runtime 时设置 `environment: "development"` 或显式 `trace: true`，然后通过 `runtime.trace.list()`、`getTrace(traceId)` 和 `subscribe(listener)` 检查调用关系与生命周期。默认环境为 production，追踪默认关闭；输入、输出和错误详情均需另外开启采集。

运行 `pnpm example:trace` 可看到并发调用树、异常和取消状态。执行标识、Middleware、脱敏、容量回收及取消语义见 [执行与追踪说明](docs/execution-trace.md)。

## 场景复现

`createScenarioRunner(runtime)` 来自独立包 `@action-flow/scenario`。用 `runner.defineScenario({ id, action, input, providers?, mocks?, setup?, cleanup? })` 定义场景，随后 `await runner.run(scenario)` 获取结果与本次 Trace。Runtime 需要使用 development/test 环境或显式开启 `allowDebug`。

运行 `pnpm example:scenario` 查看登录成功、网络错误和冲突分支，或在浏览器验收页控制台执行 `await actionFlowDemo.runner.run(actionFlowDemo.scenarios.conflict)`。完整 API 与清理语义见 [Scenario 说明](docs/scenario.md)。

## 当前边界

- `runtime.dispatch` 根据静态注册模块校验 ID、Payload 和返回类型；不会自动验证来自网络或 JavaScript 调用方的数据。
- 使用 Contract 的 `ctx.dispatch(id, input)` 在编译期关联 ID、输入和输出；未传 Contract 的 Factory 仍使用返回 `unknown` 的动态边界。类型设计与静态注册要求见 [RFC](docs/RFC.md)。Contract 是编译期约束，不是运行时输入 Schema；JavaScript、类型断言或刻意擦除类型不在静态保证范围内。
- Providers 复制并冻结顶层绑定，保留 API、Router、外部 Store 等依赖对象的身份；SDK 不管理应用状态，也不深度冻结业务对象。
- Registry 为静态只读快照。重复 Action ID 在创建 Runtime 时抛错；未知 ID 在 Dispatch 时拒绝。
- Core 没有运行时依赖，不访问浏览器或 Node.js 专有全局对象。当前构建为 ESM，尚未验证的兼容能力见 [路线图](docs/roadmap.md)。
- Trace 使用有容量上限的内存存储，不默认持久化；取消为协作机制，不会回滚业务副作用。
- Scenario 用独立作用域隔离顶层绑定和 Mock；可变对象需要用 Factory 创建，SDK 不进行深拷贝。生产默认禁止调试执行，可显式配置 `allowDebug`。
- DevTools 通过独立开发入口显式挂载，不会随 Core/Scenario 自动加载。JSON 编辑器只校验语法，业务输入由 Handler/应用校验。
- 动态注册、远程调试和生产诊断服务尚未实现。

## 文档

- [项目背景与目标](docs/project-background.md)
- [类型设计提案与待确认决策](docs/RFC.md)
- [核心结构与执行边界](docs/architecture.md)
- [API 说明](docs/api-design.md)
- [执行、追踪、Middleware 与取消](docs/execution-trace.md)
- [Scenario、Mock、Fixture 与控制台验证](docs/scenario.md)
- [DevTools 接入与交互验收](docs/devtools.md)
- [里程碑与验收进度](docs/roadmap.md)

## License

MIT
