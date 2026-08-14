/** POST /api/index（mutation，含 pending/409/invalidate，S-4） */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { triggerIndex } from "@/api/endpoints";

export function useTriggerIndex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerIndex,
    onSuccess: () => {
      // 索引成功后同时刷新文件树 + 索引状态（S-4）
      void queryClient.invalidateQueries({ queryKey: ["fileTree"] });
      void queryClient.invalidateQueries({ queryKey: ["indexStatus"] });
    },
  });
}
