# 实施进度与后续计划

## 当前结论（2026-10-19）

**Milestone 1：Core Runtime 已完成。整体 MVP 尚未完成，下一阶段为 Execution & Trace。** 本次按启动文档的严格验收，补齐了显式 Contract 模式下的跨模块类型安全，以及契约与实际注册实现的一致性检查。

按 [项目成功标准](project-background.md#15-项目成功标准) 对照：

- **统一管理业务行为：已验证。** Registry 可列出、查询 Action，并拒绝重复 ID。
- **独立执行业务行为：已验证。** Dispatch 和 Providers 可脱离页面运行，显式 Contract 支持完整类型安全的嵌套调用，结果及原始异常正确传播。
- **稳定复现业务分支并观察完整 Trace：未完成。** 尚未实现执行记录、Scenario、执行级依赖覆盖与 Mock。现有成功/失败 Demo 不能替代这项验收。

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

## 阶段 2：Execution & Trace（下一步）

推进顺序：

1. 定义执行记录、生命周期、Trace 查询/订阅及容量配置接口；默认不记录业务输入、输出和错误详情。
2. 为每次 Dispatch 生成执行标识，使用调用上下文传播父子关系和 Trace ID。
3. 实现有容量上限的内存记录、可配置采集及脱敏，隔离观察者错误。
4. 接入 Middleware 和 AbortSignal，定义并测试短路、错误恢复、重复 next 与协作取消。
5. 提供包含并发分支的可运行示例，证明调用关系不会串线。

完成标准：可还原嵌套、并发执行的真实调用关系，准确记录状态与耗时；关闭追踪时仍可正常执行 Action。当前没有这部分实现，不将普通的并发调用测试计作 Trace 验收。

## 阶段 3：Scenario（待实施）

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
- 浏览器直接导入 ESM 的验收页，先前版本的 7 项运行检查已通过。Contract 是编译期能力，由类型用例与打包消费项目验证。
- 可重复的微基准 `pnpm bench`，不据此推断真实应用性能。
- CI 矩阵、手动打包与上传构建产物工作流，以及 `pnpm release:pack`。尚未运行远端工作流或发布 npm。

剩余：随 Trace、Scenario 和 DevTools 增加对应的兼容性、性能与打包测试；完成真实调试 UI 的浏览器交互验收，确认版本策略、发布目标和发布流程。当前包仍为 0.0.0。

## 本轮检查

- `pnpm check`：构建、类型检查、25 项运行时测试。
- `pnpm example`：类型安全的跨模块返回值使用、登录成功与嵌套错误传播。
- `pnpm check:package`：安装实际打包产物后，验证 ESM 执行、公开契约类型、错误 ID/输入/漏注册的负向用例，以及 README/许可证和零运行时依赖。

以上检查只证明已实施的 Core，不将未来里程碑计入完成状态。
