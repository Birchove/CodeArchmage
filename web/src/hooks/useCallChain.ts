/**
 * 剥洋葱数据 hook（阶段 5 循环 12）。
 *
 * 递归调 getCallers API 构建 callersMap，再调 flattenCallChain 展平。
 * 三重限制（cc B-5/B-6）：深度 5 / 宽度 10 / 总数 50。
 * 已查节点缓存（queried 集合）避免重复请求。
 *
 * cc S-3：reindex 后 selectedSymbol 被清空 → symbolId 变 null → 自动清空。
 */
import { useEffect, useState } from "react";
import { getCallers, getSymbolById } from "@/api/endpoints";
import { flattenCallChain, type CallChainPath } from "@/lib/onion";

const MAX_DEPTH = 5;
const MAX_WIDTH = 10;

export interface UseCallChainResult {
  paths: CallChainPath[];
  truncated: boolean;
  isLoading: boolean;
}

export function useCallChain(symbolId: number | null): UseCallChainResult {
  const [paths, setPaths] = useState<CallChainPath[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (symbolId === null) {
      setPaths([]);
      setTruncated(false);
      return;
    }

    let cancelled = false;
    const id: number = symbolId; // null 已在上方 return，此处窄化为 number
    const callersMap = new Map<number, import("@/api/types").SymbolOut[]>();
    const queried = new Set<number>();

    async function fetchChain(id: number, depth: number): Promise<void> {
      if (cancelled || depth >= MAX_DEPTH || queried.has(id)) return;
      queried.add(id);

      try {
        const callers = await getCallers(id);
        if (cancelled) return;

        callersMap.set(id, callers.slice(0, MAX_WIDTH));

        // 递归查每个 caller 的 callers
        await Promise.all(
          callers.slice(0, MAX_WIDTH).map((c) => fetchChain(c.id, depth + 1)),
        );
      } catch {
        // 单个节点查询失败 → 静默忽略
      }
    }

    async function run(): Promise<void> {
      setIsLoading(true);
      try {
        const target = await getSymbolById(id);
        if (cancelled) return;

        await fetchChain(id, 0);
        if (cancelled) return;

        const result = flattenCallChain(target, callersMap);
        setPaths(result.paths);
        setTruncated(result.truncated);
      } catch {
        // 目标符号查询失败 → 静默忽略
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [symbolId]);

  return { paths, truncated, isLoading };
}
