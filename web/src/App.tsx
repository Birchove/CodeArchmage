/**
 * Code Archmage — 三区布局组装（阶段 4-5）。
 *
 * 左侧（文件树 + 符号大纲）+ 中间（只读代码视图）+ 右侧（调用图/剥洋葱）+ 顶部状态栏。
 * 后端不可用 → ErrorState；未索引 → EmptyState。
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileTree } from "@/components/FileTree";
import { CodeView, type CodeViewHandle } from "@/components/CodeView";
import { SymbolOutline } from "@/components/SymbolOutline";
import { Header } from "@/components/Header";
import { SidePanel } from "@/components/SidePanel";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { useFileTree } from "@/hooks/useFileTree";
import { useFileContent } from "@/hooks/useFileContent";
import { useIndexStatus } from "@/hooks/useIndexStatus";
import { useTriggerIndex } from "@/hooks/useTriggerIndex";
import { useHealth } from "@/hooks/useHealth";
import { useJumpToDefinition } from "@/hooks/useJumpToDefinition";
import { buildTree } from "@/lib/tree";
import { ApiError } from "@/api/client";
import { getSymbolById } from "@/api/endpoints";
import type { SymbolOut, SearchHitOut } from "@/api/types";

export function App(): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}

function AppInner(): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolOut | null>(null);
  const codeViewRef = useRef<CodeViewHandle>(null);
  // 跳定义后等待文件加载再滚动到目标行
  const pendingScrollRef = useRef<number | null>(null);

  const health = useHealth();
  const indexStatus = useIndexStatus();
  const fileTree = useFileTree();
  const fileContent = useFileContent(selectedFile);
  const triggerIndex = useTriggerIndex();

  // 统一选中符号回调（阶段 5 §2.5）：设置 selectedSymbol + 打开文件/滚动
  const selectSymbol = useCallback(
    (sym: SymbolOut) => {
      setSelectedSymbol(sym);
      if (sym.file_path !== selectedFile) {
        setSelectedFile(sym.file_path);
        pendingScrollRef.current = sym.line;
      } else {
        codeViewRef.current?.scrollToLine(sym.line);
      }
    },
    [selectedFile],
  );

  // 搜索结果选中 → getSymbolById 获取完整符号 → selectSymbol
  const handleSearchSelect = useCallback(
    async (hit: SearchHitOut): Promise<void> => {
      try {
        const sym = await getSymbolById(hit.symbol_id);
        selectSymbol(sym);
      } catch {
        // 符号不存在（跨索引 id 失效）→ 静默忽略
      }
    },
    [selectSymbol],
  );

  // cc S-3：reindex 后符号 id 不稳定（rowid 重排），清空 selectedSymbol
  useEffect(() => {
    if (triggerIndex.isSuccess) {
      setSelectedSymbol(null);
    }
  }, [triggerIndex.isSuccess]);

  // 跳定义 hook（B-2：从内联逻辑提取，使可测试）
  const { jumpFromPosition } = useJumpToDefinition(selectedFile, {
    onOpenFile: (filePath, line) => {
      setSelectedFile(filePath);
      pendingScrollRef.current = line;
    },
    onSameFileScroll: (line) => codeViewRef.current?.scrollToLine(line),
  });

  // 文件加载完成后执行待处理的滚动（跳定义）
  useEffect(() => {
    if (fileContent.data && pendingScrollRef.current !== null) {
      codeViewRef.current?.scrollToLine(pendingScrollRef.current);
      pendingScrollRef.current = null;
    }
  }, [fileContent.data]);

  // 后端不可用（O-2）
  if (health.isError) {
    return (
      <div className="app app-error">
        <ErrorState />
      </div>
    );
  }

  const fileCount = indexStatus.data?.file_count ?? 0;
  const isIndexed = fileCount > 0;
  const hasFiles = (fileTree.data?.paths?.length ?? 0) > 0;

  return (
    <div className="app">
      <Header
        repoRoot={indexStatus.data?.repo_root ?? ""}
        indexStatus={isIndexed ? "indexed" : "idle"}
        fileCount={fileCount}
        isIndexing={triggerIndex.isPending}
        indexError={
          triggerIndex.error instanceof ApiError &&
          triggerIndex.error.status === 409
            ? "索引正在进行中"
            : null
        }
        onTriggerIndex={() => triggerIndex.mutate()}
        isSearchEnabled={isIndexed}
        onSearchSelect={handleSearchSelect}
      />
      <div className="app-body">
        <aside className="app-sidebar">
          <section className="sidebar-section file-tree-section">
            <h2 className="sidebar-title">文件</h2>
            <FileTree
              nodes={buildTree(fileTree.data?.paths ?? [])}
              onSelect={setSelectedFile}
            />
          </section>
          <section className="sidebar-section outline-section">
            <h2 className="sidebar-title">符号</h2>
            <SymbolOutline
              symbols={fileContent.data?.symbols ?? []}
              onSelect={selectSymbol}
            />
          </section>
        </aside>
        <main className="app-main">
          {triggerIndex.isPending ? (
            <div className="app-loading">
              <Spinner />
              <p>正在索引…</p>
            </div>
          ) : !hasFiles && !isIndexed ? (
            <EmptyState onTriggerIndex={() => triggerIndex.mutate()} />
          ) : fileContent.isLoading ? (
            <div className="app-loading">
              <Spinner />
              <p>加载文件…</p>
            </div>
          ) : selectedFile && fileContent.data ? (
            <CodeView
              ref={codeViewRef}
              content={fileContent.data.content}
              onSymbolClick={(line, col) =>
                jumpFromPosition(fileContent.data.calls, line, col)
              }
            />
          ) : (
            <p className="app-placeholder">选择一个文件开始阅读</p>
          )}
        </main>
        <SidePanel
          selectedSymbol={selectedSymbol}
          onNodeSelect={selectSymbol}
        />
      </div>
    </div>
  );
}
