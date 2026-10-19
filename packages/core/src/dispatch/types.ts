import type { ActionInput, ActionOutput, ActionProviders, AnyAction } from "../action/types.js";
import type { AnyModule } from "../module/define-module.js";

type UnionToIntersection<Union> =
  (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void
    ? Intersection
    : never;

type ModuleActions<Module> = Module extends AnyModule
  ? { [Name in keyof Module["actions"] & string as `${Module["namespace"]}.${Name}`]: Module["actions"][Name] }
  : never;

export type RuntimeActions<Modules extends readonly AnyModule[]> =
  [Modules[number]] extends [never] ? {} : UnionToIntersection<ModuleActions<Modules[number]>>;

// Intersect provider requirements before a provider-free action's `object`
// can absorb the union of the other actions' requirements.
type ProviderRequirement<Action> = Action extends AnyAction
  ? (providers: ActionProviders<Action>) => void
  : never;

type ModuleProviderRequirements<Module> = Module extends AnyModule
  ? ProviderRequirement<Module["actions"][keyof Module["actions"]]>
  : never;

export type RequiredProviders<Modules extends readonly AnyModule[]> =
  [ModuleProviderRequirements<Modules[number]>] extends [never]
    ? object
    : ModuleProviderRequirements<Modules[number]> extends (providers: infer Providers) => void
      ? Providers
      : never;

type InputArgs<Action extends AnyAction> =
  [ActionInput<Action>] extends [never] ? [input: never]
    : [ActionInput<Action>] extends [void] ? [input?: ActionInput<Action>] : [input: ActionInput<Action>];

// Distribute over IDs so a union ID cannot be paired with the wrong payload.
type DispatchArgs<Actions, Id extends keyof Actions & string> = Id extends unknown
  ? Actions[Id] extends AnyAction ? [actionId: Id, ...args: InputArgs<Actions[Id]>] : never
  : never;

export type Dispatch<Actions> = <const Id extends keyof Actions & string>(
  ...args: DispatchArgs<Actions, Id>
) => Promise<Actions[Id] extends AnyAction ? ActionOutput<Actions[Id]> : never>;
