/**
 * useSummary（循环 15）。
 *
 * 惰性摘要 hook——先查缓存（GET），未命中则生成（POST）。
 * useQuery 查缓存，useMutation 触发生成。
 * 生成成功后 invalidate 缓存（下次 GET 命中）。
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSummary, createSummary } from "@/api/endpoints";
import type { SummaryResponse } from "@/api/types";

export function useSummary(symbolId: number | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["summary", symbolId],
    queryFn: () => getSummary(symbolId!),
    enabled: symbolId !== null,
    retry: false, // 404 = 未生成，不重试
  });

  const generate = useMutation({
    mutationFn: () => createSummary(symbolId!),
    onSuccess: (data: SummaryResponse) => {
      // 直接写入缓存（避免再发一次 GET）
      queryClient.setQueryData(["summary", symbolId], data);
    },
  });

  return {
    summary: query.data,
    isLoading: query.isLoading,
    error: query.isError ? "摘要未生成" : null,
    generate: () => generate.mutate(),
    isGenerating: generate.isPending,
    generateError: generate.error ? "生成失败" : null,
  };
}
