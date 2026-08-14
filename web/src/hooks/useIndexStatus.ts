/** GET /api/index/status */
import { useQuery } from "@tanstack/react-query";
import { getIndexStatus } from "@/api/endpoints";

export function useIndexStatus() {
  return useQuery({
    queryKey: ["indexStatus"],
    queryFn: getIndexStatus,
  });
}
