import { describe, it, expect } from "vitest";
import { buildTree, type TreeNode } from "@/lib/tree";

describe("lib/tree — buildTree", () => {
  it("空数组返回空树", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("单文件（无目录）", () => {
    const tree = buildTree(["main.py"]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      name: "main.py",
      path: "main.py",
      isDir: false,
    });
  });

  it("嵌套路径构建目录 + 文件", () => {
    const tree = buildTree(["a/b.py", "a/c.py", "d.py"]);
    expect(tree).toHaveLength(2);

    // d.py 在顶层
    const d = tree.find((n) => n.name === "d.py");
    expect(d?.isDir).toBe(false);

    // a/ 是目录，含 b.py + c.py
    const a = tree.find((n) => n.name === "a");
    expect(a?.isDir).toBe(true);
    expect(a?.children?.map((c) => c.name).sort()).toEqual(["b.py", "c.py"]);
  });

  it("乱序输入 → 有序输出（目录优先，再按名字）", () => {
    const tree = buildTree(["z.py", "a/d.py", "a/b.py", "m.py"]);

    // 顶层：目录 a 在前，文件按名排
    const topNames = tree.map((n) => n.name);
    expect(topNames).toEqual(["a", "m.py", "z.py"]);

    // a 下：b.py 在 d.py 前
    const a = tree.find((n) => n.name === "a");
    expect(a?.children?.map((c) => c.name)).toEqual(["b.py", "d.py"]);
  });

  it("深层嵌套（3+ 层）", () => {
    const tree = buildTree(["a/b/c/d.py"]);
    expect(tree).toHaveLength(1);
    const a = tree[0];
    expect(a.name).toBe("a");
    expect(a.children?.[0].name).toBe("b");
    expect(a.children?.[0].children?.[0].name).toBe("c");
    expect(a.children?.[0].children?.[0].children?.[0].name).toBe("d.py");
  });

  it("path 字段记录完整相对路径", () => {
    const tree = buildTree(["src/utils/helper.py"]);
    const src = tree[0];
    const utils = src.children![0];
    const helper = utils.children![0];
    expect(src.path).toBe("src");
    expect(utils.path).toBe("src/utils");
    expect(helper.path).toBe("src/utils/helper.py");
  });

  it("TreeNode 类型可被引用（编译期断言）", () => {
    const node: TreeNode = { name: "x", path: "x", isDir: false };
    expect(node.isDir).toBe(false);
  });
});
