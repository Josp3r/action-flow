# 发布 ActionFlow

三个包首发为 `0.1.0`，目标为公共 npm 组织 `@action-flow`，使用 `latest` 标签。后续变更通过 Changesets 记录，版本变化根据实际 API 兼容性决定；0.x 版本仍需阅读更新记录。

## 准备

使用 Node 22 或 24，以及仓库指定的 pnpm 10.34.5。npm 配置与认证只保存在本机或 CI 的凭据设施中，不能放入仓库、发布产物或问题报告。

```sh
npm whoami --registry=https://registry.npmjs.org/
npm org ls action-flow --json --registry=https://registry.npmjs.org/
pnpm install --frozen-lockfile
```

确认账号有组织发布权限，并检查目标包版本尚不存在。需要切换 npm 身份时先备份完整用户配置；登录和 2FA 由发布者完成。不要通过 `npm logout` 来代替本地配置切换，以免撤销仍需使用的会话。

## 生成版本和验证产物

```sh
pnpm changeset
pnpm release:version
pnpm check
pnpm check:package
pnpm release:pack
```

首发 Changeset 已将 Core、Scenario、DevTools 从 0.0.0 升级到 0.1.0。后续运行 `release:version` 前先创建新的 Changeset。检查版本、更新记录和包内依赖，并提交推送这些发布来源文件。

`check:package` 在临时项目安装三个真实 tarball，检查 ESM、类型、依赖关系、Trace、Scenario、DevTools 控制层及包内 README/许可证。Node 22 和 24 都应运行。`release:pack` 输出到被 Git 忽略的 `artifacts/`；检查文件清单，仅应包含 dist、package.json、README、CHANGELOG 和 LICENSE。

## 发布已验证的 tarball

从仓库根目录执行，按依赖顺序发布。以下命令是 **0.1.0 首发**，后续版本应替换文件名：

```sh
npm publish ./artifacts/action-flow-core-0.1.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm publish ./artifacts/action-flow-scenario-0.1.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm publish ./artifacts/action-flow-devtools-0.1.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
```

pnpm pack 会把 `workspace:*` 改写为真实版本；不要使用未经检查的产物或改包内容后重用旧验证结论。当前 GitHub `Verify release package` 工作流只验证并上传产物，不执行 npm 发布，不需要向仓库添加 Token。

## 发布后验证

查询三个包的版本、latest 标签、依赖和 tarball integrity，与本地文件对照。在仓库外的新目录从 `https://registry.npmjs.org/` 安装全部三个 `@0.1.0` 包，执行 Core 嵌套调用、Scenario Mock/Fixture 和 DevTools 控制层，并确认安装来源是 npm 而非 workspace 链接。然后记录结果，创建并推送 `v0.1.0` Git 标签。

如果部分包已经成功发布，先查询 Registry 状态，再继续剩余包。不要盲目重发、修改已发布版本的内容、自动撤回已发布包，或为了重试就提升所有版本。若认证过期或需要 2FA，保留产物，完成认证后继续尚未发布的包。
