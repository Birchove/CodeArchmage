/**
 * 导读数据 hooks（Stage 7b；Stage 8 增加自动生成）。
 *
 * useGuideTree：导读目录（确定性）。
 * useGuide：单篇导读的缓存读取 + SSE 流式生成。
 * useAutoGenerate：「生成并查看导读」入口的一次性自动触发生成。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGuideGenerate, getGuide, getGuideTree } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";
import type { GuideOut, GuideScope } from "@/api/types";

/** 导读目录。 */
export function useGuideTree() {
  return useQuery({ queryKey: ["guideTree"], queryFn: getGuideTree });
}

export interface UseGuideReturn {
  /** 缓存的导读（未生成或生成中为 null）。 */
  guide: GuideOut | null;
  isLoading: boolean;
  /** 生成中实时累积的 markdown。 */
  streamMd: string;
  isGenerating: boolean;
  generateError: string | null;
  generate: () => void;
}

/** 单篇导读：缓存 + 生成。scope/path 变化时 react-query 自动换 key。 */
export function useGuide(scope: GuideScope, path: string): UseGuideReturn {
  const queryClient = useQueryClient();

  const guideQuery = useQuery({
    queryKey: ["guide", scope, path],
    queryFn: () => getGuide(scope, path),
    retry: false, // 404 = 未生成，不重试
  });

  const [streamMd, setStreamMd] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStreamMd("");
    setGenerateError(null);

    const run = async () => {
      try {
        const resp = await fetchGuideGenerate(scope, path, controller.signal);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        let md = "";
        for await (const chunk of parseSSEStream(resp, controller.signal)) {
          if (controller.signal.aborted) break;
          if (chunk.error) {
            setGenerateError(chunk.error);
            break;
          }
          if (chunk.delta) {
            md += chunk.delta;
            setStreamMd(md);
          }
        }
        // 生成完成后刷新缓存（落库在后端 SSE 末尾完成）
        await queryClient.invalidateQueries({ queryKey: ["guideTree"] });
        await queryClient.invalidateQueries({
          queryKey: ["guide", scope, path],
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setGenerateError(err instanceof Error ? err.message : "未知错误");
        }
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    };

    void run();
  }, [scope, path, queryClient]);

  return {
    guide: guideQuery.data ?? null,
    isLoading: guideQuery.isLoading,
    streamMd,
    isGenerating,
    generateError,
    generate,
  };
}

// ---------------------------------------------------------------------------
// Stage 8：自动生成（「生成并查看导读」入口）
// ---------------------------------------------------------------------------

export interface AutoGenerateOptions {
  /** 是否允许自动生成（来自阅读模式入口的一次性信号）。 */
  enabled: boolean;
  /** 缓存查询是否仍在加载（加载完成前不决策，避免误触）。 */
  isLoading: boolean;
  /** 当前缓存的导读。 */
  guide: GuideOut | null;
  /** useGuide 的生成函数。 */
  generate: () => void;
  /** 实际触发生成时回调一次（调用方用来消费一次性信号）。 */
  onStart?: () => void;
}

/**
 * 一次性自动生成：加载完成后，无导读或导读已 stale → 触发一次 generate。
 *
 * 防无限循环：startedRef 保证同一挂载只触发一次。生成完成 / 失败引发的
 * guide 更新与缓存失效会重跑 effect，但不再二次触发；组件因 selection
 * 变化重挂载时由调用方消费一次性信号（onStart）避免再次进入。
 */
export function useAutoGenerate({
  enabled,
  isLoading,
  guide,
  generate,
  onStart,
}: AutoGenerateOptions): void {
  const startedRef = useRef(false);
  useEffect(() => {
    if (!enabled || startedRef.current || isLoading) return;
    if (guide !== null && !guide.stale) return; // 已有新鲜缓存 → 无需生成
    startedRef.current = true;
    onStart?.();
    generate();
  }, [enabled, isLoading, guide, generate, onStart]);
}
