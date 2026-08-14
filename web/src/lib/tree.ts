/**
 * 扁平路径 → 嵌套树（纯函数）。
 *
 * 后端 FileTreeOut.paths 返回 POSIX 相对路径数组（如 "a/b/c.py"），
 * 前端用此函数构建递归渲染所需的嵌套结构。
 */

export interface TreeNode {
  name: string;
  /** 完整相对路径（目录为 "a/b"，文件为 "a/b/c.py"）。 */
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const relPath of paths) {
    const parts = relPath.split("/");
    let cursor = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isLast = i === parts.length - 1;
      cursor.children ??= [];
      let child = cursor.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: acc,
          isDir: !isLast,
          children: isLast ? undefined : [],
        };
        cursor.children.push(child);
      }
      cursor = child;
    }
  }

  return sortNodes(root.children ?? []);
}

/** 目录优先，再按名字字母序；递归排序子树。 */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of sorted) {
    if (n.children) n.children = sortNodes(n.children);
  }
  return sorted;
}
