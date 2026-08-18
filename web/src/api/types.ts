/**
 * API 响应类型（手写，对齐 engine/src/code_archmage/server/models.py）。
 *
 * 字段与 Pydantic 的一致性靠 E2E + openapi 断言验证（B-5），
 * 此处只做编译期契约。
 */

export interface SymbolOut {
  id: number;
  name: string;
  kind: string;
  file_path: string;
  line: number;
  col: number;
  end_line: number;
  signature: string;
  bases: string[];
  decorators: string[];
}

/** 调用点（S-1：让前端能取到调用位置 + resolver 填的 callee_id）。 */
export interface CallOut {
  callee_name: string;
  /** resolver 解析到的定义符号 id；未解析（多候选/属性调用）为 null。 */
  callee_id: number | null;
  line: number;
  col: number;
}

export interface ReferenceOut {
  file_path: string;
  line: number;
  col: number;
  kind: string;
}

export interface SearchHitOut {
  symbol_id: number;
  name: string;
  kind: string;
  file_path: string;
  line: number;
  snippet: string;
}

export interface FileContentOut {
  path: string;
  content: string;
  language: string;
  symbols: SymbolOut[];
  /** 当前文件的调用点（S-1）。 */
  calls: CallOut[];
}

export interface FileTreeOut {
  paths: string[];
}

export interface IndexResultOut {
  files_total: number;
  symbols_total: number;
  calls_total: number;
  duration_ms: number;
  /** Stage 7a A-5：本次重新解析写入的文件数（新文件 + hash 变化）。 */
  files_updated: number;
  /** Stage 7a A-5：hash 未变跳过的文件数。 */
  files_skipped: number;
}

export interface IndexStatusOut {
  file_count: number;
  symbol_count: number;
  schema_version: string;
  repo_root: string;
  db_path: string;
}

// ---------------------------------------------------------------------------
// Stage 6：LLM 对话 + 摘要类型
// ---------------------------------------------------------------------------

export type LLMConfigStatus = "ok" | "not_found" | "incomplete" | "placeholder";

export interface LLMConfigOut {
  configured: boolean;
  status: LLMConfigStatus;
  message: string;
  model?: string;
  env_path?: string | null;
  missing_fields?: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SummaryResponse {
  symbol_id: number;
  summary_text: string;
  model: string;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Stage 7b：导读（Guides）类型
// ---------------------------------------------------------------------------

export type GuideScope = "project" | "module" | "file";
export type GuideStatus = "none" | "cached" | "stale";

export interface GuideEntryOut {
  scope: GuideScope;
  /** 项目导读为 ""。 */
  path: string;
  status: GuideStatus;
}

export interface GuideTreeOut {
  project: GuideEntryOut;
  modules: GuideEntryOut[];
  files: GuideEntryOut[];
}

export interface GuideBlockOut {
  type: "text" | "code";
  text?: string | null;
  file_path?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  note?: string | null;
}

export interface GuideOut {
  scope: GuideScope;
  path: string;
  content_md: string;
  blocks: GuideBlockOut[];
  stale: boolean;
  model: string;
}
