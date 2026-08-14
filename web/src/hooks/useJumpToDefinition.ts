/**
 * 跳定义 hook（B-2：从 App 内联逻辑提取，使可测试）。
 *
 * 决策 10：
 * - jump-by-id（已解析）→ 精确跳
 * - jump-by-name（未解析）→ 名称匹配降级
 * - O-1：404 → 失效 fileContent 缓存
 */

import { useQueryClient } from "@tanstack/react-query";
import { getSymbolById, getSymbolsByName } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import { findCallAt, decideJump } from "@/lib/jump";
import type { CallOut } from "@/api/types";

export interface JumpCallbacks {
  /** 打开目标文件并准备滚动到指定行。 */
  onOpenFile: (filePath: string, line: number) => void;
  /** 同文件内滚动到指定行。 */
  onSameFileScroll: (line: number) => void;
}

export function useJumpToDefinition(
  currentFile: string | null,
  callbacks: JumpCallbacks,
): {
  jumpFromCall: (call: CallOut) => Promise<void>;
  jumpFromPosition: (calls: CallOut[], line: number, col: number) => void;
} {
  const queryClient = useQueryClient();

  async function jumpFromCall(call: CallOut): Promise<void> {
    const action = decideJump(call);

    if (action.type === "jump-by-id") {
      try {
        const sym = await getSymbolById(action.calleeId);
        if (sym.file_path !== currentFile) {
          callbacks.onOpenFile(sym.file_path, sym.line);
        } else {
          callbacks.onSameFileScroll(sym.line);
        }
      } catch (e: unknown) {
        // O-1：404 → 失效缓存（符号 id 跨索引不稳定）
        // 失效 fileContent + symbol 两个 key；重试 + toast 留阶段 5
        if (e instanceof ApiError && e.status === 404) {
          void queryClient.invalidateQueries({ queryKey: ["fileContent"] });
          void queryClient.invalidateQueries({ queryKey: ["symbol"] });
        }
      }
    } else if (action.type === "jump-by-name") {
      const candidates = await getSymbolsByName(action.calleeName);
      if (candidates.length === 1) {
        const sym = candidates[0];
        if (sym.file_path !== currentFile) {
          callbacks.onOpenFile(sym.file_path, sym.line);
        } else {
          callbacks.onSameFileScroll(sym.line);
        }
      }
      // 多候选 → 留阶段 5 调用图细化
    }
  }

  function jumpFromPosition(calls: CallOut[], line: number, col: number): void {
    const call = findCallAt(calls, line, col);
    if (call) void jumpFromCall(call);
  }

  return { jumpFromCall, jumpFromPosition };
}
