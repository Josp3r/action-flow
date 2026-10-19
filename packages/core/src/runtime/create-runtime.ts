import type { ActionContext, ContextDispatch } from "../action/types.js";
import type { ValidateContracts } from "../contract/validation.js";
import type { Dispatch, RequiredProviders, RuntimeActions } from "../dispatch/types.js";
import type { AnyModule } from "../module/define-module.js";
import { buildRegistry, UnknownActionError } from "../registry/action-registry.js";
import type { ActionRegistry } from "../registry/action-registry.js";

export interface Runtime<Actions> {
  readonly dispatch: Dispatch<Actions>;
  readonly registry: ActionRegistry;
}

export function createRuntime<
  const Modules extends readonly AnyModule[],
  Providers extends object & RequiredProviders<Modules>,
>(options: {
  readonly providers: Providers;
  readonly modules: Modules & NoInfer<ValidateContracts<Modules>>;
}): Runtime<RuntimeActions<Modules>> {
  const { registry, handlers } = buildRegistry(options.modules);
  // Snapshot bindings, retaining external API/store object identity.
  const providers = Object.freeze({ ...options.providers });

  const dispatch: ContextDispatch = async (actionId, input) => {
    const handler = handlers.get(actionId);
    if (!handler) throw new UnknownActionError(actionId);
    const context: ActionContext<Providers> = Object.freeze({ providers, dispatch });
    // The registry erases heterogeneous signatures. Public dispatch checks the ID/input pair.
    const execute = handler as (input: unknown, ctx: ActionContext<Providers>) => unknown;
    return await execute(input, context);
  };

  return Object.freeze({
    dispatch: dispatch as unknown as Dispatch<RuntimeActions<Modules>>,
    registry,
  });
}
