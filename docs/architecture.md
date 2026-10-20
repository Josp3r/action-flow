# Core 结构

Core 负责显式注册的业务行为，不拥有应用状态，也不会拦截普通 JavaScript 函数调用。

## 类型与注册

`action` 定义 Handler、输入/输出和执行上下文；`module` 将 Action Key 与 Namespace 组合；`dispatch` 从静态模块集合计算公共调用签名；`registry` 校验全局 ID 唯一并保存 Handler 与元数据；`runtime` 连接依赖和执行入口。

`contract` 为在 Runtime 汇总之前定义的 Handler 提供跨模块调用签名。Factory 将 Contract 信息通过类型标记保留到模块推导中；Runtime 组装时检查每份契约的目标是否存在、实现是否接受对应输入，以及解析后的输出是否兼容。检查仅发生在编译期，不增加运行时字段或处理阶段。Contract 模式要求静态模块元组和可确定的命名，以免把可能缺失的动态注册集合误判为完整。

命名要求为无空白、非空的点分段字符串。Namespace 和 Action Key 均允许多级分段。`a` + `b.c` 与 `a.b` + `c` 组成同一 ID，会被判定为冲突。内部使用 Map，避免继承属性被当作 Action。

## 执行

每次 Dispatch 分配执行标识，创建独立的冻结上下文，记录开始事件并检查取消，再通过 Middleware 执行 Handler，等待同步或异步返回后记录终态。未知 ID 返回拒绝的 Promise，也可形成错误执行记录。Handler 抛出的原始值直接传播，包括嵌套错误；父 Action 和 Middleware 可自行捕获并恢复。

上下文包含 Providers、Dispatch、Action/Execution/Trace ID、父 ID 和 AbortSignal。子 Dispatch 通过闭包保存父上下文，不使用隐式全局当前执行对象。根调用的信号彼此独立；子调用继承父信号，或与显式子信号组合。

Trace 组件提供有容量上限的内存存储、冻结快照、查询与订阅；默认只采集结构和时间，观察者或脱敏回调失败不传播到业务执行。生产默认关闭追踪，Development/Test 默认开启，可显式覆盖。容量回收和 clear 不取消业务，也不会在任务结束时恢复已删除记录。详见 [执行与追踪边界](execution-trace.md)。

## 依赖边界

创建 Runtime 时复制并冻结 Providers 顶层绑定，防止替换外部配置对象中的属性影响已创建的 Runtime。依赖对象自身保持原引用，因此 API 客户端、Router、外部 Store 的身份和行为得以保留。

每个 Runtime 拥有独立 Registry 和依赖绑定。外部业务对象若被调用方共享，其状态也会共享；SDK 不进行深拷贝。Scenario 使用 Core 调试作用域覆盖顶层绑定，依靠闭包向后代传播，不修改全局 Handler 或 Providers。通过 Factory 创建可变依赖可让并发运行持有独立实例。

## Scenario 分层

`@action-flow/scenario` 只依赖 Core 公开接口，负责类型定义、注册、Provider/Mock Factory、Fixture 和结果封装。Mock 是作用域内追加的 Middleware，Runtime 原有 Middleware 仍包裹它。根和后代同时写入 Runtime 与本地 Trace，各自应用容量和采集策略。

作用域在开始执行前登记 Promise，避免同步观察者关闭作用域时遗漏任务。关闭先拒绝新根调用，再等待所有已启动任务；活跃后代可派生子调用，已结束调用泄漏的 Dispatch 在关闭后拒绝。Runner 待后代终结后执行 cleanup 和逆序 defer，收集全部释放错误。生产默认禁止调试，在创建作用域和运行场景前检查。详见 [Scenario 生命周期](scenario.md)。

## 打包边界

`@action-flow/devtools` 依赖 Core/Scenario 的公开接口，使用原生 DOM 和 Shadow DOM 显式挂载。控制层不访问 DOM，可独立测试和导入；挂载层只在 mount 时读取目标的 ownerDocument。Core/Scenario 不反向依赖 UI。直接执行由调试作用域提供实时 Trace，Scenario 使用本次 onTrace 事件流；控制层独立限制历史和记录容量，卸载停止观察后取消并等待全部已启动工作。详情见 [DevTools](devtools.md)。

Core 运行时零依赖，Scenario 唯一的运行时依赖是 Core。两者通过 TypeScript 编译器输出 ESM 和类型声明。测试、示例执行器与 Changesets 仅作为工作区开发依赖。两包不使用 `window`、`document`、Node.js 专属 API 或导入时自动注册。
