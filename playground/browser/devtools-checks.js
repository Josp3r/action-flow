import { createRuntime, defineAction, defineModule, DebugDisabledError } from "@action-flow/core";
import { createScenarioRunner } from "@action-flow/scenario";
import { mountDevTools } from "@action-flow/devtools";

const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async (predicate) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("等待界面更新超时"); await new Promise((resolve) => setTimeout(resolve, 5)); }
};
let passed = 0; let failed = 0;
const check = async (name, run) => {
  const item = document.createElement("li");
  try { await run(); item.textContent = `通过 · ${name}`; passed++; }
  catch (error) { item.textContent = `失败 · ${name}：${error.message}`; failed++; }
  document.querySelector("#checks").append(item);
};
let calls = 0; let released = 0;
const runtime = createRuntime({ providers: {}, environment: "test", trace: false, modules: [defineModule("test", {
  parent: defineAction({ description: "组合行为", tags: ["编排"], handler: (input, ctx) => ctx.dispatch("test.echo", input) }),
  echo: defineAction({ description: "回显", handler: (input) => { calls++; return input; } }),
  slow: defineAction({ description: "可取消", handler: (_, ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true })) }),
})] });
const runner = createScenarioRunner(runtime, { trace: { capture: { input: true, output: true, error: true } } });
runner.defineScenario({ id: "success", action: "test.parent", input: "scenario", mocks: { "test.echo": { type: "return", value: "mocked" } } });
runner.defineScenario({ id: "failure", action: "test.parent", input: "x", mocks: { "test.echo": { type: "throw", error: new Error("expected business failure") } } });
runner.defineScenario({ id: "setup", action: "test.parent", input: "x", setup() { throw new Error("setup failed"); } });
runner.defineScenario({ id: "cleanup", action: "test.parent", input: "x", cleanup() { throw new Error("cleanup failed"); } });
runner.defineScenario({ id: "cancel", action: "test.slow", setup(ctx) { ctx.defer(() => { released++; }); } });
const target = document.querySelector("#sandbox");
const handle = mountDevTools({ target, runtime, runner, initialPayloads: { "test.parent": '"hello"' } });
const shadow = target.firstElementChild.shadowRoot;
const find = (id) => shadow.querySelector(`#${id}`);
const input = (id, value) => { find(id).value = value; find(id).dispatchEvent(new Event("input", { bubbles: true })); };
const action = (id) => { const button = [...find("actions").querySelectorAll("button")].find((candidate) => candidate.querySelector("strong").textContent === id); assert(button, `找不到 ${id}`); button.click(); };
const mode = (value) => { find("mode").value = value; find("mode").dispatchEvent(new Event("change", { bubbles: true })); };
const submit = async () => {
  const previous = handle.controller.runs().at(-1)?.id;
  find("form").requestSubmit();
  await wait(() => { const run = handle.controller.runs().at(-1); return run?.id !== previous && run?.status !== "running"; });
  await Promise.resolve();
  return handle.controller.runs().at(-1);
};

await check("独立挂载、Action 列表与初始 JSON", () => {
  assert(find("actions").querySelectorAll("button").length === 3, "Action 数量错误");
  assert(find("payload").value === '"hello"', "初始输入错误");
});
await check("按描述或标签搜索，无匹配时显示空状态", () => {
  input("search", "编排"); assert(find("actions").querySelectorAll("button").length === 1, "标签搜索失败");
  input("search", "missing"); assert(find("actions").textContent.includes("没有匹配"), "空状态缺失");
  input("search", "");
});
await check("非法 JSON 不执行 Handler，不增加历史", async () => {
  input("payload", "{"); find("form").requestSubmit(); await wait(() => find("validation").textContent.includes("JSON"));
  assert(calls === 0 && handle.controller.runs().length === 0, "非法输入被执行");
});
await check("执行 JSON Payload，展示结果与嵌套 Trace", async () => {
  input("payload", '{"message":"hello"}'); const run = await submit();
  assert(run.status === "success" && find("result").textContent.includes("hello"), "结果错误");
  assert(run.trace.length === 2 && find("trace-count").textContent === "2 次调用", "调用树数量错误");
});
await check("调用详情可展开，含正确父子关联", () => {
  const data = [...find("trace").querySelectorAll("details")].find((candidate) => candidate.querySelector(":scope > summary")?.textContent === "查看调用详情");
  assert(data && !data.open, "详情初态错误"); data.querySelector("summary").click(); assert(data.open, "详情未展开");
  assert(find("trace").textContent.includes("parentExecutionId"), "父子信息缺失");
});
await check("切换 Action 保留各自输入草稿", () => {
  action("test.echo"); input("payload", "false"); action("test.parent");
  assert(find("payload").value.includes("hello"), "草稿丢失");
});
await check("选择 Scenario 禁用输入，使用定义中的 Mock", async () => {
  mode("success"); assert(find("payload").disabled, "场景输入仍可编辑");
  const run = await submit(); assert(run.output === "mocked" && run.scenarioId === "success", "未执行场景");
});
await check("业务异常显示错误和失败调用树", async () => {
  mode("failure"); const run = await submit();
  assert(run.status === "error" && find("result").textContent.includes("expected business failure"), "异常丢失");
  assert(run.trace.every((record) => record.status === "error"), "错误关联丢失");
});
await check("Fixture setup 失败，显示未进入 Dispatch", async () => {
  mode("setup"); const run = await submit();
  assert(run.trace.length === 0 && find("result-meta").textContent.includes("尚未进入 Dispatch"), "setup 状态错误");
});
await check("Fixture cleanup 失败保留组合错误和单独清理信息", async () => {
  mode("cleanup"); const run = await submit();
  assert(run.status === "error" && find("cleanup").textContent.includes("cleanup failed"), "清理信息缺失");
  assert(find("result").textContent.includes('"errors"'), "组合错误缺失");
});
await check("HTML 字符串以纯文本显示，常见敏感字段脱敏", async () => {
  action("test.echo"); input("payload", '{"text":"<img src=x onerror=alert(1)>","password":"secret"}'); await submit();
  assert(find("result").textContent.includes("<img") && !find("result").querySelector("img"), "输出被解析为 HTML");
  assert(find("result").textContent.includes("[REDACTED]") && !find("result").textContent.includes('"secret"'), "敏感值泄漏");
});
await check("并发执行有独立历史、结果和 Trace", async () => {
  const [one, two] = await Promise.all([handle.controller.runAction("test.parent", '"one"'), handle.controller.runScenario("success")]);
  assert(one.output === "one" && two.output === "mocked" && one.traceId !== two.traceId, "并发执行串线");
  assert(find("history").querySelectorAll("button").length === handle.controller.runs().length, "历史未更新");
});
await check("运行历史可选择先前执行，恢复其结果", () => {
  const buttons = [...find("history").querySelectorAll("button")]; buttons.at(-1).click();
  assert(find("result-meta").textContent.startsWith("run-1"), "历史选择未生效");
});
await check("取消只影响所选执行，且释放 Scenario Fixture", async () => {
  action("test.slow"); mode("cancel"); find("form").requestSubmit();
  await wait(() => handle.controller.runs().at(-1)?.trace.length > 0);
  find("cancel").click(); await wait(() => handle.controller.runs().at(-1)?.status === "cancelled");
  assert(released === 1 && find("result-status").textContent === "已取消", "取消或释放失败");
});
await check("清空历史后恢复空状态", () => {
  find("clear").click(); assert(handle.controller.runs().length === 0, "历史未清空");
});
await check("生产默认拒绝挂载，且不写入 DOM", () => {
  const production = createRuntime({ providers: {}, modules: [] });
  const isolated = document.createElement("div"); let error;
  try { mountDevTools({ target: isolated, runtime: production }); } catch (caught) { error = caught; }
  assert(error instanceof DebugDisabledError && isolated.childNodes.length === 0, "生产策略失败");
});
await check("卸载请求取消、等待 Fixture 释放，重复卸载幂等", async () => {
  const other = document.createElement("div"); target.append(other);
  const mounted = mountDevTools({ target: other, runtime, runner });
  const pending = mounted.controller.runScenario("cancel");
  await wait(() => mounted.controller.runs()[0]?.trace.length > 0);
  const disposed = mounted.unmount(); assert(mounted.unmount() === disposed, "卸载不幂等");
  await disposed; assert((await pending).status === "cancelled" && released === 2, "卸载未释放");
  assert(other.childNodes.length === 0, "面板未移除"); other.remove();
});
await handle.unmount();
document.querySelector("#summary").textContent = `${passed} 项通过，${failed} 项失败`;
document.documentElement.dataset.testStatus = failed ? "failed" : "passed";
