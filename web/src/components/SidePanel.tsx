/**
 * 右侧面板（阶段 5-6）。
 *
 * 三标签页：调用图 / 剥洋葱 / 对话。
 * 标签页切换保持挂载（CSS 隐藏，不用 display:none），避免 react-flow 容器测量为 0
 * 和 useCallChain 每次切回全量重跑。
 * 面板可折叠：收起后只留右侧窄条和展开按钮（不能把整栏 visibility:hidden）。
 *
 * Stage 6 S-1：对话标签页的 chat 状态由 App 层管理（切换符号 = 开新对话）。
 * Stage 6：对话标签激活时 aside 加 aside-chat class（自身加宽到 400px）。
 */
import { type JSX, useState } from "react";
import { CallGraph } from "@/components/CallGraph";
import { OnionView } from "@/components/OnionView";
import { ChatPanel } from "@/components/ChatPanel";
import { useCallers } from "@/hooks/useCallers";
import { useCallees } from "@/hooks/useCallees";
import { Spinner } from "@/components/Spinner";
import type { ChatMessage, SymbolOut } from "@/api/types";

type Tab = "callgraph" | "onion" | "chat";

function paneProps(active: boolean) {
  return {
    className: active ? "sidepanel-pane active" : "sidepanel-pane",
    "aria-hidden": !active,
    ...(!active ? { inert: true } : {}),
  };
}

interface SidePanelProps {
  selectedSymbol: SymbolOut | null;
  onNodeSelect: (sym: SymbolOut) => void;
  // Stage 6：对话状态由 App 层传入（S-1：切换符号 = 开新对话）
  chat: {
    messages: ChatMessage[];
    isStreaming: boolean;
    error: string | null;
    draft: string;
    llmConfigured: boolean;
    configMessage?: string | null;
    configLoading?: boolean;
    onDraftChange: (text: string) => void;
    onSend: () => void;
    onRetry: () => void;
    onClear: () => void;
    onAbort: () => void;
  };
}

export function SidePanel({
  selectedSymbol,
  onNodeSelect,
  chat,
}: SidePanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("callgraph");
  const [collapsed, setCollapsed] = useState(false);

  const callers = useCallers(selectedSymbol?.id ?? null);
  const callees = useCallees(selectedSymbol?.id ?? null);

  // R-2：切换标签时 abort 流式对话（离开 chat 标签时）
  const handleTabChange = (tab: Tab) => {
    if (activeTab === "chat" && tab !== "chat") {
      chat.onAbort();
    }
    setActiveTab(tab);
  };

  // Stage 6：对话标签激活时加宽
  const asideClass = [
    "app-aside",
    collapsed ? "aside-collapsed" : "",
    activeTab === "chat" ? "aside-chat" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={asideClass}>
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
            onClick={() => handleTabChange("callgraph")}
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
            onClick={() => handleTabChange("onion")}
          >
            剥洋葱
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "chat"}
            className={
              activeTab === "chat" ? "sidepanel-tab active" : "sidepanel-tab"
            }
            onClick={() => handleTabChange("chat")}
          >
            对话
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
        {/* 三个面板保持挂载；非当前页 inert + CSS 隐藏，避免调用图穿透叠在剥洋葱上 */}
        <div {...paneProps(activeTab === "callgraph")}>
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
        <div {...paneProps(activeTab === "onion")}>
          {selectedSymbol ? (
            <OnionView
              symbolId={selectedSymbol.id}
              onNodeSelect={onNodeSelect}
            />
          ) : (
            <p className="sidepanel-empty">选中符号后显示调用链</p>
          )}
        </div>
        <div {...paneProps(activeTab === "chat")}>
          <ChatPanel
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            error={chat.error}
            draft={chat.draft}
            symbolName={selectedSymbol?.name ?? null}
            llmConfigured={chat.llmConfigured}
            configMessage={chat.configMessage}
            configLoading={chat.configLoading}
            onDraftChange={chat.onDraftChange}
            onSend={chat.onSend}
            onRetry={chat.onRetry}
            onClear={chat.onClear}
            onAbort={chat.onAbort}
          />
        </div>
      </div>
    </aside>
  );
}
