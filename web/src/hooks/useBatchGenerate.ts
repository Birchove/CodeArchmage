/**
 * 全库导读批量生成（Stage 8 导读闭环）。
 *
 * 串行调用现有 POST /api/guides/generate（不新增后端批量端点）：
 * 调用方传入已过滤掉 cached 的目标列表，逐个流式生成并落库。
 * 支持进度（done/total）、中止、单项失败即停（已生成的不回滚）。
 */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchGuideGenerate } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";
import type { GuideScope } from "@/api/types";

export interface BatchTarget {
  scope: GuideScope;
  /** 项目导读为 ""。 */
  path: string;
}

export interface UseBatchGenerateReturn {
  isRunning: boolean;
  /** 已完成个数（不含被跳过的 cached；cached 在调用方过滤）。 */
  done: number;
  total: number;
  /** 正在生成的目标显示名（项目总览 / 路径）。 */
  currentLabel: string | null;
  batchError: string | null;
  start: (targets: BatchTarget[]) => void;
  abort: () => void;
}

/** 目标的显示名（进度文案用）。 */
export function batchTargetLabel(target: BatchTarget): string {
  return target.scope === "project" ? "项目总览" : target.path;
}

export function useBatchGenerate(): UseBatchGenerateReturn {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    (targets: BatchTarget[]) => {
      if (abortRef.current !== null || targets.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);
      setDone(0);
      setTotal(targets.length);
      setCurrentLabel(null);
      setBatchError(null);

      const run = async () => {
        try {
          let completed = 0;
          for (const target of targets) {
            if (controller.signal.aborted) break;
            setCurrentLabel(batchTargetLabel(target));
            const resp = await fetchGuideGenerate(
              target.scope,
              target.path,
              controller.signal,
            );
            if (!resp.ok) {
              throw new Error(`HTTP ${resp.status}`);
            }
            // 排空 SSE 流：后端在流末尾落库，必须读完才算生成完成
            for await (const chunk of parseSSEStream(resp, controller.signal)) {
              if (controller.signal.aborted) break;
              if (chunk.error) {
                throw new Error(chunk.error);
              }
            }
            if (controller.signal.aborted) break;
            completed += 1;
            setDone(completed);
            // 刷新该篇导读与目录状态（左侧状态标记实时更新）
            await queryClient.invalidateQueries({
              queryKey: ["guide", target.scope, target.path],
            });
            await queryClient.invalidateQueries({ queryKey: ["guideTree"] });
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            setBatchError(err instanceof Error ? err.message : "未知错误");
          }
        } finally {
          setCurrentLabel(null);
          setIsRunning(false);
          abortRef.current = null;
        }
      };

      void run();
    },
    [queryClient],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { isRunning, done, total, currentLabel, batchError, start, abort };
}
