/**
 * POST /api/index（mutation，含 pending/409/invalidate）。
 *
 * cc S-3：reindex 后符号 id 不稳定（SQLite rowid 重排），
 * 用 queryClient.clear() 清空全部缓存（含 fileContent、callers、callees、search）。
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { triggerIndex } from "@/api/endpoints";

export function useTriggerIndex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerIndex,
    onSuccess: () => {
      // cc S-3：清空全部缓存（符号 id 跨 reindex 不稳定）
      queryClient.clear();
    },
  });
}
