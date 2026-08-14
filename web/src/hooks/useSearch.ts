/**
 * 全局搜索 hook（阶段 5 循环 1）。
 *
 * 内置 300ms 防抖（debounceMs 可配，测试传 0 跳过时序）。
 * 空查询 → enabled: false，不发请求。
 * limit 显式传 20（cc B-1：后端默认 200）。
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchSymbols } from "@/api/endpoints";
import type { SearchHitOut } from "@/api/types";

export function useSearch(query: string, debounceMs = 300) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const trimmed = debouncedQuery.trim();

  return useQuery<SearchHitOut[]>({
    queryKey: ["search", trimmed],
    queryFn: () => searchSymbols(trimmed, 20),
    enabled: trimmed !== "",
  });
}
