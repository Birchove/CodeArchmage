/** GET /api/health（连通性探测，O-2） */
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/api/endpoints";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    // 健康检查不重试，快速失败
    retry: false,
  });
}
