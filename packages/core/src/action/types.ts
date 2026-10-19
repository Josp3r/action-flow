import type { actionContract, ContractDispatch } from "../contract/types.js";

/** The explicit dynamic boundary for actions without a declared contract. */
export type ContextDispatch = (actionId: string, input?: unknown) => Promise<unknown>;

export interface ActionContext<Providers extends object = object, Contract = never> {
  readonly providers: Providers;
  readonly dispatch: [Contract] extends [never] ? ContextDispatch : ContractDispatch<Contract>;
}

export interface ActionMetadata {
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface ActionDefinition<Input, Output, Providers extends object, Contract = never>
  extends ActionMetadata {
  readonly handler: (input: Input, ctx: ActionContext<Providers, Contract>) => Output;
  readonly [actionContract]?: Contract;
}

/** Structural constraint only; actual input, output and provider types are retained. */
export interface AnyAction extends ActionMetadata {
  readonly handler: (...args: never[]) => unknown;
}

export type ActionInput<Action extends AnyAction> = Parameters<Action["handler"]>[0];
export type ActionOutput<Action extends AnyAction> = Awaited<ReturnType<Action["handler"]>>;
export type ActionProviders<Action extends AnyAction> =
  Parameters<Action["handler"]>[1] extends { readonly providers: infer Providers extends object }
    ? Providers : object;
