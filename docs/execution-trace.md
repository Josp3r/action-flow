# Execution、Trace、Middleware 与取消

## 开启追踪

```ts
const runtime = createRuntime({
  providers,
  modules: [auth, account],
  environment: "development",
  trace: { maxRecords: 1_000 },
});

const unsubscribe = runtime.trace.subscribe(({ type, record }) => {
  console.log(type, record.actionId, record.status);
});
await runtime.dispatch("account.start", input);
unsubscribe();

const executions = runtime.trace.list();
const tree = runtime.trace.getTrace(executions[0]!.traceId);
```

`environment` 支持 `development`、`test`、`production`。默认值为 `production`，不读取 `NODE_ENV` 或浏览器全局配置。Development/Test 默认开启结构追踪，Production 默认关闭；显式的 `trace: true`、`trace: false` 或配置对象可以覆盖环境默认值。正常 Dispatch 在任何环境均可执行。

## 执行上下文与生命周期

每次 Dispatch，包括未知 ID 或执行前已取消的调用，均分配独立的 `executionId`。根调用生成 `traceId`；子调用沿 `ctx.dispatch` 继承 Trace ID，并使用当前执行 ID 作为 `parentExecutionId`。关联通过上下文闭包保存，不依赖全局可变的当前执行对象，因此并发根调用和并发子调用不会串线。

Handler 上下文现在包含 `providers`、`dispatch`、`actionId`、`executionId`、`traceId`、可选 `parentExecutionId` 和 `signal`。关闭追踪时这些上下文字段仍然存在。

执行状态从 `running` 进入 `success`、`error` 或 `cancelled`。每次执行分别产生 `start`、`finish` 事件。`startTime` 和 `endTime` 使用 Unix 毫秒；`duration` 使用单调时钟计算，缺少该时钟时回退到普通时间。结束时间和时长仅出现在终态记录中。

状态表示本次 Dispatch 最终返回的结果：Middleware 恢复错误后正常返回会记录为成功。未捕获的子调用错误在子调用和父调用分别记录；若只有子信号取消，未取消的父执行收到其异常后记录为 `error`。本执行信号已取消时，终态记录为 `cancelled`；业务实际抛出的原始值仍原样传播。

## 读取与保留记录

- `trace.enabled`：追踪是否开启。
- `trace.size`：当前保留记录数。
- `trace.get(executionId)`：查询单次执行。
- `trace.list({ traceId?, actionId?, status? })`：按开始顺序查询记录。
- `trace.getTrace(traceId)`：读取同一调用链的记录，通过父 ID 还原树。
- `trace.droppedRecords`：因容量被移除的记录数。
- `trace.clear()`：清空记录并重置丢弃计数，不取消任务或移除订阅。

默认最多保留 1,000 条；配置必须为正安全整数。容量满时移除最早记录，正在执行的记录也可能被移除，因此容量不足时调用树可能不完整。被移除或清空的记录不会在执行结束后重新写回。订阅仍能收到这些执行的结束事件，可供外部消费方实时处理。

查询结果、事件及记录均为冻结快照，之前读取的 `running` 记录不会被原地改成终态；重新查询获取新状态。订阅不会重放历史事件，取消订阅可重复调用。同步观察者抛错和异步观察者拒绝都不会改变业务结果。关闭追踪时不保留记录、不发送事件。

## 输入、输出与错误详情

默认不采集这些业务详情。需要时显式开启：

```ts
trace: {
  maxRecords: 200,
  capture: { input: true, output: true, error: true },
  redact(value, field, record) {
    if (field === "input") return { action: record.actionId, omitted: true };
    return value;
  },
}
```

采集会创建脱离原始业务对象的冻结数据快照，不执行 getter 或 `toJSON()`。常见的 password、token、secret、authorization、cookie、API key、credential 字段自动替换为 `[REDACTED]`；自定义 `redact` 接收到的是已经处理过的快照。业务输入、输出以及抛出的错误本身不会被修改或冻结。

快照限制深度为 8、单个数组/对象最多 100 项、字符串最多 2,048 字符，并有每次采集 1,000 个值的总预算；循环、访问器、无法检查的值和超出限制的部分会替换为标记。错误默认只采集可安全读取的数据字段及 name/message，不保留原始错误引用或 stack。

自动处理只识别字段名，无法识别任意字符串内的密码或业务隐私。启用详情采集时应按业务数据结构配置脱敏。`redact` 为同步接口，抛错或返回 Promise 时会省略该字段，避免采集失败退回原始值；Promise 的拒绝也会被处理。

## Middleware

```ts
middleware: [
  async (ctx, next) => {
    const result = await next();
    console.log(ctx.actionId, ctx.executionId);
    return result;
  },
]
```

Middleware 按注册顺序进入、反向退出，并对嵌套 Dispatch 分别执行。上下文包含 Handler 的全部执行字段和未知类型的 `input`，可以通过 `ctx.dispatch` 发起具有正确父子关联的子调用。

Middleware 必须 `await` 或 `return next()`，且每层只能调用一次。重复调用或在该 Middleware 已结束后调用会拒绝为 `MiddlewareNextError`。如果 Middleware 在仍有未完成的 next 工作时提前返回或抛错，Runtime 会先等待已启动的下游结束，再报告协议错误或传播原始错误，不会将仍在运行的处理链误记为完成。

允许短路返回和捕获异常后恢复。这个入口处理所有 Action，输入和结果是动态边界：自定义短路或替换结果时，调用方负责维持相应 Action 的输出契约。Core 不会将它当作运行时 Schema 验证器。

## AbortSignal 协作取消

```ts
const controller = new AbortController();
const pending = runtime.dispatch("account.start", input, {
  signal: controller.signal,
});
controller.abort(new Error("User cancelled"));
await pending; // 拒绝；调用方应捕获并处理取消原因
```

Dispatch Options 位于第三个参数；无输入 Action 写作 `dispatch("app.ping", undefined, { signal })`。Handler 可以把 `ctx.signal` 交给支持 AbortSignal 的 API。

未传子信号时直接继承父信号；显式子信号会与父信号组合，任一取消都会取消该子执行，不能借此绕过父级取消。组合信号监听器在执行结束时释放。不同根调用使用独立信号。

Runtime 在进入处理链、进入 Handler、进入每层 Middleware 和成功返回前检查取消。执行前已取消时不调用 Handler。取消不会回滚已发生的副作用，也不能强制终止不处理信号的 Promise；这类执行保持 running，直到下游实际结束后再拒绝并记录 cancelled。请不要据此认为取消完成意味着外部系统回滚了业务操作。

## 可运行验收

`pnpm example:trace` 展示两条并发成功调用树、父子异常传播、执行中取消和生命周期事件数。`pnpm example:browser` 提供真实浏览器中的 11 项 Core/Trace 验收。它们是开发示例与检查入口，尚不是 DevTools。
