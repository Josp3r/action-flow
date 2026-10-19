import type { ActionMetadata, AnyAction } from "../action/types.js";
import { assertActionPath } from "../module/define-module.js";
import type { AnyModule } from "../module/define-module.js";

export interface ActionRegistration extends ActionMetadata {
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
}

export interface ActionRegistry {
  readonly size: number;
  has(actionId: string): boolean;
  get(actionId: string): ActionRegistration | undefined;
  list(): readonly ActionRegistration[];
}

export class DuplicateActionError extends Error {
  constructor(readonly actionId: string) {
    super(`Action "${actionId}" is already registered.`);
    this.name = "DuplicateActionError";
  }
}

export class UnknownActionError extends Error {
  constructor(readonly actionId: string) {
    super(`Action "${actionId}" is not registered.`);
    this.name = "UnknownActionError";
  }
}

export function buildRegistry(modules: readonly AnyModule[]) {
  const handlers = new Map<string, AnyAction["handler"]>();
  const registrations = new Map<string, ActionRegistration>();

  for (const module of modules) {
    assertActionPath(module.namespace, "Module namespace");
    for (const [name, action] of Object.entries(module.actions)) {
      assertActionPath(name, "Action name");
      const id = `${module.namespace}.${name}`;
      if (handlers.has(id)) throw new DuplicateActionError(id);
      if (typeof action?.handler !== "function") {
        throw new TypeError(`Action "${id}" must have a handler function.`);
      }
      handlers.set(id, action.handler);
      registrations.set(id, Object.freeze({
        id,
        namespace: module.namespace,
        name,
        ...(action.description === undefined ? {} : { description: action.description }),
        ...(action.tags === undefined ? {} : { tags: Object.freeze([...action.tags]) }),
      }));
    }
  }

  const entries = Object.freeze([...registrations.values()]);
  const registry: ActionRegistry = Object.freeze({
    size: entries.length,
    has: (actionId: string) => registrations.has(actionId),
    get: (actionId: string) => registrations.get(actionId),
    list: () => entries,
  });

  return { registry, handlers };
}
