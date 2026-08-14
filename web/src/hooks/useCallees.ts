/**
 * 查询符号的直接被调用者（阶段 5 循环 6）。
 *
 * 后端含多候选（cc S-2）：callee_id 为 NULL 时返回所有同名候选。
 * symbolId 为 null → 不发请求。
 */
import { useQuery } from "@tanstack/react-query";
import { getCallees } from "@/api/endpoints";
import type { SymbolOut } from "@/api/types";

export function useCallees(symbolId: number | null) {
  return useQuery<SymbolOut[]>({
    queryKey: ["callees", symbolId],
    queryFn: () => getCallees(symbolId!),
    enabled: symbolId !== null,
  });
}
