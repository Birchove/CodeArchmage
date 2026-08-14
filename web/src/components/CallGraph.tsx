/**
 * 调用图组件（阶段 5 循环 8-9）。
 *
 * 用 @xyflow/react 渲染 buildCallGraph 的三列布局。
 * 中心节点高亮（callgraph-node-center）。
 * 点击节点 → onNodeSelect（循环 9，复用 useJumpToDefinition）。
 * 诚实提示：调用关系按名匹配，可能不准（cc S-2）。
 */
import { type JSX, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildCallGraph, type CallGraphNodeData } from "@/lib/callgraph";
import type { SymbolOut } from "@/api/types";

interface CallGraphProps {
  center: SymbolOut;
  callers: SymbolOut[];
  callees: SymbolOut[];
  onNodeSelect: (sym: SymbolOut) => void;
}

export function CallGraph({
  center,
  callers,
  callees,
  onNodeSelect,
}: CallGraphProps): JSX.Element {
  const { nodes: rawNodes, edges } = buildCallGraph(center, callers, callees);

  // 转换为 react-flow 格式，中心节点加 className
  const nodes: Node[] = rawNodes.map((n) => ({
    ...n,
    data: n.data as unknown as Record<string, unknown>,
    className: n.data.isCenter ? "callgraph-node-center" : undefined,
  }));

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // react-flow 内部用 Record<string, unknown>，我们存了完整 CallGraphNodeData
      const data = node.data as unknown as CallGraphNodeData;
      onNodeSelect(data.symbol);
    },
    [onNodeSelect],
  );

  const flowEdges: Edge[] = edges.map((e) => ({
    ...e,
    type: "default",
  }));

  if (nodes.length <= 1) {
    return (
      <div className="callgraph-empty">
        <p>选中符号后显示调用关系</p>
      </div>
    );
  }

  return (
    <div className="callgraph-container">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodeClick={handleNodeClick}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      <p className="callgraph-hint">⚠ 调用关系按名匹配，可能不准</p>
    </div>
  );
}
