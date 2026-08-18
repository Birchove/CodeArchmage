/**
 * 导读数据 hooks（Stage 7b）。
 *
 * useGuideTree：导读目录（确定性）。
 * useGuide：单篇导读的缓存读取 + SSE 流式生成。
 */
import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGuideGenerate, getGuide, getGuideTree } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";
import type { GuideScope } from "@/api/types";

/** 导读目录。 */
export function useGuideTree() {
  return useQuery({ queryKey: ["guideTree"], queryFn: getGuideTree });
}

export interface UseGuideReturn {
  /** 缓存的导读（未生成或生成中为 null）。 */
  guide: import("@/api/types").GuideOut | null;
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
        for await (const chunk of parseSSEStream(resp)) {
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
