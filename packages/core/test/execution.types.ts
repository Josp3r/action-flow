import { expectTypeOf } from "vitest";
import { createActionFactory, createRuntime, defineModule } from "../src/index.js";
import type { ActionContext, ActionSignature, ExecutionRecord, Middleware, TraceEvent } from "../src/index.js";

interface Providers { label: string }
interface Contract { "app.run": ActionSignature<number, number>; "app.ping": ActionSignature<void, string> }
const action = createActionFactory<Providers, Contract>();
const module = defineModule("app", {
  run: action.define({ handler: (input: number) => input * 2 }),
  ping: action.define({ handler: () => "pong" }),
});

function assertTypes(ctx: ActionContext<Providers, Contract>, record: ExecutionRecord) {
  const controller = new AbortController();
  const runtime = createRuntime({ providers: { label: "value" }, modules: [module], trace: {
    maxRecords: 100, capture: { input: true },
    redact(value, field, execution) {
      expectTypeOf(value).toEqualTypeOf<unknown>();
      expectTypeOf(field).toEqualTypeOf<"input" | "output" | "error">();
      expectTypeOf(execution).toEqualTypeOf<ExecutionRecord>();
      return value;
    },
  }, middleware: [async (context, next) => {
    expectTypeOf(context.providers).toEqualTypeOf<Providers>();
    expectTypeOf(context.input).toEqualTypeOf<unknown>();
    return next();
  }] });
  expectTypeOf(runtime.dispatch("app.run", 3, { signal: controller.signal })).toEqualTypeOf<Promise<number>>();
  expectTypeOf(ctx.dispatch("app.run", 3, { signal: controller.signal })).toEqualTypeOf<Promise<number>>();
  expectTypeOf(ctx.dispatch("app.ping", undefined, { signal: controller.signal })).toEqualTypeOf<Promise<string>>();
  expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignal>();
  expectTypeOf(ctx.executionId).toEqualTypeOf<string>();
  expectTypeOf(ctx.traceId).toEqualTypeOf<string>();
  expectTypeOf(ctx.parentExecutionId).toEqualTypeOf<string | undefined>();
  runtime.trace.subscribe((event) => expectTypeOf(event).toEqualTypeOf<TraceEvent>());
  // @ts-expect-error execution metadata is read-only
  ctx.executionId = "replacement";
  // @ts-expect-error trace snapshots are read-only
  record.status = "error";
  // @ts-expect-error options do not replace the payload for input-free Actions
  runtime.dispatch("app.ping", { signal: controller.signal });
  // @ts-expect-error dispatch options cannot bypass the payload type
  ctx.dispatch("app.run", "incorrect", { signal: controller.signal });
  // @ts-expect-error a signal must be an AbortSignal
  runtime.dispatch("app.run", 1, { signal: "incorrect" });
  // @ts-expect-error environment names are checked
  createRuntime({ providers: {}, modules: [], environment: "invalid" });
  const middleware: Middleware<Providers> = async (context, next) => {
    expectTypeOf(context.providers.label).toEqualTypeOf<string>();
    return next();
  };
  void middleware;
}
void assertTypes;
