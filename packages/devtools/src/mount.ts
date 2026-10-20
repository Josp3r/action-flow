import { createDevToolsController } from "./controller.js";
import { buildTraceForest, formatValue } from "./format.js";
import type { TraceNode } from "./format.js";
import { styles } from "./styles.js";
import type { DevToolsHandle, DevToolsRun, MountDevToolsOptions } from "./types.js";

const labels = { running: "执行中", success: "成功", error: "失败", cancelled: "已取消" } as const;

export function mountDevTools<Actions, Providers extends object>(options: MountDevToolsOptions<Actions, Providers>): DevToolsHandle {
  const controller = createDevToolsController(options);
  const doc = options.target?.ownerDocument;
  if (!doc || typeof options.target.append !== "function") throw new TypeError("DevTools target must be an HTML element.");
  const host = doc.createElement("div");
  host.dataset.actionFlowDevtools = "";
  const root = host.attachShadow({ mode: "open" });
  // Only constant markup enters HTML; all Action metadata, errors and results use textContent.
  root.innerHTML = `<style>${styles}</style><section class="app" aria-label="ActionFlow 调试面板">
    <header class="header"><div class="brand"><div class="logo" aria-hidden="true">A</div><div><h1>ActionFlow <span class="muted">/ DevTools</span></h1><p class="sub">独立执行业务行为，检查每一次调用。</p></div></div><div class="env">● 本地调试 · <span id="environment"></span></div></header>
    <div class="layout">
      <aside class="card"><div class="card-head"><h2>Actions</h2><span id="action-count" class="count"></span></div><div class="search"><label for="search">搜索 Action</label><input id="search" type="search" placeholder="名称、描述或标签"></div><div id="actions" class="actions"></div></aside>
      <main class="stack">
        <section class="card"><div class="card-head"><h2>执行工作台</h2><span id="active-count" class="count" role="status"></span></div><div class="card-body">
          <h2 id="action-title" class="action-title"></h2><p id="description" class="description"></p>
          <form id="form" style="margin-top:20px"><div class="field"><label for="mode">执行方式</label><select id="mode"></select><p id="mode-hint" class="hint"></p></div>
          <div class="field"><label for="payload">JSON Payload</label><textarea id="payload" spellcheck="false" placeholder='{"name": "Ada"}'></textarea><p class="hint">留空传入 undefined；Scenario 使用已定义的输入与依赖。</p></div>
          <div class="toolbar"><button id="execute" class="primary" type="submit">运行 Action</button><button id="cancel" class="secondary danger" type="button" disabled>取消所选运行</button></div><p id="validation" class="alert" role="alert"></p></form>
        </div></section>
        <section class="card"><div class="card-head"><h2>执行结果</h2><span id="result-status" class="status">等待执行</span></div><div class="card-body"><pre id="result">选择一个 Action，或运行已定义的 Scenario。</pre><div id="result-meta" class="ids"></div><div id="cleanup" class="alert"></div></div></section>
        <section class="card"><div class="card-head"><h2>Trace 调用树</h2><span id="trace-count" class="count">0 次调用</span></div><div id="trace" class="trace"><p class="empty">执行后将显示父子调用、状态和耗时。</p></div></section>
      </main>
      <aside class="card history-card"><div class="card-head"><h2>运行历史</h2><button id="clear" class="plain" type="button">清空已完成</button></div><div id="history" class="history"></div></aside>
    </div><footer class="footer"><span>显式挂载 · 无页面前置流程 · 不持久化调试记录</span><button id="refresh" class="plain" type="button">刷新 Action / Scenario 列表</button></footer>
  </section>`;
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className !== undefined) node.className = className;
    return node;
  };
  const search = find<HTMLInputElement>("search");
  const payload = find<HTMLTextAreaElement>("payload");
  const mode = find<HTMLSelectElement>("mode");
  const execute = find<HTMLButtonElement>("execute");
  const cancel = find<HTMLButtonElement>("cancel");
  const drafts = new Map<string, string>(Object.entries(options.initialPayloads ?? {}) as [string, string][]);
  const opened = new Map<string, boolean>();
  let selectedAction = controller.actions[0]?.id;
  let selectedRun: string | undefined;
  let unmounted = false;
  let scheduled = false;
  let unmounting: Promise<void> | undefined;
  find("environment").textContent = options.runtime.environment;
  const badge = (run: Pick<DevToolsRun, "status" | "cancelRequested">) => el("span", run.status === "running" && run.cancelRequested ? "等待取消" : labels[run.status], `status ${run.status}`);

  const renderActions = () => {
    const list = find("actions"); list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const matches = controller.actions.filter((action) => [action.id, action.description, ...(action.tags ?? [])].join(" ").toLocaleLowerCase().includes(query));
    find("action-count").textContent = `${matches.length}/${controller.actions.length}`;
    for (const action of matches) {
      const button = el("button", undefined, "action"); button.type = "button";
      button.setAttribute("aria-pressed", String(selectedAction === action.id));
      button.append(el("strong", action.id), el("span", action.description ?? action.tags?.join(" · ") ?? action.namespace));
      button.addEventListener("click", () => { selectedAction = action.id; mode.value = ""; renderActions(); renderEditor(); });
      list.append(button);
    }
    if (matches.length === 0) list.append(el("p", "没有匹配的 Action", "empty"));
  };
  const syncMode = () => {
    const isScenario = mode.value !== "";
    payload.disabled = isScenario;
    execute.textContent = isScenario ? "运行 Scenario" : "运行 Action";
    const scenario = controller.scenarios().find((candidate) => candidate.id === mode.value);
    find("mode-hint").textContent = scenario?.description ?? (isScenario ? "按场景定义准备环境，并在结束后释放 Fixture。" : "使用 Runtime 的基础依赖执行。输入类型由业务 Handler 验证。");
  };
  const renderEditor = () => {
    const action = controller.actions.find((candidate) => candidate.id === selectedAction);
    find("action-title").textContent = action?.id ?? "尚无已注册的 Action";
    find("description").textContent = action?.description ?? "";
    payload.value = drafts.get(selectedAction ?? "") ?? "";
    const previous = mode.value;
    mode.replaceChildren();
    const normal = el("option", "直接执行 Action"); normal.value = ""; mode.append(normal);
    for (const scenario of controller.scenarios().filter((candidate) => candidate.action === selectedAction)) {
      const option = el("option", scenario.id); option.value = scenario.id; mode.append(option);
    }
    if ([...mode.options].some((option) => option.value === previous)) mode.value = previous;
    execute.disabled = action === undefined;
    find("validation").textContent = "";
    syncMode();
  };
  const renderTraceNode = (node: TraceNode, depth: number): HTMLLIElement => {
    const { record } = node;
    const item = el("li");
    const details = el("details");
    details.open = opened.get(record.executionId) ?? depth < 2;
    details.addEventListener("toggle", () => { if (details.isConnected) opened.set(record.executionId, details.open); });
    const summary = el("summary");
    summary.append(el("span", record.actionId, "mono"), badge({ status: record.status, cancelRequested: false }), el("span", record.duration === undefined ? "执行中…" : `${record.duration.toFixed(2)} ms`, "muted"));
    details.append(summary);
    if (node.missingParent) details.append(el("p", "父记录未保留，以下显示可用调用。", "notice"));
    const detail: Record<string, unknown> = { executionId: record.executionId, traceId: record.traceId };
    for (const field of ["parentExecutionId", "scenarioId", "scenarioRunId", "input", "output", "error"] as const) if (field in record) detail[field] = record[field];
    const data = el("details"); data.append(el("summary", "查看调用详情", "trace-label"), el("pre", formatValue(detail)));
    details.append(data);
    if (node.children.length > 0) {
      if (depth >= 40) details.append(el("p", "后续层级过深，请通过 Trace API 检查。", "notice"));
      else { const children = el("ul"); children.append(...node.children.map((child) => renderTraceNode(child, depth + 1))); details.append(children); }
    }
    item.append(details); return item;
  };
  const renderRuns = () => {
    const runs = controller.runs();
    if (!runs.some((run) => run.id === selectedRun)) selectedRun = runs.at(-1)?.id;
    const run = runs.find((candidate) => candidate.id === selectedRun);
    const active = runs.filter((candidate) => candidate.status === "running").length;
    find("active-count").textContent = active ? `${active} 个运行中` : "就绪";
    const history = find("history"); history.replaceChildren();
    for (const candidate of [...runs].reverse()) {
      const button = el("button", undefined, "run-item"); button.type = "button";
      button.setAttribute("aria-label", `${candidate.id} ${candidate.scenarioId ?? candidate.actionId}`);
      button.setAttribute("aria-pressed", String(candidate.id === selectedRun));
      button.append(badge(candidate), el("strong", candidate.actionId), el("small", candidate.scenarioId ?? "直接执行"), el("small", `${candidate.id} · ${candidate.duration === undefined ? "执行中" : `${candidate.duration.toFixed(0)} ms`}`));
      button.addEventListener("click", () => { selectedRun = candidate.id; renderRuns(); });
      history.append(button);
    }
    if (runs.length === 0) history.append(el("p", "还没有运行记录", "empty"));
    const status = find("result-status");
    status.className = `status ${run?.status ?? ""}`;
    status.textContent = run === undefined ? "等待执行" : labels[run.status];
    find("result").textContent = run === undefined ? "选择一个 Action，或运行已定义的 Scenario。"
      : run.status === "running" ? (run.cancelRequested ? "已请求取消，正在等待执行结束并释放资源…" : "正在执行，可继续发起另一次运行。")
      : formatValue(run.status === "success" ? run.output : run.error);
    find("result-meta").textContent = run === undefined ? "" : `${run.id} · ${run.actionId}${run.scenarioId ? ` · ${run.scenarioId}` : ""}\n${run.traceId ?? "尚未进入 Dispatch"}`;
    find("cleanup").textContent = run?.cleanupErrors.length ? `Fixture 清理失败：\n${formatValue(run.cleanupErrors)}` : "";
    cancel.disabled = !run || run.status !== "running" || run.cancelRequested;
    find("trace-count").textContent = `${run?.trace.length ?? 0} 次调用`;
    const trace = find("trace"); trace.replaceChildren();
    if (run?.droppedRecords) trace.append(el("p", `${run.droppedRecords} 条较早记录已回收，调用树可能不完整。`, "notice"));
    if (run?.trace.length) { const tree = el("ul"); tree.append(...buildTraceForest(run.trace).map((node) => renderTraceNode(node, 0))); trace.append(tree); }
    else trace.append(el("p", run ? "尚无调用记录；准备阶段可能尚未完成或已经失败。" : "执行后将显示父子调用、状态和耗时。", "empty"));
    const retained = new Set(runs.flatMap((candidate) => candidate.trace.map((record) => record.executionId)));
    for (const id of opened.keys()) if (!retained.has(id)) opened.delete(id);
  };
  const unsubscribe = controller.subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!unmounted) renderRuns(); });
  });
  search.addEventListener("input", renderActions);
  mode.addEventListener("change", syncMode);
  payload.addEventListener("input", () => { if (selectedAction) drafts.set(selectedAction, payload.value); });
  find("form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!selectedAction) return;
    selectedRun = undefined;
    find("validation").textContent = "";
    const pending = mode.value ? controller.runScenario(mode.value) : controller.runAction(selectedAction, payload.value);
    void pending.catch((error: unknown) => { if (!unmounted) find("validation").textContent = error instanceof Error ? error.message : formatValue(error); });
  });
  cancel.addEventListener("click", () => { if (selectedRun) controller.cancel(selectedRun); });
  find("clear").addEventListener("click", () => controller.clear());
  const refresh = () => { if (!unmounted) { renderActions(); renderEditor(); renderRuns(); } };
  find("refresh").addEventListener("click", refresh);
  refresh(); options.target.append(host);
  return Object.freeze({ controller, refresh, unmount() {
    if (unmounting) return unmounting;
    unmounted = true; unsubscribe(); host.remove();
    unmounting = controller.dispose();
    return unmounting;
  } });
}
