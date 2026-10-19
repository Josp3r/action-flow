# Scenario：独立复现业务分支

`@action-flow/scenario` 是只依赖 Core 的独立调试包，将输入、Provider 覆盖、Action Mock 和 Fixture 组合成可重复执行的定义，不拥有应用 State。

## 定义与执行

```ts
import { createScenarioRunner } from "@action-flow/scenario";

// runtime 使用 environment: "development" 或 "test" 创建。
const runner = createScenarioRunner(runtime);
const success = runner.defineScenario({
  id: "login.success", action: "session.start", input: { name: "Ada" },
  providers: () => ({ session: { user: undefined } }),
  mocks: { "auth.login": { type: "return", value: { id: "fixture-user", name: "Ada" } } },
  setup(ctx) { ctx.defer(() => { ctx.providers.session.user = undefined; }); },
});
const result = await runner.run(success);
if (result.status === "success") console.log(result.output); // Action 的解析后输出类型
else console.log(result.error); // 保留原始抛出值
console.log(result.trace, result.cleanupErrors);
```

完整示例见 [Scenario Demo](../playground/basic/scenario.ts)，运行 `pnpm example:scenario` 查看登录成功、网络失败和会话冲突三种分支。

`runner.defineScenario` 是唯一的定义入口。绑定 Runtime 后，Action ID、输入和 Mock 返回值均由注册信息推导。无输入的 Action 可省略 `input`；显式 `string | undefined` 仍需写 `input: undefined`。每次创建新输入时使用 `inputFactory(ctx)`，不能同时提供 `input`。函数 Payload 直接写在 `input` 中。

重复 Scenario ID、未知目标或静态 Mock ID、非法 Mock 描述在定义时拒绝。`runner.get(id)` 查询定义，`runner.list()` 返回冻结的列表；运行只接受同一个 Runner 注册的定义。定义、Provider 顶层绑定和静态 Mock 描述保存为冻结的浅快照。

## 覆盖与 Mock

`providers` 接受 `Partial<Providers>` 或每次运行的异步 Factory。覆盖替换顶层绑定，沿本次执行的全部子 Dispatch 传播，不修改 Runtime 的 Providers、Registry 或 Handler。

业务对象保留原引用，不进行深拷贝或深合并。要让重复、并发运行拥有独立的可变 Store、输入和 Mock 值，分别使用 `providers`、`inputFactory` 和 `mocks` Factory。未覆盖的依赖仍可能共享。

Mock 按 Action ID 配置 `{ type: "return", value }` 或 `{ type: "throw", error }`。返回值必须符合目标 Action 的解析后输出类型；抛出值可为任意值，包括 `undefined`。Mock 在作用域 Middleware 中跳过真实 Handler，但仍通过正常 Trace 和取消检查。Runtime 原有 Middleware 包裹 Mock，仍可转换结果或恢复错误。

## Fixture 生命周期

每次运行按顺序执行：

1. 检查调试开关、定义身份和预取消信号。
2. 解析 Provider Factory；此时上下文包含 Runtime 基础 Providers。
3. 创建独立作用域，解析 Mock Factory；后续上下文包含覆盖后的 Providers。
4. 进入 `setup(ctx)`，随后解析 `inputFactory(ctx)` 并 Dispatch 根 Action。
5. 等待根调用和已启动的后代调用结束。
6. 若进入了 setup 阶段，执行定义的 `cleanup(ctx)`；然后逆序执行所有 `ctx.defer(release)`。

上下文含 `providers`、`scenarioId`、唯一的 `runId` 和 `signal`。分配资源后立即注册 defer，可保证 setup 后续失败时仍释放已有资源。Provider/Mock Factory 也能登记 defer；如果它们在 setup 前失败，仅执行已登记的释放函数，跳过定义 cleanup。清理开始后禁止继续登记 defer。

每个清理函数都尝试执行，单个失败不会跳过其余释放。若没有清理失败，保留原始主错误；否则返回 `status: "error"` 和 `AggregateError`，依次包含主错误（如有）、定义 cleanup 错误和 defer 错误，`cause` 保留主错误。`cleanupErrors` 单独列出释放失败。抛出 `undefined` 也按失败处理。

`runner.run(scenario, { signal })` 使用协作取消。预取消不进入任何 Factory/Hook；执行中取消仍等待 Handler 和后代结束后再清理。不会强制结束忽略信号的 Promise，也不回滚副作用。作用域关闭期间，活跃子调用可继续派生后代；从已结束调用泄漏的 Dispatch 在关闭后拒绝，避免在 Fixture 释放后继续执行。

根调用的结果决定执行是否成功。被捕获或脱离等待链的子调用错误保留在 Trace 中，Runner 等待其终结，但不自动将其升级为根调用失败。

## 结果与追踪

成功结果含 `status: "success"` 和类型关联的 `output`；失败或取消含 `error`。所有结果含 `scenarioId`、`runId`、`trace`、`droppedRecords`、`cleanupErrors`。若尚未进入 Dispatch（例如 setup 失败或预取消），没有根 `executionId`、`traceId`，Trace 为空。

根和子执行的 Context、ExecutionRecord 均带 `scenarioId`、`scenarioRunId`。记录同时发送给 Runtime 与本地 Trace；两个存储各自应用容量和详情采集策略，详情不会因另一个存储开启采集而泄漏。Runtime 支持 `trace.list({ scenarioId })`、`trace.list({ scenarioRunId: result.runId })` 查询。

本地 Trace 默认始终开启，容量 1,000，只保存结构和时间；Runtime Trace 关闭也不影响它。通过 `createScenarioRunner(runtime, { trace: { maxRecords, capture, redact } })` 调整，使用与 Core 相同的快照和脱敏规则。超过容量丢弃旧记录，并报告 `droppedRecords`；根 ID 独立保留。详见 [Execution & Trace](execution-trace.md)。

## 环境与底层作用域

Runtime 默认 production，调试执行默认关闭；development/test 默认开启，可用 `allowDebug` 显式覆盖。`trace: true` 只开启追踪。禁止调试或传入外部定义时，run 在生命周期回调前拒绝；普通 Dispatch 继续可用。调试开关不替代远程接口的鉴权。

Core 的 `runtime.createDebugScope({ providers?, middleware?, trace?, scenario? })` 返回 `providers`、`dispatch`、`trace` 和幂等 `close()`。close 拒绝新根调用、等待已启动后代结束；关闭后执行拒绝为 `DebugScopeClosedError`。禁止调试时创建作用域抛出 `DebugDisabledError`。Scenario 在该接口上管理定义和 Fixture，Core 不依赖 Scenario。

## 浏览器验证

运行 `pnpm example:browser` 后打开验收页，自动执行 16 项检查。也可在控制台运行：

```js
const { runner, scenarios, runtime } = actionFlowDemo;
await runner.run(scenarios.success);
await runner.run(scenarios.mocked);
await runner.run(scenarios.conflict);
runtime.trace.list({ scenarioId: "browser.conflict" });
```

这仍是兼容性验收页；Action 列表、Payload 编辑和可展开调用树的 DevTools 属于下一里程碑。
