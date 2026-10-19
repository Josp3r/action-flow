export function executionSignal(parent: AbortSignal | undefined, requested: AbortSignal | undefined) {
  if (parent === undefined || parent === requested) {
    return { signal: requested ?? new AbortController().signal, release() {} };
  }
  if (requested === undefined) return { signal: parent, release() {} };
  const controller = new AbortController();
  const signals = [parent, requested];
  const callbacks = signals.map((signal) => () => controller.abort(signal.reason));
  const release = () => signals.forEach((signal, index) => signal.removeEventListener("abort", callbacks[index]!));
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); return { signal: controller.signal, release }; }
  }
  signals.forEach((signal, index) => signal.addEventListener("abort", callbacks[index]!, { once: true }));
  return { signal: controller.signal, release };
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
