/**
 * 右侧面板（阶段 5 循环 10）。
 *
 * 双标签页：调用图 / 剥洋葱。
 * cc B-2：标签页切换保持挂载（visibility 控制），避免 react-flow 容器测量为 0
 * 和 useCallChain 每次切回全量重跑（111 次请求）。
 * 面板可折叠（折叠时 visibility:hidden + width:0，保持挂载）。
 */
import { type JSX, useState } from "react";
import { CallGraph } from "@/components/CallGraph";
import { OnionView } from "@/components/OnionView";
import { useCallers } from "@/hooks/useCallers";
import { useCallees } from "@/hooks/useCallees";
import { Spinner } from "@/components/Spinner";
import type { SymbolOut } from "@/api/types";

type Tab = "callgraph" | "onion";

interface SidePanelProps {
  selectedSymbol: SymbolOut | null;
  onNodeSelect: (sym: SymbolOut) => void;
}

export function SidePanel({
  selectedSymbol,
  onNodeSelect,
}: SidePanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("callgraph");
  const [collapsed, setCollapsed] = useState(false);

  const callers = useCallers(selectedSymbol?.id ?? null);
  const callees = useCallees(selectedSymbol?.id ?? null);

  return (
    <aside className={collapsed ? "app-aside aside-collapsed" : "app-aside"}>
      <div className="sidepanel-header">
        <div className="sidepanel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "callgraph"}
            className={
              activeTab === "callgraph"
                ? "sidepanel-tab active"
                : "sidepanel-tab"
            }
            onClick={() => setActiveTab("callgraph")}
          >
            调用图
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "onion"}
            className={
              activeTab === "onion" ? "sidepanel-tab active" : "sidepanel-tab"
            }
            onClick={() => setActiveTab("onion")}
          >
            剥洋葱
          </button>
        </div>
        <button
          type="button"
          className="aside-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "展开面板" : "折叠面板"}
        >
          {collapsed ? "◀" : "▶"}
        </button>
      </div>
      <div className="sidepanel-content">
        {/* cc B-2：两个面板都保持挂载，用 visibility 控制显示 */}
        <div
          className={
            activeTab === "callgraph"
              ? "sidepanel-pane active"
              : "sidepanel-pane"
          }
        >
          {selectedSymbol ? (
            callers.isLoading || callees.isLoading ? (
              <Spinner />
            ) : (
              <CallGraph
                center={selectedSymbol}
                callers={callers.data ?? []}
                callees={callees.data ?? []}
                onNodeSelect={onNodeSelect}
              />
            )
          ) : (
            <p className="sidepanel-empty">选中符号后显示调用关系</p>
          )}
        </div>
        <div
          className={
            activeTab === "onion" ? "sidepanel-pane active" : "sidepanel-pane"
          }
        >
          {selectedSymbol ? (
            <OnionView
              symbolId={selectedSymbol.id}
              onNodeSelect={onNodeSelect}
            />
          ) : (
            <p className="sidepanel-empty">选中符号后显示调用链</p>
          )}
        </div>
      </div>
    </aside>
  );
}
