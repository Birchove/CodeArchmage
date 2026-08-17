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
});
