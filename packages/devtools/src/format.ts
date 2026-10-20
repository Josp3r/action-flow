import { snapshotTraceValue } from "@action-flow/core";
import type { ExecutionRecord } from "@action-flow/core";

export function formatValue(value: unknown): string {
  return JSON.stringify(snapshotTraceValue(value), null, 2) ?? "undefined";
}

export interface TraceNode {
  readonly record: ExecutionRecord;
  readonly children: TraceNode[];
  readonly missingParent: boolean;
}
/** Handles truncated traces, self-links and cycles without losing records or recursing forever. */
export function buildTraceForest(records: readonly ExecutionRecord[]): readonly TraceNode[] {
  const nodes = new Map(records.map((record) => [record.executionId, { record, children: [] as TraceNode[], missingParent: false }]));
  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.record.parentExecutionId;
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    const chain = new Set([node.record.executionId]);
    let ancestor = parent;
    while (ancestor && !chain.has(ancestor.record.executionId)) {
      chain.add(ancestor.record.executionId);
      ancestor = nodes.get(ancestor.record.parentExecutionId ?? "");
    }
    if (parent === undefined || ancestor !== undefined || parent.record.traceId !== node.record.traceId) {
      node.missingParent = parentId !== undefined;
      roots.push(node);
    } else parent.children.push(node);
  }
  return roots;
}
