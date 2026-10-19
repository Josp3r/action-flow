import type { ActionContext } from "../action/types.js";
import { throwIfAborted } from "./signals.js";

export interface MiddlewareContext<Providers extends object = object> extends ActionContext<Providers> {
  readonly input: unknown;
}

export type Middleware<Providers extends object = object> = (
  context: MiddlewareContext<Providers>, next: () => Promise<unknown>,
) => unknown;

export class MiddlewareNextError extends Error {
  constructor(message = "Middleware next() may only be called once while its middleware is active.") {
    super(message);
    this.name = "MiddlewareNextError";
  }
}

export async function runMiddleware<Providers extends object>(
  middleware: readonly Middleware<Providers>[],
  context: MiddlewareContext<Providers>,
  handler: () => Promise<unknown>,
): Promise<unknown> {
  const invoke = async (index: number): Promise<unknown> => {
    throwIfAborted(context.signal);
    const current = middleware[index];
    if (current === undefined) return handler();
    let active = true;
    let called = false;
    let downstream: Promise<unknown> | undefined;
    let settled = false;
    const next = () => {
      if (!active || called) return Promise.reject(new MiddlewareNextError());
      called = true;
      downstream = invoke(index + 1).finally(() => { settled = true; });
      void downstream.catch(() => {});
      return downstream;
    };
    try {
      const result = await current(context, next);
      active = false;
      if (downstream !== undefined && !settled) {
        await downstream.catch(() => {});
        throw new MiddlewareNextError("Middleware must await or return next() before settling.");
      }
      return result;
    } catch (error) {
      active = false;
      if (downstream !== undefined && !settled) await downstream.catch(() => {});
      throw error;
    } finally {
      active = false;
    }
  };
  return invoke(0);
}
