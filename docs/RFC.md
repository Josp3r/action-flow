# RFC 001：显式 Contract 与跨模块 Dispatch

状态：显式 Contract 已实施，Milestone 1 的嵌套类型安全验收已完成。Trace、Scenario 和 DevTools 继续按下述计划推进。

## 设计决策

Handler 的定义早于 Runtime 模块汇总，不能直接依赖后者反向推导全局 Action 类型。使用显式 Contract 提前声明 ID 与输入/输出的关联，保留现有 Action 定义方式和唯一的 `defineModule(namespace, actionsMap)` 签名。

```ts
import type { ActionSignature } from "@action-flow/core";

interface AppContract {
  "auth.login": ActionSignature<LoginInput, User>;
  "account.start": ActionSignature<LoginInput, string>;
}

const action = createActionFactory<AppProviders, AppContract>();
const account = defineModule("account", {
  start: action.define({
    async handler(input: LoginInput, ctx) {
      const user = await ctx.dispatch("auth.login", input);
      return user.id;
    },
  }),
});

const runtime = createRuntime({ providers, modules: [auth, account] });
```

`ctx.dispatch` 根据 Contract 校验合法 ID 和输入，返回 `Promise<Awaited<ContractOutput>>`。Handler 自身的输入和输出仍从实现推导。`runtime.dispatch` 继续从实际静态模块推导公开调用类型。

## 组装时的一致性检查

每个带 Contract 的 Action 都将契约信息保留在声明类型中。创建 Runtime 时逐个检查：

- 契约内的目标 ID 均已注册，防止 Handler 调用一个只有类型声明、没有实现的 Action。
- 实现能接受契约允许的输入；接受更宽输入的实现仍可使用。
- 实现的最终返回值与契约输出兼容。同步和异步 Handler 均按解析后的输出比较。
- 多份契约分别校验，同一 ID 的冲突要求不能因先合并契约而被掩盖。
- Providers 必须满足所有 Action 的声明依赖，带契约和不带契约的 Action 可以共存。

Contract 可以描述全部应用能力，也可以只描述一组 Handler 所依赖的能力。允许注册额外的 Action。契约的每个条目必须是以字符串 ID 为键的必选 `ActionSignature<Input, Output>`。

检查完全发生在编译期，不增加运行时字段、全局注册表、Schema 或生命周期。诊断中的 `__actionFlowContractErrors` 用于展示缺失或不兼容的目标，不是业务方应填写的配置。

## 静态保证的边界

在启用 Contract 的 Runtime 中，模块列表必须是静态可确定的元组。直接写 `modules: [auth, account]` 会保留信息；提前保存变量时写 `const modules = [auth, account] as const`。普通数组无法证明必需元素一定存在，联合模块或 Namespace、宽泛索引签名和可选 Action 同样不能证明完整性，因此会被拒绝。

未传 Contract 的 `createActionFactory<Providers>()` 保留显式动态边界：`ctx.dispatch` 接受字符串和未知输入，返回 `Promise<unknown>`。这不影响静态 `runtime.dispatch` 的推导，也不意味着所有 JavaScript 调用都具备类型安全。网络输入、`any`、类型断言或刻意擦除类型均不属于契约保证范围。

没有加入由调用方任意指定返回值泛型的 Dispatch，避免在没有实现验证的情况下产生虚假的类型保证。

## 验收证据

- `contracts.types.ts`：正确输入/输出、无输入 Action、错误 ID/输入、缺失实现、同步/异步错误返回、多契约冲突、Providers 和静态注册边界。
- `contracts.test.ts`：跨模块使用真实子调用返回值、原始异常传播、子调用反序完成时结果关联、独立 Action 满足局部契约。
- `playground/basic/index.ts`：登录并启动会话，父 Action 直接使用类型为 User 的子调用结果。
- `scripts/check-package.mjs`：将实际 tarball 安装到临时外部项目，验证公开类型声明中的契约推导和负向用例。

## 下一阶段：Execution & Trace

按前述提案推进，先明确接口和验收再实现：

- 每次 Dispatch 生成 Execution ID；根调用生成 Trace ID，子调用通过闭包继承 Trace ID 和父 Execution ID，不使用全局可变的当前执行对象。
- Trace 使用有容量上限的内存存储，支持查询和生命周期订阅。默认只采集结构与时间；输入、输出及错误详情按配置采集并支持脱敏。
- Middleware 采用洋葱模型，单次执行的 `next()` 只能调用一次；定义短路返回和异常恢复行为。
- 默认并发执行，不增加排队、互斥或去重调度 API。
- 使用 AbortSignal 协作取消并向子调用传播；取消不回滚已发生的业务副作用，也不能强制终止不处理信号的外部 Promise。

验收覆盖嵌套调用、并发根调用与子调用的真实关系、状态迁移、异常、取消、订阅者抛错隔离、容量回收和 Trace 关闭时的正常执行。

## 后续：Scenario

- Override 仅作用于本次 Scenario 及其全部子调用，不修改 Runtime Providers，也不深拷贝业务对象或增加依赖生命周期容器。
- 支持类型关联的 Action 输入、Provider Override、结果/异常 Mock、Fixture Setup/Cleanup，以及执行结果和 Trace 检查。
- Fixture 清理在成功、失败和取消路径中均执行；业务失败和清理失败同时发生时保留两者的信息。
- 生产环境默认关闭 Mock；调试环境开关不替代业务的服务端鉴权。

验收重点是同一 Action 的不同分支、并发 Scenario 隔离，以及普通业务 Dispatch 不受覆盖影响。

## 后续：DevTools 与其他边界

调试 UI 与 Core 分包，正常导入 Core 时不包含调试界面。UI 框架与连接方式在实施时确定。浏览器兼容性页仅作为验收工具，不视为 DevTools。Schema、动态注册、调度策略和 Provider 生命周期不在本次 Core 收尾中扩展。
