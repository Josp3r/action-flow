import type { ActionInput, ActionOutput, AnyAction } from "../action/types.js";
import type { RuntimeActions } from "../dispatch/types.js";
import type { AnyModule } from "../module/define-module.js";
import type { actionContract, ActionSignature } from "./types.js";

type DeclaredContract<Action> = Action extends { readonly [actionContract]?: infer Contract }
  ? Contract : never;

type CheckAction<Id extends string, Signature, Implementation> =
  Signature extends ActionSignature<infer Input, infer Output>
    ? Implementation extends AnyAction
      ? [Input] extends [ActionInput<Implementation>]
        ? [ActionOutput<Implementation>] extends [Awaited<Output>]
          ? never : `Incompatible output: ${Id}`
        : `Incompatible input: ${Id}`
      : `Missing action: ${Id}`
    : `Invalid contract: ${Id}`;

type CheckContract<Contract, Actions> = Contract extends unknown
  ? {
    [Id in keyof Contract & string]: Id extends keyof Actions
      ? CheckAction<Id, Contract[Id], Actions[Id]>
      : `Missing action: ${Id}`;
  }[keyof Contract & string]
  : never;

// Validate each Action's contract separately: merging contracts first could
// erase narrower requirements when contracts overlap.
type ContractErrors<Actions> = {
  [Id in keyof Actions]: CheckContract<DeclaredContract<Actions[Id]>, Actions>;
}[keyof Actions];

type RequiredContracts<Actions> = {
  [Id in keyof Actions]: DeclaredContract<Actions[Id]>;
}[keyof Actions];

type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value] ? false : true
  : never;

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: {} extends Pick<Value, Key> ? Key : never;
}[keyof Value];

type ModuleShapeErrors<Module extends AnyModule> = true extends IsUnion<Module>
  ? "Contract modules must have a statically known shape"
  : string extends Module["namespace"]
    ? "Contract modules require literal namespaces"
    : true extends IsUnion<Module["namespace"]>
      ? "Contract modules cannot have union namespaces"
      : string extends keyof Module["actions"]
        ? "Contract modules require known Action keys"
        : [OptionalKeys<Module["actions"]>] extends [never]
          ? never : "Contract modules cannot have optional Actions";

type StaticRegistrationErrors<Modules extends readonly AnyModule[]> =
  number extends Modules["length"] ? "Contract modules require a readonly tuple; use as const"
    : true extends IsUnion<Modules> ? "Contract module lists cannot be unions"
      : { [Index in keyof Modules]: ModuleShapeErrors<Modules[Index]> }[number];

type ValidationErrors<Modules extends readonly AnyModule[]> =
  ContractErrors<RuntimeActions<Modules>> | StaticRegistrationErrors<Modules>;

export type ValidateContracts<Modules extends readonly AnyModule[]> =
  [RequiredContracts<RuntimeActions<Modules>>] extends [never]
    ? unknown
    : [ValidationErrors<Modules>] extends [never]
      ? unknown
      : { readonly __actionFlowContractErrors: ValidationErrors<Modules> };
