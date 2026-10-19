import type { Dispatch } from "../dispatch/types.js";

/** One Action's accepted input and resolved output in an explicit contract. */
export interface ActionSignature<Input, Output> {
  readonly input: Input;
  readonly output: Output;
}

export type ContractShape<Contract> = {
  readonly [Id in keyof Contract]-?: Id extends string ? ActionSignature<unknown, unknown> : never;
};

type ContractActions<Contract> = {
  readonly [Id in keyof Contract]: Contract[Id] extends ActionSignature<infer Input, infer Output>
    ? { readonly handler: (input: Input) => Output }
    : never;
};

export type ContractDispatch<Contract> = Dispatch<ContractActions<Contract>>;

// A declaration-only marker retains requirements through module inference.
// It adds no runtime field or global registry.
export declare const actionContract: unique symbol;
