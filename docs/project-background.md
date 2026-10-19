# ActionFlow — 项目启动文档
**Project Kickoff · v1.0 · 2026-10-16**

> 一套框架无关、以 Dispatch 为核心，支持 Action 注册、模块化组织、业务编排、执行追踪与场景化调试的 TypeScript SDK。

**项目名称：** ActionFlow  
**GitHub 仓库：** `action-flow`  
**项目类型：** TypeScript SDK / Monorepo  
**开发阶段：** 架构设计完成，准备进入 MVP 实施  
**核心原则：** Dispatch-first、Framework-agnostic、State-agnostic、Debuggable by Design

---

## 1. 项目背景

现代前端应用通常由大量业务 Handler 组成。

这些 Handler 分散在组件、Hooks、Composables、Services 和 Store 中，通过普通函数调用形成复杂的业务执行链路。

这种组织方式存在几个问题：

**业务行为缺乏统一管理。**

开发者很难直接获得应用完整的业务行为清单，也难以快速定位某个行为的入口。

**业务逻辑难以独立调试。**

开发者通常需要通过页面交互触发某个业务 Handler。对于复杂业务流程，可能需要重复执行大量前置操作。

**业务分支难以稳定复现。**

例如账号迁移流程可能包含登录失败、Token 过期、绑定冲突、迁移失败等多个分支。传统调试方式需要构造特定的服务端响应或应用状态。

**业务执行链路缺乏统一可观测性。**

一个用户操作可能触发多个异步 Handler，开发者难以直观了解完整调用关系、输入输出、执行耗时及异常传播过程。

ActionFlow 希望通过统一的 Action Runtime 解决这些问题。

---

## 2. 项目目标

ActionFlow 的核心目标是：

**将需要显式管理的业务 Handler 抽象为 Action，并通过统一的 Dispatch 机制执行。**

在此基础上实现：

| 能力 | 目标 |
|---|---|
| Action Registry | 统一注册、查询、管理业务行为 |
| Dispatch | 提供标准化的 Action 执行入口 |
| Module | 按业务领域组织 Action |
| Namespace | 为 Action 提供全局唯一标识 |
| Providers | 为 Action 注入外部依赖 |
| Composition | 支持 Action 嵌套与业务编排 |
| Trace | 记录完整 Action 执行链路 |
| Scenario | 通过参数和依赖注入复现业务分支 |
| DevTools | 提供可视化的 Action 调试能力 |
| Environment Control | 根据环境控制调试能力 |

### 非目标

ActionFlow 不计划实现：

- Redux、Vuex、Pinia 等状态管理能力。
- 响应式系统。
- React/Vue 组件生命周期管理。
- 完整的工作流引擎或 BPMN 引擎。
- 替代 Playwright 等 E2E 测试框架。
- 完整的依赖注入容器。
- 默认持久化 Action 执行历史。

**ActionFlow 管理业务行为，不管理应用状态。**

---

## 3. 核心架构

```text
Application
│
├── UI Layer
│   ├── React
│   ├── Vue
│   └── Vanilla JS
│
│       dispatch(actionId, payload)
│                   │
│                   ▼
├── ActionFlow Runtime
│   │
│   ├── Module Registry
│   │   ├── auth
│   │   ├── account
│   │   └── order
│   │
│   ├── Action Registry
│   │
│   ├── Dispatcher
│   │   ├── Input Validation
│   │   ├── Middleware
│   │   ├── Execution Context
│   │   └── Handler Execution
│   │
│   ├── Providers
│   │
│   ├── Trace
│   │
│   └── Scenario
│
├── External Dependencies
│   ├── API
│   ├── Router
│   ├── Store
│   └── JSBridge
│
└── DevTools
    ├── Action Explorer
    ├── Scenario Runner
    └── Trace Viewer
```

Runtime Core 必须保持框架无关。

DevTools、Scenario 和框架适配能力应通过独立模块逐步扩展。

---

## 4. 核心概念

### 4.1 Action

Action 是最小的受管理业务执行单元。

每个 Action 具有明确的输入、输出和执行逻辑。

```ts
const login = defineAction({
  async handler(input: LoginInput, ctx) {
    return ctx.providers.api.login(input);
  },
});
```

Action 可以同步或异步执行，也可以调用其他 Action。

普通工具函数不需要注册为 Action。

### 4.2 Module

Module 是 Action 的组织单位。

统一使用 `defineModule(namespace, actionsMap)`：第一个参数是 Namespace，第二个参数是 Action 字典。

```ts
const authModule = defineModule("auth", {
  login,
  logout,
});
```

Module 不拥有独立的状态管理系统。

第一版主要负责 Namespace、Action 注册和元数据组织。

### 4.3 Namespace

Action 使用点分隔的字符串作为标识。

```text
auth.login
auth.logout
auth.session.refresh

account.migration.validate
account.migration.execute

order.payment.submit
```

Namespace 支持多级结构。

多级 Namespace 不意味着必须存在对应的嵌套 Module。

### 4.4 Providers

Providers 是 Action 执行所需的外部依赖集合。

```ts
const runtime = createRuntime({
  providers: {
    api,
    router,
    authStore,
    bridge,
  },

  modules: [
    authModule,
    accountModule,
  ],
});
```

Handler 通过执行上下文访问依赖：

```ts
async handler(input, ctx) {
  const { api, authStore } = ctx.providers;

  const user = await api.login(input);

  authStore.setUser(user);

  return user;
}
```

Providers 应支持受控的 Scenario Override。

第一版不实现复杂的 Provider 生命周期和依赖解析容器。

---

## 5. Dispatch-first 架构

所有需要显式管理的业务 Handler 应通过 Dispatch 执行。

```ts
await runtime.dispatch("auth.login", {
  username: "admin",
  password: "123456",
});
```

Action 内部通过 `ctx.dispatch()` 调用其他 Action。

```ts
const submitMigration = defineAction({
  async handler(input, ctx) {
    const validation = await ctx.dispatch(
      "account.migration.validate",
      input,
    );

    return ctx.dispatch(
      "account.migration.execute",
      validation,
    );
  },
});
```

每次 Dispatch 产生独立的 Execution。

嵌套 Dispatch 形成父子调用关系。

需要注意，Dispatch-first 是业务代码的接入规范，不代表 Runtime 能自动拦截所有普通 JavaScript 函数调用。

---

## 6. TypeScript 类型设计

核心目标是：

**Action ID、Payload 和 Return Type 必须建立静态类型关联。**

推荐 API：

```ts
interface AppProviders {
  api: ApiClient;
  router: Router;
}

const action = createActionFactory<AppProviders>();

const login = action.define({
  async handler(input: LoginInput, ctx) {
    return ctx.providers.api.login(input);
  },
});

const authModule = defineModule("auth", {
  login,
});

const runtime = createRuntime({
  providers,
  modules: [authModule],
});
```

最终 Dispatch 应支持：

```ts
const user = await runtime.dispatch(
  "auth.login",
  {
    username: "admin",
    password: "123456",
  },
);
```

TypeScript 应自动推导：

- 合法 Action ID。
- Payload 类型。
- Action 返回类型。
- Providers 类型。

### 类型系统待解决问题

跨 Module 的 `ctx.dispatch()` 如何获得全局 Action 类型，目前尚未最终确定。

第一版优先保证静态注册的 `runtime.dispatch()` 类型安全。

动态注册需要明确运行时检查与编译期类型之间的边界。

---

## 7. Scenario Engine

Scenario 用于构造特定业务执行条件。

```ts
const loginFailure = defineScenario({
  id: "auth.login.failure",

  action: "auth.login",

  input: {
    username: "test",
    password: "test",
  },

  providers: {
    api: mockApi,
  },
});
```

Scenario 应支持：

- 自定义 Action 输入。
- Provider Override。
- Mock 返回值或异常。
- 环境 Fixture。
- 独立执行上下文。
- 执行结果及 Trace 检查。

Scenario 不负责维护应用 State。

如果某个 Case 依赖特定状态，应通过测试 Store、Fixture 或 Provider 准备执行环境。

### 重要约束

Scenario Override 不得污染其他并发执行。

对于具有真实写入副作用的 Action，调试执行必须遵守权限与安全策略。

---

## 8. Trace 与可观测性

每次 Dispatch 应生成 Execution Record。

```ts
interface ExecutionRecord {
  executionId: string;
  traceId: string;
  parentExecutionId?: string;

  actionId: string;

  status:
    | "running"
    | "success"
    | "error"
    | "cancelled";

  startTime: number;
  endTime?: number;

  duration?: number;
  error?: unknown;
}
```

Trace 应支持：

- Action 调用树。
- 执行耗时。
- 异常追踪。
- 父子关系。
- 并发执行关联。
- Scenario 标识。

输入、输出和错误详情的采集应支持配置与脱敏，避免记录 Token、密码等敏感数据。

未来 DevTools 可以提供 Tree、Timeline、Flow 和 Swimlane 等不同视图。

---

## 9. 环境控制与生产安全

ActionFlow 应区分正常业务执行和调试能力。

| 能力 | Development | Test | Production |
|---|---|---|---|
| Action Dispatch | 开启 | 开启 | 开启 |
| Registry | 开启 | 开启 | 开启 |
| Trace | 开启 | 开启 | 可控 |
| Scenario Mock | 开启 | 开启 | 默认关闭 |
| DevTools | 开启 | 开启 | 默认不打包 |
| Console Dispatch | 可开启 | 可开启 | 默认关闭 |

生产环境不能仅依靠隐藏 `window` 对象保护敏感 Action。

生产诊断能力需要独立的授权、权限校验及副作用限制。

---

## 10. 仓库结构

采用 pnpm Monorepo，但第一阶段只实施 Core。

```text
action-flow/
├── packages/
│   └── core/
│       ├── src/
│       │   ├── action/
│       │   ├── module/
│       │   ├── registry/
│       │   ├── runtime/
│       │   ├── dispatch/
│       │   ├── providers/
│       │   ├── trace/
│       │   └── index.ts
│       └── package.json
│
├── playground/
│   └── basic/
│
├── docs/
│   ├── RFC.md
│   ├── architecture.md
│   ├── api-design.md
│   └── roadmap.md
│
├── AGENTS.md
├── README.md
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

后续根据实际依赖边界扩展：

```text
packages/
├── core/
├── scenario/
├── devtools/
├── vue/
└── react/
```

不提前创建没有实际代码的独立 npm 包。

---

## 11. 技术选型

| 项目 | 方案 |
|---|---|
| 语言 | TypeScript |
| 包管理 | pnpm |
| 仓库 | Monorepo |
| 构建 | tsdown 或同类工具，实施时确定 |
| 单元测试 | Vitest |
| 类型测试 | TypeScript `@ts-expect-error` / `expectTypeOf` |
| 文档 | Markdown，后续可接入 VitePress |
| 版本管理 | Changesets |
| 运行环境 | Browser / Node.js，SSR 安全 |

第一版避免引入 Turborepo、Nx 等额外任务编排工具。

---

## 12. 开发里程碑

### Milestone 1：Core Runtime

实现：

- `defineAction`
- `defineModule`
- `createRuntime`
- `runtime.dispatch`
- `ctx.dispatch`
- Providers 注入
- Action Registry
- 基础 Execution Context

**验收标准：** 能够通过完整类型安全的 Dispatch 执行嵌套 Action，并正确返回结果及传播异常。

### Milestone 2：Execution & Trace

实现：

- Execution ID
- Trace ID
- 父子调用关系
- 执行生命周期
- Middleware
- AbortSignal 传播

**验收标准：** 可以还原嵌套、并发 Action 的真实调用关系。

### Milestone 3：Scenario

实现：

- Scenario 定义
- Provider Override
- Mock Action Result
- Fixture Setup / Cleanup
- 执行上下文隔离

**验收标准：** 同一个 Action 可以稳定复现多个业务分支，且并发 Scenario 互不污染。

### Milestone 4：DevTools

实现：

- Action 列表与搜索
- Payload 编辑
- Action 独立执行
- Scenario 选择
- Trace 调用树
- 执行结果检查

**验收标准：** 开发者不需要通过完整页面操作，即可调试指定 Action。

### Milestone 5：工程化与发布

实现：

- 构建产物与 Export Map
- Browser / Node.js 兼容验证
- SSR 安全验证
- 性能基准
- 文档与示例
- CI 和发布流程

---

## 13. 需要在实施中确认的设计问题

以下内容尚未形成最终架构决策，不应由 Agent 擅自固化：

| 问题 | 当前倾向 |
|---|---|
| 跨 Module Dispatch 类型推导 | 显式 Contract 或两阶段绑定 |
| Middleware 洋葱模型 | 倾向支持 |
| Action 并发策略 | 默认并发 |
| Action 取消机制 | AbortSignal |
| Provider 作用域 | Runtime + Scenario |
| 动态 Module 注册 | 支持，但静态类型能力有限 |
| Action Schema | 可选，不强绑定 Zod |
| Trace 存储 | 第一版内存实现 |
| Action Replay | 后续评估 |
| DevTools UI 框架 | 待定 |

---

## 14. 给 Codex Agent 的实施约束

后续 Agent 应遵守以下原则：

**第一，先类型设计，后 Runtime 实现。**

`defineAction`、`defineModule` 和 `dispatch` 的 TypeScript API 是第一阶段的核心验收对象。

**第二，不引入内置 State 管理。**

不得自行增加 Store、Reducer、Mutation 或响应式系统。

**第三，保持 Core 零框架依赖。**

不得让 Core 依赖 React、Vue、Pinia 或其他具体前端框架。

**第四，避免过度工程化。**

第一版不实现完整 DI Container、工作流引擎、权限平台或复杂 DevTools。

**第五，每个里程碑必须提供可运行示例与测试。**

包括正确类型用例、错误类型用例、运行时行为测试和边界情况测试。

**第六，未确认的架构决策先提出方案，不直接固化。**

特别是跨 Module 类型推导、并发调度和 Provider 生命周期。

---

## 15. 项目成功标准

ActionFlow MVP 应证明三件事。

**一、业务行为可以统一管理。**

开发者能够通过 Action Registry 找到应用中已注册的业务能力。

**二、业务行为可以独立执行。**

开发者能够通过 Dispatch 和 Providers，在不依赖完整页面交互的情况下执行指定 Action。

**三、业务分支可以稳定复现。**

开发者能够通过 Scenario 构造不同执行条件，并观察完整 Trace。

如果这三个目标得到验证，ActionFlow 就已经具备区别于普通状态管理库、事件总线和测试框架的独立价值。

---

### 最终定位

**ActionFlow is a framework-agnostic, dispatch-driven action runtime for TypeScript applications, designed for composability, observability, and scenario-based debugging.**

这版可以作为新 Codex Project 的项目启动基线。它整合了我们在当前对话中确认的架构方向；但由于没有重新检查本地仓库内容，不能将其视为已经与仓库现有文档完成合并的版本。
