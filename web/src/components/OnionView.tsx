/**
 * 剥洋葱视图（阶段 5 循环 13）。
 *
 * 渲染 useCallChain 返回的路径[]，每条路径从入口到目标。
 * 当前符号（路径末尾）高亮。
 * 截断提示 + 诚实文案（cc S-2）。
 * 点击节点 → onNodeSelect（跳转）。
 */
import { type JSX } from "react";
import { useCallChain } from "@/hooks/useCallChain";
import { Spinner } from "@/components/Spinner";
import type { SymbolOut } from "@/api/types";

interface OnionViewProps {
  symbolId: number;
  onNodeSelect: (sym: SymbolOut) => void;
}

export function OnionView({
  symbolId,
  onNodeSelect,
}: OnionViewProps): JSX.Element {
  const { paths, truncated, isLoading } = useCallChain(symbolId);

  if (isLoading) {
    return <Spinner />;
  }

  if (paths.length === 0) {
    return <p className="onion-empty">无调用链数据</p>;
  }

  return (
    <div className="onion-view">
      {truncated && (
        <p className="onion-truncated">⚠ 链路过长，已截断（最多 50 条路径）</p>
      )}
      <p className="onion-hint">⚠ 按名匹配，同名符号可能交叉</p>
      {paths.map((path, pathIdx) => (
        <div key={pathIdx} className="onion-path">
          <h4 className="onion-path-title">
            路径 {pathIdx + 1}（{path.symbols.length} 层）
          </h4>
          <ul className="onion-chain">
            {path.symbols.map((sym, symIdx) => {
              const isCurrent = symIdx === path.symbols.length - 1;
              return (
                <li
                  key={sym.id}
                  className={"onion-node" + (isCurrent ? " onion-current" : "")}
                >
                  <button
                    type="button"
                    className="onion-node-btn"
                    onClick={() => onNodeSelect(sym)}
                  >
                    {sym.name}
                  </button>
                  <span className="onion-node-file">
                    {sym.file_path}:{sym.line}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
