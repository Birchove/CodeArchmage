/**
 * 查询符号的直接调用者（阶段 5 循环 6）。
 *
 * 后端按名匹配（cc S-2）：同名函数的调用者会合并。
 * symbolId 为 null → 不发请求。
 */
import { useQuery } from "@tanstack/react-query";
import { getCallers } from "@/api/endpoints";
import type { SymbolOut } from "@/api/types";

export function useCallers(symbolId: number | null) {
  return useQuery<SymbolOut[]>({
    queryKey: ["callers", symbolId],
    queryFn: () => getCallers(symbolId!),
    enabled: symbolId !== null,
  });
}
