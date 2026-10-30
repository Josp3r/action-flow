# DevTools：浏览器调试工作台

`@action-flow/devtools` 是独立的开发工具包。它通过浏览器内直接引用 Runtime/Runner 执行调试，不启动远程服务，不依赖 UI 框架，不在导入时挂载或写入全局变量。

## 先看效果

运行 `pnpm example:devtools`，打开 `http://127.0.0.1:4173/devtools/`。

1. 默认选中 `session.start`，编辑 JSON 中的 name，点击「运行 Action」。
2. 在「执行方式」选择 `login.success`、`login.network-error` 或 `login.conflict`，点击「运行 Scenario」。输入框禁用，执行使用场景定义的输入、依赖和 Mock。
3. 检查结果、状态和 Trace 树；展开「查看调用详情」读取 Execution/Trace/父 ID，以及显式开启采集的详情。
4. 选择 `demo.slow` 运行，再点击「取消所选运行」。也可继续运行其他 Action，再从历史选择要取消的那一项。
5. `login.setup-error` 展示进入 Dispatch 前的失败；`login.cleanup-error` 展示业务成功后释放失败的组合错误。

Demo 使用内存 API 和 Store，接入代码见 [浏览器示例](../playground/browser/devtools.js)。Core/Scenario 的兼容性页仍在根路径；DevTools 的可重复交互验收在 `/playground/browser/devtools-checks.html`。

## 接入应用

```ts
import { mountDevTools } from "@action-flow/devtools";

const tools = mountDevTools({
  target: document.getElementById("devtools")!,
  runtime,
  runner, // 可省略；提供时必须属于同一个 Runtime
  initialPayloads: { "session.start": '{"name":"Ada"}' },
});

// 页面/开发入口退出时调用；请求取消并等待已启动任务释放资源。
await tools.unmount();
```

仅在应用的开发入口动态导入并显式挂载该包。Core、Scenario 不依赖 DevTools，正常导入它们不会加入 UI。Runtime 必须允许调试：development/test 默认允许，production 默认禁止，可用 `allowDebug` 显式覆盖。默认禁止时，在写入 DOM 或执行业务前抛出 `DebugDisabledError`；此策略不替代远程接口鉴权。

面板用 Shadow DOM 隔离样式，挂载到调用方指定的 HTMLElement，支持多个独立实例。`refresh()` 重新读取 Scenario 列表和当前视图；Action 注册表仍是静态快照。不会自动注册 Console 对象，Demo 的 `actionFlowDevtoolsDemo` 仅由示例入口显式创建。

## 输入与执行

Action 可按名称、描述和标签搜索；切换 Action 保留各自的输入草稿。`initialPayloads` 是按已注册 ID 索引的 JSON 字符串，支持空字符串表示 `undefined`。非法 JSON 和超过 100,000 字符的输入在执行前拒绝，不调用 Handler、不新增运行记录。

JSON 编辑器是动态边界：只检查语法和注册 ID，不通过 TypeScript 类型自动生成或校验 Schema。业务参数校验由应用/Handler 负责。直接执行使用基础 Providers 和原有 Middleware，因此具有正常业务副作用；Scenario 使用其已定义的覆盖和 Fixture 生命周期，不被编辑器改写。

每次运行独立保留状态、结果、Trace 和取消信号。支持并发运行和历史选择；异步完成不会抢走当前选择。取消是协作请求，执行保持 running，直到 Handler、后代和 Fixture 清理结束；忽略信号的 Promise 会推迟取消和卸载完成。

`unmount()` 立即移除 DOM、取消订阅，随后请求取消并等待已启动工作终结，返回幂等 Promise。不会将尚在运行的任务误记为完成，也不会提前释放 Scenario Fixture。

## Trace、结果与容量

直接执行使用独立 Core 调试作用域，即使 Runtime Trace 关闭也能看到树。Scenario 通过 `runner.run(definition, { onTrace })` 的本次事件流更新树，详情采集遵守 Runner 配置。面板不混入其他普通 Dispatch 的历史；Runtime 全局 Trace 仍可独立查询这些调试执行。

默认最多保留 20 次运行（可设 `maxRuns`，范围 1–100），每次 200 条执行记录（可设 `trace.maxRecords`，范围 1–1,000）。优先回收较早的已完成运行；如果容量全被活跃任务占用，新执行会提示等待或取消。清空只移除已完成历史。执行记录回收会显示数量，缺少父记录的子调用显示为可见根；UI 最多绘制 40 层后代，深层链仍可通过 Controller 的保留记录检查。

结果/错误使用 Core 公开的 `snapshotTraceValue(value)`：脱离原对象、有容量和深度限制、隐藏常见敏感字段、不执行 getter/toJSON、不保留 Error stack，支持 AggregateError 的 errors/cause。不会持有或冻结原始业务输出。来自 Action 的文本通过 textContent 显示，不解析为 HTML。

直接执行的 Trace 默认只采集结构和时间；需要时在挂载参数中配置 `trace.capture`、`trace.redact`，它们只影响直接执行的 Trace。Scenario 使用 Runner 的采集配置。结果区使用标准快照规则；不能假设字段名规则能识别任意字符串中的业务秘密。记录不写入浏览器存储，不发送网络请求。

## 自定义前端

`createDevToolsController({ runtime, runner?, maxRuns?, trace? })` 是面板使用的控制层，可在没有 DOM 的 Node 环境导入和运行：

- `actions`、`scenarios()`：Action 和 Scenario 元数据。
- `runs()`：冻结的运行快照，包括执行状态、ID、结果/错误、Trace、回收数量及清理错误。
- `subscribe(listener)`：订阅更新，返回取消订阅函数；观察者异常不影响执行。
- `runAction(id, jsonText?)`、`runScenario(id)`：返回本次终态快照，未知目标或格式错误会拒绝。
- `cancel(runId)`：请求取消，返回是否发出请求。
- `clear()`：移除已完成运行。
- `dispose()`：停止观察、请求取消并等待已启动工作，幂等且禁止后续新执行。

## 验收与当前范围

Node 22/24 的构建、类型检查、108 项测试以及三个 tarball 的实际外部消费检查覆盖控制层、类型关联、并发隔离、取消/释放、截断和无 DOM 导入。浏览器中，原有 Core/Scenario 16 项检查及 DevTools 17 项交互检查通过；交互页还覆盖 XSS 文本展示、搜索、输入草稿、错误路径、历史和卸载。浏览器检查页目前由本地浏览器运行，未声称已进入远端 CI 自动浏览器任务。

已完成本地 Action → 输入/Scenario → 执行 → 结果/调用树闭环。当前不包含远程连接、Schema 表单生成、Timeline/Flow、多进程调试、持久化历史或生产诊断服务。Core、Scenario、DevTools 已以 `0.1.0` 发布到公共 npm，并通过实际安装后的运行时和类型消费检查；发布流程见 [发布说明](releasing.md)。
