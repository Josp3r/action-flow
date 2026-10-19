export interface DispatchOptions {
  readonly signal?: AbortSignal;
}

export type RuntimeEnvironment = "development" | "test" | "production";
