import type { AnyAction } from "../action/types.js";

export interface ActionModule<Namespace extends string, Actions extends Record<string, AnyAction>> {
  readonly namespace: Namespace;
  readonly actions: Actions;
}

export type AnyModule = ActionModule<string, Record<string, AnyAction>>;

export function assertActionPath(path: string, label: string): void {
  if (typeof path !== "string" || !/^[^.\s]+(?:\.[^.\s]+)*$/u.test(path)) {
    throw new TypeError(`${label} must contain non-empty, dot-separated segments without whitespace.`);
  }
}

export function defineModule<const Namespace extends string, const Actions extends Record<string, AnyAction>>(
  namespace: Namespace,
  actions: Actions,
): ActionModule<Namespace, Actions> {
  assertActionPath(namespace, "Module namespace");
  if (actions === null || typeof actions !== "object" || Array.isArray(actions)) {
    throw new TypeError("Module actions must be an action map.");
  }
  for (const [name, action] of Object.entries(actions)) {
    assertActionPath(name, "Action name");
    if (typeof action?.handler !== "function") {
      throw new TypeError(`Action "${namespace}.${name}" must have a handler function.`);
    }
  }
  return Object.freeze({
    namespace,
    actions: Object.freeze({ ...actions }),
  });
}
