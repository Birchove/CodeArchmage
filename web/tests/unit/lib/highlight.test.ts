import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { buildCallMarks } from "@/lib/highlight";
import type { CallOut } from "@/api/types";

describe("buildCallMarks", () => {
  it("在调用点位置生成 decoration", () => {
    const doc = Text.of(["foo()", "bar()"]);
    const calls: CallOut[] = [
      { callee_name: "foo", callee_id: 1, line: 1, col: 0 },
      { callee_name: "bar", callee_id: 2, line: 2, col: 0 },
    ];
    const set = buildCallMarks(doc.lines, (line) => doc.line(line), calls);
    expect(set.size).toBe(2);
  });

  it("行号越界则跳过", () => {
    const doc = Text.of(["foo()"]);
    const calls: CallOut[] = [
      { callee_name: "zzz", callee_id: null, line: 99, col: 0 },
    ];
    const set = buildCallMarks(doc.lines, (line) => doc.line(line), calls);
    expect(set.size).toBe(0);
  });

  it("中文行：字节列偏移自动校正到码点列（A-3）", () => {
    // "# 中文 foo()"：foo 的 UTF-16 列是 5，parser 存的是 UTF-8 字节列 9
    const doc = Text.of(["# 中文 foo()"]);
    const calls: CallOut[] = [
      { callee_name: "foo", callee_id: 1, line: 1, col: 9 },
    ];
    const set = buildCallMarks(doc.lines, (line) => doc.line(line), calls);

    const ranges: Array<[number, number]> = [];
    const cursor = set.iter(0, doc.length);
    while (cursor.value) {
      ranges.push([cursor.from, cursor.to]);
      cursor.next();
    }
    // 应覆盖 UTF-16 的 5..8（"foo"），而不是字节列的 9..12
    expect(ranges).toEqual([[5, 8]]);
  });

  it("纯 ASCII 行：列不校正（A-3 回归）", () => {
    const doc = Text.of(["    foo()"]);
    const calls: CallOut[] = [
      { callee_name: "foo", callee_id: 1, line: 1, col: 4 },
    ];
    const set = buildCallMarks(doc.lines, (line) => doc.line(line), calls);

    const cursor = set.iter(0, doc.length);
    expect(cursor.value).toBeTruthy();
    expect([cursor.from, cursor.to]).toEqual([4, 7]);
  });
});
