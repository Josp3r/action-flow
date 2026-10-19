import { describe, expect, it } from "vitest";
import { createActionFactory, createRuntime, defineModule } from "@action-flow/core";
import type { ActionSignature } from "@action-flow/core";

describe("built ESM package in a Node/SSR host", () => {
  it("imports and executes without browser globals", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    const action = createActionFactory<
      { requestId: string }, { "request.identify": ActionSignature<void, string> }
    >();
    const module = defineModule("request", {
      identify: action.define({ handler: (_: void, ctx) => ctx.providers.requestId }),
    });
    const first = createRuntime({ providers: { requestId: "request-1" }, modules: [module] });
    const second = createRuntime({ providers: { requestId: "request-2" }, modules: [module] });
    await expect(Promise.all([
      first.dispatch("request.identify"), second.dispatch("request.identify"),
    ])).resolves.toEqual(["request-1", "request-2"]);
    expect(first.registry).not.toBe(second.registry);
  });
});
