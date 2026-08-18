/**
 * 顶部状态栏：仓库名 + 模式切换 + 搜索框 + 索引状态 + 索引按钮。
 *
 * S-4：索引中（isIndexing）→ 按钮 disabled + "索引中…"。
 * B-4：file_count===0 兼容"未索引/无 .py"两种情况。
 * 阶段 5：嵌入 SearchBar（索引按钮左侧）。
 * Stage 7a A-5：已索引时按钮文案「重新索引」+ 显示增量统计（更新 X / 跳过 Y）。
 * Stage 7b：阅读/导读模式分段控件。
 */

import { type JSX } from "react";
import { SearchBar } from "@/components/SearchBar";
import type { IndexResultOut, SearchHitOut } from "@/api/types";

export type AppMode = "read" | "guide";

interface HeaderProps {
  repoRoot: string;
  indexStatus: "idle" | "indexed" | "error";
  fileCount?: number;
  isIndexing: boolean;
  /** 索引错误（如 409 互斥），显示在状态栏（B-3）。 */
  indexError?: string | null;
  /** 最近一次索引结果（Stage 7a A-5），显示增量统计。 */
  lastIndex?: IndexResultOut | null;
  onTriggerIndex: () => void;
  /** 搜索是否可用（已索引）。 */
  isSearchEnabled: boolean;
  /** 搜索结果选中回调。 */
  onSearchSelect: (hit: SearchHitOut) => void;
  /** 当前模式（Stage 7b）。 */
  mode: AppMode;
  /** 模式切换回调。 */
  onModeChange: (mode: AppMode) => void;
}

export function Header({
  repoRoot,
  indexStatus,
  fileCount,
  isIndexing,
  indexError,
  lastIndex = null,
  onTriggerIndex,
  isSearchEnabled,
  onSearchSelect,
  mode,
  onModeChange,
}: HeaderProps): JSX.Element {
  const indexed = indexStatus === "indexed";
  return (
    <header className="app-header">
      <span className="app-title">Code Archmage</span>
      <span className="repo-root">{repoRoot}</span>
      <div className="mode-switch" role="group" aria-label="视图模式">
        <button
          type="button"
          className={`mode-btn${mode === "read" ? " active" : ""}`}
          aria-pressed={mode === "read"}
          onClick={() => onModeChange("read")}
        >
          阅读
        </button>
        <button
          type="button"
          className={`mode-btn${mode === "guide" ? " active" : ""}`}
          aria-pressed={mode === "guide"}
          onClick={() => onModeChange("guide")}
        >
          导读
        </button>
      </div>
      <span className="index-status">
        {indexError
          ? indexError
          : indexed && fileCount !== undefined
            ? `已索引 ${fileCount} 个文件` +
              (lastIndex
                ? `（更新 ${lastIndex.files_updated} / 跳过 ${lastIndex.files_skipped}）`
                : "")
            : "未索引"}
      </span>
      <SearchBar isIndexed={isSearchEnabled} onSelectResult={onSearchSelect} />
      <button
        type="button"
        className="index-btn"
        disabled={isIndexing}
        onClick={onTriggerIndex}
      >
        {isIndexing ? "索引中…" : indexed ? "重新索引" : "索引"}
      </button>
    </header>
  );
}
