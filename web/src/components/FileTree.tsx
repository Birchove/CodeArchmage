/**
 * 文件树（递归 + 折叠/展开）。
 *
 * 后端返回扁平路径，前端 buildTree 构建嵌套结构后传入此组件。
 * 可点击项用 <button type="button">（a11y O-6）。
 */

import { useState, type JSX } from "react";
import type { TreeNode } from "@/lib/tree";

interface FileTreeProps {
  nodes: TreeNode[];
  onSelect: (path: string) => void;
}

export function FileTree({ nodes, onSelect }: FileTreeProps): JSX.Element {
  if (nodes.length === 0) {
    return <p className="file-tree-empty">无文件</p>;
  }
  return (
    <ul className="file-tree" role="tree">
      {nodes.map((n) => (
        <TreeItem key={n.path} node={n} onSelect={onSelect} level={0} />
      ))}
    </ul>
  );
}

interface TreeItemProps {
  node: TreeNode;
  onSelect: (path: string) => void;
  level: number;
}

function TreeItem({ node, onSelect, level }: TreeItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  if (node.isDir) {
    return (
      <li role="treeitem" aria-expanded={expanded}>
        <button
          type="button"
          className="tree-item dir"
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="icon">{expanded ? "▾" : "▸"}</span>
          <span className="name">{node.name}</span>
        </button>
        {expanded && node.children && (
          <ul role="group">
            {node.children.map((c) => (
              <TreeItem
                key={c.path}
                node={c}
                onSelect={onSelect}
                level={level + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li role="treeitem">
      <button
        type="button"
        className="tree-item file"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(node.path)}
      >
        <span className="icon">📄</span>
        <span className="name">{node.name}</span>
      </button>
    </li>
  );
}
