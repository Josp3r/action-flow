import type { ActionDefinition } from "./types.js";
import type { ContractShape } from "../contract/types.js";

export function createActionFactory<Providers extends object, Contract extends ContractShape<Contract> = never>() {
  return {
    // Keep an enclosing module constraint from inferring a no-input action as `never`.
    define<Input = void, Output = unknown>(
      definition: ActionDefinition<Input, Output, Providers, Contract>,
    ): ActionDefinition<NoInfer<Input>, Output, Providers, Contract> {
      return freezeAction(definition);
    },
  };
}

export function defineAction<Input = void, Output = unknown>(
  definition: ActionDefinition<Input, Output, object>,
): ActionDefinition<NoInfer<Input>, Output, object> {
  return freezeAction(definition);
}

function freezeAction<Input, Output, Providers extends object, Contract>(
  definition: ActionDefinition<Input, Output, Providers, Contract>,
): ActionDefinition<Input, Output, Providers, Contract> {
  if (typeof definition.handler !== "function") {
    throw new TypeError("An action must have a handler function.");
  }
  return Object.freeze({
    ...definition,
    ...(definition.tags === undefined ? {} : { tags: Object.freeze([...definition.tags]) }),
  });
}
