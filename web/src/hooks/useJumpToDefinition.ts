/**
 * 跳定义 hook（B-2：从 App 内联逻辑提取，使可测试）。
 *
 * 决策 10：
 * - jump-by-id（已解析）→ 精确跳
 * - jump-by-name（未解析）→ 名称匹配降级
 * - O-1：404 → 失效 fileContent 缓存
 *
 * Stage 7a A-1：多候选不再静默失败——通过 onCandidates 回调交给
 * 上层弹候选浮层（CandidatePicker），由用户点选跳转目标。
 */

import { useQueryClient } from "@tanstack/react-query";
import { getSymbolById, getSymbolsByName } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import { findCallAt, decideJump } from "@/lib/jump";
import type { CallOut, SymbolOut } from "@/api/types";

export interface JumpCallbacks {
  /** 打开目标文件并准备滚动到指定行。 */
  onOpenFile: (filePath: string, line: number) => void;
  /** 同文件内滚动到指定行。 */
  onSameFileScroll: (line: number) => void;
}

export interface JumpOptions {
  /** 多候选时的回调（弹浮层）；未提供则保持静默不跳转（A-1）。 */
  onCandidates?: (candidates: SymbolOut[]) => void;
}

export function useJumpToDefinition(
  currentFile: string | null,
  callbacks: JumpCallbacks,
  options: JumpOptions = {},
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
      } else if (candidates.length > 1) {
        // A-1：多候选交给上层弹浮层，用户点选后走 selectSymbol
        options.onCandidates?.(candidates);
      }
      // 0 候选：无定义可跳，保持静默（调用点可能是外部库/属性调用）
    }
  }

  function jumpFromPosition(calls: CallOut[], line: number, col: number): void {
    const call = findCallAt(calls, line, col);
    if (call) void jumpFromCall(call);
  }

  return { jumpFromCall, jumpFromPosition };
}
