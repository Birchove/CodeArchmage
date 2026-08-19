/**
 * 导读整页视图（Stage 7b；Stage 8 增加导读闭环）。
 *
 * 三区：左目录（项目/模块/文件 + 生成状态）+ 右正文（notebook 式块流）。
 * - 未生成 → 「生成导读」按钮（惰性生成，成本可控）
 * - 生成中 → SSE 流式逐块渲染
 * - stale → 提示「源码已变化」+ 重新生成
 * - code 块点击 → onJumpToSource 跳回阅读模式定位
 * - Stage 8：「生成本库导读」批量生成（串行 + 进度 + 中止 + 跳过 cached）
 * - Stage 8：autoGenerate（阅读模式「生成并查看导读」入口的一次性信号）
 */
import { useCallback, useMemo, useState, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAutoGenerate, useGuide, useGuideTree } from "@/hooks/useGuide";
import {
  useBatchGenerate,
  type BatchTarget,
} from "@/hooks/useBatchGenerate";
import { useLLMConfig } from "@/hooks/useLLMConfig";
import { parseStreamingBlocks } from "@/lib/guideBlocks";
import { CodeBlockView } from "@/components/CodeBlockView";
import { Spinner } from "@/components/Spinner";
import type { GuideEntryOut, GuideOut, GuideScope } from "@/api/types";

interface GuidePageProps {
  /** 代码块点击 → 跳回阅读模式（文件 + 行号）。 */
  onJumpToSource: (filePath: string, line: number) => void;
  /** 从阅读模式进入时的初始选中项（如「查看导读」聚焦到当前文件）。 */
  initialSelection?: { scope: GuideScope; path: string };
  /** Stage 8：进入后为 initialSelection 自动生成一次（「生成并查看导读」入口）。 */
  autoGenerate?: boolean;
}

interface Selection {
  scope: GuideScope;
  path: string;
}

const STATUS_LABEL: Record<string, string> = {
  none: "未生成",
  cached: "已生成",
  stale: "已过期",
};

export function GuidePage({
  onJumpToSource,
  initialSelection,
  autoGenerate = false,
}: GuidePageProps): JSX.Element {
  const tree = useGuideTree();
  const llmConfig = useLLMConfig();
  const batch = useBatchGenerate();
  const [selection, setSelection] = useState<Selection>(
    initialSelection ?? { scope: "project", path: "" },
  );
  // Stage 8：一次性自动生成信号，消费后作废（防止目录里点走再点回时重触发）
  const [autoGenConsumed, setAutoGenConsumed] = useState(false);
  const handleAutoGenerateStart = useCallback(
    () => setAutoGenConsumed(true),
    [],
  );

  // 批量目标：项目 → 模块 → 文件，跳过 cached（只生成 none 与 stale）
  const batchTargets = useMemo<BatchTarget[]>(() => {
    if (!tree.data) return [];
    const entries = [tree.data.project, ...tree.data.modules, ...tree.data.files];
    return entries
      .filter((e) => e.status !== "cached")
      .map((e) => ({ scope: e.scope, path: e.path }));
  }, [tree.data]);

  const llmConfigured = llmConfig.data?.configured ?? false;
  const autoTarget =
    autoGenerate && !autoGenConsumed ? (initialSelection ?? null) : null;

  return (
    <div className="guide-page">
      <aside className="guide-tree">
        <h2 className="sidebar-title">导读目录</h2>
        <BatchGeneratePanel
          isRunning={batch.isRunning}
          done={batch.done}
          total={batch.total}
          currentLabel={batch.currentLabel}
          batchError={batch.batchError}
          llmConfigured={llmConfigured}
          llmMessage={llmConfig.data?.message ?? null}
          treeReady={tree.data != null}
          pendingCount={batchTargets.length}
          onStart={() => batch.start(batchTargets)}
          onAbort={batch.abort}
        />
        {tree.isLoading ? (
          <Spinner />
        ) : tree.data ? (
          <ul className="guide-tree-list">
            <GuideTreeItem
              entry={tree.data.project}
              label="项目总览"
              active={selection.scope === "project"}
              onSelect={(e) => setSelection({ scope: e.scope, path: e.path })}
            />
            {tree.data.modules.map((m) => (
              <GuideTreeItem
                key={`m:${m.path}`}
                entry={m}
                label={`📁 ${m.path}`}
                active={
                  selection.scope === "module" && selection.path === m.path
                }
                onSelect={(e) => setSelection({ scope: e.scope, path: e.path })}
              />
            ))}
            {tree.data.files.map((f) => (
              <GuideTreeItem
                key={`f:${f.path}`}
                entry={f}
                label={f.path}
                active={selection.scope === "file" && selection.path === f.path}
                onSelect={(e) => setSelection({ scope: e.scope, path: e.path })}
              />
            ))}
          </ul>
        ) : (
          <p className="guide-tree-empty">暂无目录（请先索引）</p>
        )}
      </aside>
      <div className="guide-content">
        <GuideBody
          key={`${selection.scope}:${selection.path}`}
          scope={selection.scope}
          path={selection.path}
          onJumpToSource={onJumpToSource}
          autoGenerate={
            autoTarget !== null &&
            selection.scope === autoTarget.scope &&
            selection.path === autoTarget.path
          }
          onAutoGenerateStart={handleAutoGenerateStart}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 批量生成面板（Stage 8）
// ---------------------------------------------------------------------------

interface BatchGeneratePanelProps {
  isRunning: boolean;
  done: number;
  total: number;
  currentLabel: string | null;
  batchError: string | null;
  llmConfigured: boolean;
  llmMessage: string | null;
  treeReady: boolean;
  /** 待生成（none + stale）个数；0 → 全部已生成。 */
  pendingCount: number;
  onStart: () => void;
  onAbort: () => void;
}

function BatchGeneratePanel({
  isRunning,
  done,
  total,
  currentLabel,
  batchError,
  llmConfigured,
  llmMessage,
  treeReady,
  pendingCount,
  onStart,
  onAbort,
}: BatchGeneratePanelProps): JSX.Element {
  const allDone = treeReady && pendingCount === 0;
  const disabled = !llmConfigured || !treeReady || pendingCount === 0;
  return (
    <div className="guide-batch">
      {isRunning ? (
        <>
          <p className="guide-batch-progress">
            <Spinner /> 正在生成 {done}/{total}
            {currentLabel ? ` · ${currentLabel}` : ""}
          </p>
          <button type="button" className="guide-batch-btn" onClick={onAbort}>
            中止
          </button>
        </>
      ) : (
        <button
          type="button"
          className="guide-batch-btn"
          disabled={disabled}
          title={
            !llmConfigured
              ? (llmMessage ?? "LLM 未配置")
              : "按 项目 → 模块 → 文件 顺序生成所有未生成导读（已生成的跳过）"
          }
          onClick={onStart}
        >
          {allDone ? "导读已全部生成" : "生成本库导读"}
        </button>
      )}
      {batchError && <p className="guide-error">导读生成失败：{batchError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 目录条目
// ---------------------------------------------------------------------------

interface GuideTreeItemProps {
  entry: GuideEntryOut;
  label: string;
  active: boolean;
  onSelect: (entry: GuideEntryOut) => void;
}

function GuideTreeItem({
  entry,
  label,
  active,
  onSelect,
}: GuideTreeItemProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={`guide-tree-item status-${entry.status}${active ? " active" : ""}`}
        onClick={() => onSelect(entry)}
      >
        <span className="guide-tree-label">{label}</span>
        <span className={`guide-status guide-status-${entry.status}`}>
          {STATUS_LABEL[entry.status] ?? entry.status}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 正文：缓存 / 流式 / 未生成三态
// ---------------------------------------------------------------------------

interface GuideBodyProps {
  scope: GuideScope;
  path: string;
  onJumpToSource: (filePath: string, line: number) => void;
  /** Stage 8：挂载后自动生成一次（「生成并查看导读」入口的一次性信号）。 */
  autoGenerate?: boolean;
  /** 自动生成实际触发时回调（GuidePage 用来作废一次性信号）。 */
  onAutoGenerateStart?: () => void;
}

function GuideBody({
  scope,
  path,
  onJumpToSource,
  autoGenerate = false,
  onAutoGenerateStart,
}: GuideBodyProps): JSX.Element {
  const { guide, isLoading, streamMd, isGenerating, generateError, generate } =
    useGuide(scope, path);

  // Stage 8：「生成并查看导读」→ 无缓存/stale 时自动开跑一次（内部防重复触发）
  useAutoGenerate({
    enabled: autoGenerate,
    isLoading,
    guide,
    generate,
    onStart: onAutoGenerateStart,
  });

  // 流式进行中：渲染增量 markdown；结束后失效缓存已由 hook 触发。
  // 仅在 isGenerating 时走流式视图——生成结束仍无缓存（404 / 落库失败）
  // 应回到「生成导读」，不能因 streamMd 残留而永远占住正文。
  if (isGenerating) {
    return (
      <div className="guide-body">
        <StreamingBlocks md={streamMd} onJumpToSource={onJumpToSource} />
        <p className="guide-generating">
          <Spinner /> 正在生成…
        </p>
        {generateError && <p className="guide-error">{generateError}</p>}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="guide-body">
        <Spinner />
      </div>
    );
  }

  if (!guide) {
    const scopeName =
      scope === "project" ? "项目" : scope === "module" ? "模块" : "文件";
    return (
      <div className="guide-body guide-body-empty">
        <p>
          {scopeName}导读尚未生成
          {path ? `（${path}）` : ""}。按需生成，内容缓存在本地。
        </p>
        <button type="button" className="index-btn" onClick={generate}>
          生成导读
        </button>
        {generateError && <p className="guide-error">{generateError}</p>}
      </div>
    );
  }

  return (
    <CachedGuide
      guide={guide}
      onJumpToSource={onJumpToSource}
      onRegenerate={generate}
    />
  );
}

function CachedGuide({
  guide,
  onJumpToSource,
  onRegenerate,
}: {
  guide: GuideOut;
  onJumpToSource: (filePath: string, line: number) => void;
  onRegenerate: () => void;
}): JSX.Element {
  return (
    <div className="guide-body">
      {guide.stale && (
        <div className="guide-stale-banner">
          ⚠ 源码自上次生成后已变化，内容可能过期。
          <button
            type="button"
            className="guide-regenerate-btn"
            onClick={onRegenerate}
          >
            重新生成
          </button>
        </div>
      )}
      {guide.blocks.map((b, i) =>
        b.type === "text" ? (
          <div className="guide-text-block" key={i}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {b.text ?? ""}
            </ReactMarkdown>
          </div>
        ) : (
          <CodeBlockView
            key={i}
            filePath={b.file_path ?? ""}
            startLine={b.start_line ?? 1}
            endLine={b.end_line ?? 1}
            onJump={onJumpToSource}
          />
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 流式块渲染
// ---------------------------------------------------------------------------

function StreamingBlocks({
  md,
  onJumpToSource,
}: {
  md: string;
  onJumpToSource: (filePath: string, line: number) => void;
}): JSX.Element {
  const blocks = useMemo(() => parseStreamingBlocks(md), [md]);
  return (
    <>
      {blocks.map((b, i) =>
        b.type === "text" ? (
          <div className="guide-text-block" key={i}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
          </div>
        ) : b.closed ? (
          <CodeBlockView
            key={i}
            filePath={b.file_path}
            startLine={b.start_line}
            endLine={b.end_line}
            onJump={onJumpToSource}
          />
        ) : (
          <div className="guide-code-block" key={i}>
            <span className="guide-code-loc">
              📍 {b.file_path}:{b.start_line}-{b.end_line}
            </span>
            <p className="guide-code-loading">代码块生成中…</p>
          </div>
        ),
      )}
    </>
  );
}

// 注：selection 变化时 GuideBody 用 key 重挂载，流式状态随之重置
