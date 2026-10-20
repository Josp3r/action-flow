const sensitiveKey = /password|passwd|token|secret|authorization|cookie|api[-_]?key|credential/iu;

/** Snapshot only data properties: never call a user's getter or toJSON(). */
export function snapshotTraceValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let remaining = 1_000;

  const visit = (current: unknown, depth: number): unknown => {
    if (--remaining < 0) return "[Truncated]";
    if (typeof current === "string") return current.length > 2_048 ? `${current.slice(0, 2_048)}[Truncated]` : current;
    if (current === null || current === undefined || typeof current === "boolean" || typeof current === "number") return current;
    if (typeof current === "bigint") return `${current}n`;
    if (typeof current !== "object") return `[${typeof current}]`;
    if (depth >= 8) return "[MaxDepth]";
    if (seen.has(current)) return "[Circular]";
    seen.add(current);
    try {
      if (current instanceof Date) return Date.prototype.toISOString.call(current);
      const descriptors = Object.getOwnPropertyDescriptors(current);
      if (Array.isArray(current)) {
        const length = Math.min(current.length, 100);
        const items = Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          return descriptor === undefined ? undefined : "value" in descriptor ? visit(descriptor.value, depth + 1) : "[Accessor]";
        });
        if (current.length > length) items.push("[Truncated]");
        return Object.freeze(items);
      }
      const result: Record<string, unknown> = Object.create(null);
      let count = 0;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (current instanceof Error && key === "stack") continue;
        if (!(descriptor.enumerable || (current instanceof Error && ["name", "message", "cause", "errors"].includes(key)))) continue;
        if (count++ >= 100 || remaining <= 0) { result["[Truncated]"] = true; break; }
        result[key] = sensitiveKey.test(key) ? "[REDACTED]"
          : "value" in descriptor ? visit(descriptor.value, depth + 1) : "[Accessor]";
      }
      if (current instanceof Error && !("name" in result)) {
        const prototype: object | null = Object.getPrototypeOf(current);
        const descriptor = prototype === null ? undefined : Object.getOwnPropertyDescriptor(prototype, "name");
        result.name = descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : "Error";
      }
      return Object.freeze(result);
    } catch {
      return "[Unserializable]";
    }
  };
  return visit(value, 0);
}
