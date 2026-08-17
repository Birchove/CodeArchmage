/**
 * useLLMConfig（循环 14 辅助）。
 *
 * 查询 LLM 配置状态（GET /api/llm/config）。
 * 用于 ChatPanel 显示配置引导 / 禁用输入。
 */
import { useQuery } from "@tanstack/react-query";
import { getLLMConfig } from "@/api/endpoints";

export function useLLMConfig() {
  return useQuery({
    queryKey: ["llm-config"],
    queryFn: getLLMConfig,
    staleTime: 60_000, // 1 分钟内不重复查询
  });
}
