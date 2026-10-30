# 实施进度与后续计划

## 当前结论（2026-10-30）

**Milestone 1–4：Core Runtime、Execution & Trace、Scenario、DevTools 已完成。MVP 功能闭环已验收，三个包的公共 npm `0.1.0` 首发已完成。** 已从 Registry 实际安装并验证运行时、导出类型及三包协作。

按 [项目成功标准](project-background.md#15-项目成功标准) 对照：

- **统一管理业务行为：已验证。** Registry 可列出、查询 Action，并拒绝重复 ID。
- **独立执行业务行为：已验证。** Dispatch 和 Providers 可脱离页面运行，显式 Contract 支持完整类型安全的嵌套调用，结果及原始异常正确传播。
- **稳定复现业务分支并观察完整 Trace：程序接口与浏览器流程已验证。** 可在面板选择同一个登录 Action 的成功、网络错误和冲突分支，检查结果、父子关系、状态和耗时，支持取消、Fixture 错误及并发隔离。容量不足时 Trace 截断并报告丢弃数。

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

## 阶段 3：Scenario（已完成）

已实施：

1. 类型关联的 Scenario 定义和输入。
2. 仅作用于本次执行及子调用的 Provider Override、结果/异常 Mock。
3. Fixture Setup/Cleanup、成功/失败/取消路径的释放和组合错误处理。
4. Scenario 标识、执行结果和 Trace 检查，以及生产环境默认关闭 Mock 的边界。
5. 同一 Action 的成功、失败和冲突分支示例；并发 Scenario 与普通 Dispatch 的隔离测试。

6. 独立包 `@action-flow/scenario`，通过 `createScenarioRunner(runtime)` 保留唯一的定义入口。
7. Provider、Mock、Input Factory 和逆序 defer，等待已启动后代后释放 Fixture，保留主错误与全部清理错误。
8. 本地与 Runtime Trace 分别应用容量和采集策略，Scenario/Run 查询及根 ID 保留。

验收：共 89 项 Core/Scenario 测试及正反类型用例通过，浏览器 16 项检查通过，实际安装两个 tarball 后的 Mock、Fixture、Trace、生产默认禁用及导出类型检查通过。Node 22、24 均已验证。业务对象保持引用语义，可变状态隔离需使用 Factory，不进行深拷贝或内置 State 管理。详见 [Scenario](scenario.md)。

## 阶段 4：DevTools（已完成）

独立包 `@action-flow/devtools`，原生 DOM/Shadow DOM，浏览器内直接连接 Runtime/Runner：

- Action 列表、搜索和 Payload 编辑。
- 单次执行、Scenario 选择与结果检查。
- 可展开的 Trace 调用树，显示状态、耗时和异常关联。
- 独立开发入口与正常业务构建的隔离。
- 独立且有容量上限的运行历史、并发执行、所选任务取消、截断提示和安全文本展示。
- 无 DOM 控制层、Scenario 归属校验、按次运行的实时 Trace，以及卸载时取消并等待资源释放。

已完成端到端流程：选 Action → 编辑 JSON Payload → 执行或选择 Scenario → 检查结果与调用树。调试入口显式挂载，生产默认禁止，Core/Scenario 不引入 UI 依赖。

验收：Node 22、24 构建、类型检查、108 项测试和三个 tarball 外部消费检查通过。浏览器 DevTools 17 项交互检查通过，并手动验证成功、非法 JSON、冲突和取消。`pnpm example:devtools` 提供真实调试工作台；原有兼容性页继续独立保留。详见 [DevTools](devtools.md)。

## 阶段 5：工程化与发布（部分完成，贯穿各阶段）

已有：

- ESM 构建、Export Map、类型声明、零运行时依赖检查。
- Node.js 22.23.1、24.18.0 的本地测试及实际 tarball 外部消费项目检查。
- 不依赖浏览器全局对象的包导入与模拟独立 SSR 请求测试；尚未声称已验证具体 SSR 框架。
- 浏览器直接导入三个包 ESM，16 项 Core/Scenario 和 17 项 DevTools 交互检查通过。Contract 是编译期能力，由类型用例与打包消费项目验证。
- 可重复的微基准 `pnpm bench`，覆盖普通函数、关闭追踪的 Dispatch、开启结构追踪的 Dispatch，并检查保留数量。不据此推断真实应用性能。
- CI 矩阵、手动打包与上传构建产物工作流，以及 `pnpm release:pack`。远端工作流运行结果仍待核验；公共 npm 首发已完成。

已完成三个包的 `0.1.0` 版本、包元数据、Changesets 更新记录和手动发布说明，并核对公共 Registry 的 latest 标签、依赖与 tarball integrity。仓库外从 npm 实际安装后三包运行与正反类型检查通过。

剩余：核验远端 CI，并持续完善接入文档和真实项目反馈。浏览器交互页已本地验证，尚未接入 CI 的自动浏览器任务；尚未声称验证具体 SSR 框架、远程连接或生产诊断。

后续版本使用 Changesets 记录变更，按 [发布说明](releasing.md) 验证 tarball、发布并检查 Registry 消费结果。

## 本轮检查

- `pnpm check`：三个包构建、类型检查、108 项运行时测试。
- `pnpm example`：类型安全的跨模块返回值使用、登录成功与嵌套错误传播。
- `pnpm example:trace`：并发、错误与取消调用树以及生命周期事件。
- `pnpm example:scenario`：同一 Action 的三个分支、Fixture 释放以及普通 Dispatch 不受 Mock 影响。
- `pnpm check:package`：实际安装三个 tarball，验证运行时、无 DOM 导入、公开类型、Mock 隔离、Fixture、实时 Trace、生产默认禁用、README/许可证及包依赖。
- `pnpm release:pack`：三个可安装产物输出至 artifacts/，不发布 npm。
- `pnpm example:devtools`：真实 UI 工作台，另有 17 项可重复的浏览器交互检查。

以上检查证明 Milestone 1–4 的功能闭环；三个包已完成公共 npm `0.1.0` 首发及 Registry 实际安装验收，远端 CI 运行结果仍待核验。
