/**
 * 调用图布局纯函数（阶段 5 循环 7）。
 *
 * 三列手动定位（不用 dagre）：
 *   callers 左列（x=0）  center 中列（x=COL_WIDTH）  callees 右列（x=2*COL_WIDTH）
 *
 * cc S-2：后端 callers/callees 按名匹配，不附带精确性元信息。
 * 零引擎改动约束下，所有边统一样式（组件层加诚实提示）。
 */

import type { SymbolOut } from "@/api/types";

const COL_WIDTH = 200;
const ROW_HEIGHT = 80;

export interface CallGraphNodeData {
  label: string;
  symbol: SymbolOut;
  isCenter: boolean;
}

export interface CallGraphNodeType {
  id: string;
  data: CallGraphNodeData;
  position: { x: number; y: number };
}

export interface CallGraphEdgeType {
  id: string;
  source: string;
  target: string;
}

export interface CallGraphData {
  nodes: CallGraphNodeType[];
  edges: CallGraphEdgeType[];
}

function symNodeId(id: number): string {
  return `sym-${id}`;
}

export function buildCallGraph(
  center: SymbolOut,
  callers: SymbolOut[],
  callees: SymbolOut[],
): CallGraphData {
  const nodes: CallGraphNodeType[] = [];
  const edges: CallGraphEdgeType[] = [];

  // 中心节点（中列，y=0）
  nodes.push({
    id: symNodeId(center.id),
    data: { label: center.name, symbol: center, isCenter: true },
    position: { x: COL_WIDTH, y: 0 },
  });

  // callers（左列，围绕 y=0 等距分布）
  const callerCount = callers.length;
  callers.forEach((sym, i) => {
    const y = callerCount > 1 ? (i - (callerCount - 1) / 2) * ROW_HEIGHT : 0;
    nodes.push({
      id: symNodeId(sym.id),
      data: { label: sym.name, symbol: sym, isCenter: false },
      position: { x: 0, y },
    });
    edges.push({
      id: `edge-${sym.id}-${center.id}`,
      source: symNodeId(sym.id),
      target: symNodeId(center.id),
    });
  });

  // callees（右列，围绕 y=0 等距分布）
  const calleeCount = callees.length;
  callees.forEach((sym, i) => {
    const y = calleeCount > 1 ? (i - (calleeCount - 1) / 2) * ROW_HEIGHT : 0;
    nodes.push({
      id: symNodeId(sym.id),
      data: { label: sym.name, symbol: sym, isCenter: false },
      position: { x: COL_WIDTH * 2, y },
    });
    edges.push({
      id: `edge-${center.id}-${sym.id}`,
      source: symNodeId(center.id),
      target: symNodeId(sym.id),
    });
  });

  return { nodes, edges };
}
