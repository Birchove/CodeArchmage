/**
 * 全局搜索栏（阶段 5 循环 2-3）。
 *
 * 内嵌 useSearch（防抖 300ms），结果以浮层下拉展示。
 * 空索引时禁用 + tooltip「请先索引」（cc Q4）。
 * 键盘导航：↑↓ 选择，Enter 跳转，Esc 关闭（循环 3）。
 * 点击外部关闭（循环 3）。
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { useSearch } from "@/hooks/useSearch";
import { Spinner } from "@/components/Spinner";
import type { SearchHitOut } from "@/api/types";

interface SearchBarProps {
  /** 是否已索引（false → 禁用搜索框）。 */
  isIndexed: boolean;
  /** 选中搜索结果时触发。 */
  onSelectResult: (hit: SearchHitOut) => void;
}

export function SearchBar({
  isIndexed,
  onSelectResult,
}: SearchBarProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results, isLoading } = useSearch(query);
  const hits = results ?? [];

  // 重置高亮当结果变化（依赖 results 而非 hits，避免每次渲染新建数组的 deps 警告）
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // 点击外部关闭（循环 3）
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function handleSelect(hit: SearchHitOut): void {
    onSelectResult(hit);
    setIsOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (!isOpen || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(hits[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div className="search-bar" ref={containerRef}>
      <input
        type="search"
        className="search-input"
        placeholder="搜索符号…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (query.trim()) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        disabled={!isIndexed}
        title={!isIndexed ? "请先索引" : undefined}
        aria-label="搜索符号"
        aria-expanded={isOpen && hits.length > 0}
        aria-controls="search-results-list"
        role="combobox"
        aria-autocomplete="list"
      />
      {isOpen && isLoading && (
        <div className="search-loading">
          <Spinner />
        </div>
      )}
      {isOpen && !isLoading && hits.length > 0 && (
        <ul className="search-results" role="listbox" id="search-results-list">
          {hits.map((hit, i) => (
            <li
              key={hit.symbol_id}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                className={
                  "search-result-item" +
                  (i === activeIndex ? " search-result-active" : "")
                }
                onClick={() => handleSelect(hit)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="search-result-kind">{hit.kind}</span>
                <span className="search-result-name">{hit.name}</span>
                <span className="search-result-file">
                  {hit.file_path}:{hit.line}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
