# Core 结构

Core 负责显式注册的业务行为，不拥有应用状态，也不会拦截普通 JavaScript 函数调用。

## 类型与注册

`action` 定义 Handler、输入/输出和执行上下文；`module` 将 Action Key 与 Namespace 组合；`dispatch` 从静态模块集合计算公共调用签名；`registry` 校验全局 ID 唯一并保存 Handler 与元数据；`runtime` 连接依赖和执行入口。

`contract` 为在 Runtime 汇总之前定义的 Handler 提供跨模块调用签名。Factory 将 Contract 信息通过类型标记保留到模块推导中；Runtime 组装时检查每份契约的目标是否存在、实现是否接受对应输入，以及解析后的输出是否兼容。检查仅发生在编译期，不增加运行时字段或处理阶段。Contract 模式要求静态模块元组和可确定的命名，以免把可能缺失的动态注册集合误判为完整。

命名要求为无空白、非空的点分段字符串。Namespace 和 Action Key 均允许多级分段。`a` + `b.c` 与 `a.b` + `c` 组成同一 ID，会被判定为冲突。内部使用 Map，避免继承属性被当作 Action。

## 执行

每次 Dispatch 查找 Handler，创建独立的冻结上下文，然后等待 Handler 的同步或异步返回。未知 ID 返回拒绝的 Promise。Handler 抛出的原始值直接传播，包括嵌套错误；父 Action 也可自行捕获并恢复。

上下文只含 `providers` 和 `dispatch`。Milestone 2 将补充 Execution/Trace ID、生命周期与父子关联；当前没有隐式的全局当前执行对象。

## 依赖边界

创建 Runtime 时复制并冻结 Providers 顶层绑定，防止替换外部配置对象中的属性影响已创建的 Runtime。依赖对象自身保持原引用，因此 API 客户端、Router、外部 Store 的身份和行为得以保留。

每个 Runtime 拥有独立 Registry 和依赖绑定。外部业务对象若被调用方共享，其状态也会共享；当前实现并不提供深拷贝或 Scenario 隔离保证。Scenario Override 与 Fixture 作用域属于 Milestone 3。

## 打包边界

Core 只有 TypeScript 源码，运行时零依赖。以 TypeScript 编译器直接输出 ESM 和类型声明，先避免额外打包层。测试、示例执行器与 Changesets 仅作为工作区开发依赖。Core 不使用 `window`、`document`、Node.js 专属 API 或导入时自动注册。
