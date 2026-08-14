/** GET /api/files/{path} */
import { useQuery } from "@tanstack/react-query";
import { getFileContent } from "@/api/endpoints";

export function useFileContent(filePath: string | null) {
  return useQuery({
    queryKey: ["fileContent", filePath],
    queryFn: () => getFileContent(filePath!),
    enabled: filePath !== null,
  });
}
