# Milestone 1 API

以下 API 已实施。跨模块 Context 采用显式 Contract，设计依据见 [RFC](RFC.md)。

## defineAction / createActionFactory

```ts
const ping = defineAction({ handler: () => "pong" });
const double = defineAction({ handler: (input: number) => input * 2 });

const action = createActionFactory<AppProviders>();
const login = action.define({
  description: "Log in with the injected API client",
  tags: ["auth"],
  handler: (input: LoginInput, ctx) => ctx.providers.api.login(input),
});
```

Action 描述含 `handler` 和可选的 `description`、`tags`。输入应通过 Handler 参数注解定义，输出从 Handler 返回值推导。在 Factory 声明 Providers 和需要的 Contract，让每个 `define` 调用推导其输入和输出。

无参数 Handler 推导输入为 `void`。显式 `string | undefined` 输入仍要求传递一个参数，可以传 `undefined`。

需要跨模块静态类型时，将 Contract 作为 Factory 的第二个泛型参数：`createActionFactory<AppProviders, AppContract>()`，每个 `define` 仍自动推导实际 Handler 的输入和输出。

## defineModule

```ts
const auth = defineModule("app.auth", { login, ping });
```

统一使用 `defineModule(namespace, actionsMap)`：第一个参数是 Namespace 字符串，第二个参数直接传 Action 字典。保留字面量 Namespace 和 Action Key，建立 `app.auth.login` 等静态 ID。返回的 Module 包含只读的 `namespace` 和 `actions`，其中 Action 映射为冻结的浅层快照。当前只支持创建 Runtime 时的静态注册。

## createRuntime / runtime.dispatch

```ts
const runtime = createRuntime({ providers, modules: [auth, account] });
const result = await runtime.dispatch("app.auth.login", input);
await runtime.dispatch("app.auth.ping");
```

Providers 必须满足所有 Action 声明的依赖。Dispatch 始终返回 Promise，解析为 Handler 的最终返回值；同步错误同样表现为 Promise 拒绝。Payload 不被复制，Handler 按普通函数参数语义接收调用方对象。

当任一 Action 声明了 Contract，创建 Runtime 时还会验证所有契约目标都存在，目标 Handler 接受契约输入，且解析后的返回值符合契约输出。其他未列入契约的 Action 仍可注册。编译器诊断中的 `__actionFlowContractErrors` 用于列出缺失目标或不兼容的输入/输出；它不是需要在业务代码中填写的配置项。

Contract 模式要求静态可确定的模块集合：直接传 `[auth, account]`，或保存为 `const modules = [auth, account] as const`。普通可变数组、存在联合可能性的模块或 Namespace、宽泛的字符串 Namespace/Action 索引签名和可选 Action 不能证明注册完整，因此会被拒绝。未使用 Contract 的 Runtime 保留原有数组接入方式。

错误包括 `DuplicateActionError`（创建 Runtime 时）和 `UnknownActionError`（执行时），均包含 `actionId`。业务错误不包装。当前没有输入 Schema 校验、取消或执行记录。

## ctx.dispatch / ctx.providers

```ts
import type { ActionSignature } from "@action-flow/core";

interface AppContract {
  "app.auth.login": ActionSignature<LoginInput, User>;
  "account.start": ActionSignature<LoginInput, string>;
}

const action = createActionFactory<AppProviders, AppContract>();
const account = defineModule("account", {
  start: action.define({
    async handler(input: LoginInput, ctx) {
      const user = await ctx.dispatch("app.auth.login", input);
      return user.id; // user: User，无需断言
    },
  }),
});

// auth 必须实现 app.auth.login，且返回值与 User 兼容。
const runtime = createRuntime({ providers, modules: [auth, account] });
```

`ActionSignature<Input, Output>` 描述输入和最终输出；异步 Handler 的返回 Promise 会被解析后比较。每份 Contract 可以描述全部应用能力，也可以只描述这组 Handler 所依赖的能力。多份 Contract 在同一个 Runtime 中会分别校验，同一 ID 的冲突要求不能被合并掩盖。

`ctx.providers` 根据 Factory 的第一个泛型推导。`ctx.dispatch` 根据第二个泛型校验 ID 和输入，推导 Promise 的解析结果；它访问同一 Runtime 的 Action 和 Providers，每次嵌套调用有独立上下文。未传 Contract 时仍返回 `Promise<unknown>`。运行时继续拒绝未知 ID，不包装原始业务错误。

Contract 不增加运行时注册表、字段或输入验证器。它不能验证从网络收到的数据，也不能修复 `any`、类型断言或显式擦除模块类型后的信息丢失。

## runtime.registry

- `size`：已注册 Action 数量。
- `has(id)`：目标是否存在。
- `get(id)`：只读元数据，未找到时为 `undefined`。
- `list()`：按注册顺序返回冻结的元数据数组。

元数据包含 `id`、`namespace`、`name`、可选 `description` 和 `tags`。Registry 不暴露执行函数，不记录 Payload、结果或错误。
