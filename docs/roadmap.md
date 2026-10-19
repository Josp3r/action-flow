# 实施进度与后续计划

## 当前结论（2026-10-19）

**Milestone 1：Core Runtime 和 Milestone 2：Execution & Trace 已完成。整体 MVP 尚未完成，下一阶段为 Scenario。** Core 已提交并推送至 main（`b85fa13`）；本轮继续实现了执行追踪、Middleware 与协作取消。

按 [项目成功标准](project-background.md#15-项目成功标准) 对照：

- **统一管理业务行为：已验证。** Registry 可列出、查询 Action，并拒绝重复 ID。
- **独立执行业务行为：已验证。** Dispatch 和 Providers 可脱离页面运行，显式 Contract 支持完整类型安全的嵌套调用，结果及原始异常正确传播。
- **稳定复现业务分支并观察完整 Trace：部分完成。** 可以观察嵌套、并发调用的执行记录，但 Scenario、执行级依赖覆盖与 Mock 尚未实现。现有成功/失败 Demo 不能替代场景复现验收。

## 阶段 1：Core Runtime（已完成）

已实施：

- pnpm 工作区、严格 TypeScript、ESM 构建与 Changesets 配置。
- `defineAction`、`createActionFactory`、唯一的 `defineModule(namespace, actionsMap)`。
- 静态类型安全的 `runtime.dispatch` 和通过 `createActionFactory<Providers, Contract>()` 获得的类型安全 `ctx.dispatch`。
- 所有静态模块的 Providers 需求检查。
- 契约目标完整性、输入兼容性、解析后输出兼容性与多契约冲突检查。
- 明确的静态注册边界：契约模式要求已知模块元组与字面量命名；未声明 Contract 的接入方式继续保留动态 Context 边界。
- 只读 Registry、独立冻结执行上下文、同步/异步结果等待与原始异常传播。

验收证据：正反类型用例、25 项运行时测试、可运行的登录/会话嵌套示例、实际安装包的外部消费项目。详见 [API](api-design.md) 和 [类型设计](RFC.md)。

## 阶段 2：Execution & Trace（已完成）

已实施：

1. 每次 Dispatch 的 Execution ID、根 Trace ID、闭包传播的父子关系，覆盖未知 ID 和预取消调用。
2. running/success/error/cancelled 生命周期、时间与耗时、冻结记录和 start/finish 事件。
3. 有容量上限的内存记录、查询/订阅、观察者异常隔离、可配置详情采集及脱敏；回收或清空的记录不会在结束后恢复。
4. 洋葱 Middleware、短路、错误恢复、重复/迟到 next 的协议检查，以及 AbortSignal 的继承、组合和清理。
5. 显式环境配置：默认 production 关闭追踪，development/test 开启结构追踪；正常 Dispatch 始终可用。
6. `pnpm example:trace`：两条并发成功树、父子错误树、执行中取消树，11 次开始和 11 次结束事件。

验收：59 项测试覆盖原有 Core 与上述执行边界，正反类型检查、真实浏览器 11 项检查、实际 tarball 的嵌套追踪/取消和导出类型检查通过。Node 22、24 均已验证。详细边界见 [Execution & Trace](execution-trace.md)。容量不足时树可能不完整；取消为协作机制，不承诺强制终止或回滚副作用。

## 阶段 3：Scenario（下一步）

在执行上下文和 Trace 稳定后实施：

1. 类型关联的 Scenario 定义和输入。
2. 仅作用于本次执行及子调用的 Provider Override、结果/异常 Mock。
3. Fixture Setup/Cleanup、成功/失败/取消路径的释放和组合错误处理。
4. Scenario 标识、执行结果和 Trace 检查，以及生产环境默认关闭 Mock 的边界。
5. 同一 Action 的成功、失败和冲突分支示例；并发 Scenario 与普通 Dispatch 的隔离测试。

完成标准：业务分支可稳定复现，覆盖不污染其他并发执行，也不引入内置 State 管理。

## 阶段 4：DevTools（待实施）

在 Scenario 和 Trace 能力存在后，新增实际承载代码的独立调试包：

- Action 列表、搜索和 Payload 编辑。
- 单次执行、Scenario 选择与结果检查。
- 可展开的 Trace 调用树，显示状态、耗时和异常关联。
- 独立开发入口与正常业务构建的隔离。

完成标准：开发者无需重复页面前置操作即可调试指定 Action，并查看其 Scenario 和执行链路。UI 框架、连接方式在实施时确定。当前浏览器兼容性页不算作 DevTools。

## 阶段 5：工程化与发布（部分完成，贯穿各阶段）

已有：

- ESM 构建、Export Map、类型声明、零运行时依赖检查。
- Node.js 22.23.1、24.18.0 的本地测试及实际 tarball 外部消费项目检查。
- 不依赖浏览器全局对象的包导入与模拟独立 SSR 请求测试；尚未声称已验证具体 SSR 框架。
- 浏览器直接导入 ESM 的验收页，11 项 Core/Trace/Middleware/取消检查已通过。Contract 是编译期能力，由类型用例与打包消费项目验证。
- 可重复的微基准 `pnpm bench`，覆盖普通函数、关闭追踪的 Dispatch、开启结构追踪的 Dispatch，并检查保留数量。不据此推断真实应用性能。
- CI 矩阵、手动打包与上传构建产物工作流，以及 `pnpm release:pack`。尚未运行远端工作流或发布 npm。

剩余：随 Trace、Scenario 和 DevTools 增加对应的兼容性、性能与打包测试；完成真实调试 UI 的浏览器交互验收，确认版本策略、发布目标和发布流程。当前包仍为 0.0.0。

## 本轮检查

- `pnpm check`：构建、类型检查、59 项运行时测试。
- `pnpm example`：类型安全的跨模块返回值使用、登录成功与嵌套错误传播。
- `pnpm example:trace`：并发、错误与取消调用树以及生命周期事件。
- `pnpm check:package`：安装实际打包产物后，验证 ESM、父子追踪、取消、公开契约和执行类型、错误 ID/输入/漏注册/信号类型的负向用例，以及 README/许可证和零运行时依赖。

以上检查只证明已实施的 Core 与 Execution & Trace，不将 Scenario 或 DevTools 计入完成状态。
