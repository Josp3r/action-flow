import { createActionFactory, createRuntime, defineModule } from "@action-flow/core";
import type { ActionSignature, ExecutionRecord, TraceEvent } from "@action-flow/core";

interface Providers { loader(label: string, signal: AbortSignal): Promise<string> }
interface Contract {
  "demo.run": ActionSignature<string, string[]>;
  "demo.load": ActionSignature<string, string>;
  "demo.fail": ActionSignature<void, never>;
}

const action = createActionFactory<Providers, Contract>();
const module = defineModule("demo", {
  run: action.define({ async handler(label: string, ctx) {
    if (label === "failure") await ctx.dispatch("demo.fail");
    return Promise.all([
      ctx.dispatch("demo.load", `${label}/left`),
      ctx.dispatch("demo.load", `${label}/right`),
    ]);
  } }),
  load: action.define({ handler: (label: string, ctx) => ctx.providers.loader(label, ctx.signal) }),
  fail: action.define({ handler: () => { throw new Error("Simulated business failure"); } }),
});

const runtime = createRuntime({
  environment: "development",
  providers: {
    loader(label: string, signal: AbortSignal) {
      return new Promise<string>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve(label.toUpperCase());
        }, label.endsWith("left") ? 15 : 5);
        signal.addEventListener("abort", abort, { once: true });
      });
    },
  },
  modules: [module],
  middleware: [async (ctx, next) => {
    const result = await next();
    if (ctx.actionId === "demo.run") console.log(`Middleware completed: ${ctx.actionId}`);
    return result;
  }],
});

const events: TraceEvent[] = [];
const unsubscribe = runtime.trace.subscribe((event) => events.push(event));
console.log("Concurrent results:", await Promise.all([
  runtime.dispatch("demo.run", "first"), runtime.dispatch("demo.run", "second"),
]));
try { await runtime.dispatch("demo.run", "failure"); }
catch (error) { console.log("Original error:", error instanceof Error ? error.message : error); }

const controller = new AbortController();
const cancelled = runtime.dispatch("demo.run", "cancel", { signal: controller.signal });
controller.abort(new Error("Cancelled by the demo"));
try { await cancelled; }
catch (error) { console.log("Cancellation:", error instanceof Error ? error.message : error); }
unsubscribe();

const records = runtime.trace.list();
function print(record: ExecutionRecord, depth = 0): void {
  console.log(`${"  ".repeat(depth)}${record.actionId} [${record.status}] ${record.duration?.toFixed(2)}ms`);
  for (const child of records.filter((item) => item.parentExecutionId === record.executionId)) print(child, depth + 1);
}
for (const root of records.filter((record) => record.parentExecutionId === undefined)) {
  console.log(`\nTrace ${root.traceId}`);
  print(root);
}
console.log(`\nLifecycle: ${events.filter((event) => event.type === "start").length} starts, ${events.filter((event) => event.type === "finish").length} finishes`);
console.log("No business input/output was captured:", records.every((record) => !("input" in record) && !("output" in record)));
