/** GET /api/files/tree */
import { useQuery } from "@tanstack/react-query";
import { getFileTree } from "@/api/endpoints";

export function useFileTree() {
  return useQuery({
    queryKey: ["fileTree"],
    queryFn: getFileTree,
  });
}
