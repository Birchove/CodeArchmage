/**
 * 顶部状态栏：仓库名 + 搜索框 + 索引状态 + 索引按钮。
 *
 * S-4：索引中（isIndexing）→ 按钮 disabled + "索引中…"。
 * B-4：file_count===0 兼容"未索引/无 .py"两种情况。
 * 阶段 5：嵌入 SearchBar（索引按钮左侧）。
 */

import { type JSX } from "react";
import { SearchBar } from "@/components/SearchBar";
import type { SearchHitOut } from "@/api/types";

interface HeaderProps {
  repoRoot: string;
  indexStatus: "idle" | "indexed" | "error";
  fileCount?: number;
  isIndexing: boolean;
  /** 索引错误（如 409 互斥），显示在状态栏（B-3）。 */
  indexError?: string | null;
  onTriggerIndex: () => void;
  /** 搜索是否可用（已索引）。 */
  isSearchEnabled: boolean;
  /** 搜索结果选中回调。 */
  onSearchSelect: (hit: SearchHitOut) => void;
}

export function Header({
  repoRoot,
  indexStatus,
  fileCount,
  isIndexing,
  indexError,
  onTriggerIndex,
  isSearchEnabled,
  onSearchSelect,
}: HeaderProps): JSX.Element {
  return (
    <header className="app-header">
      <span className="app-title">Code Archmage</span>
      <span className="repo-root">{repoRoot}</span>
      <span className="index-status">
        {indexError
          ? indexError
          : indexStatus === "indexed" && fileCount !== undefined
            ? `已索引 ${fileCount} 个文件`
            : "未索引"}
      </span>
      <SearchBar isIndexed={isSearchEnabled} onSelectResult={onSearchSelect} />
      <button
        type="button"
        className="index-btn"
        disabled={isIndexing}
        onClick={onTriggerIndex}
      >
        {isIndexing ? "索引中…" : "索引"}
      </button>
    </header>
  );
}
