/**
 * 各 API 端点的 typed 调用函数（对齐 routes.py 的 7 个阶段 4 消费端点）。
 */

import { apiGet, apiPost } from "./client";
import type {
  FileContentOut,
  FileTreeOut,
  IndexResultOut,
  IndexStatusOut,
  SearchHitOut,
  SymbolOut,
} from "./types";

export const getHealth = (): Promise<{ status: string }> => apiGet("/health");

export const getIndexStatus = (): Promise<IndexStatusOut> =>
  apiGet("/index/status");

export const triggerIndex = (): Promise<IndexResultOut> => apiPost("/index");

export const getFileTree = (): Promise<FileTreeOut> => apiGet("/files/tree");

/** 注意：file_path 直接拼到路径（后端用 {file_path:path} 捕获剩余段）。 */
export const getFileContent = (filePath: string): Promise<FileContentOut> =>
  apiGet<FileContentOut>(`/files/${filePath}`);

export const getSymbolById = (id: number): Promise<SymbolOut> =>
  apiGet<SymbolOut>(`/symbols/${id}`);

export const getSymbolsByName = (name: string): Promise<SymbolOut[]> =>
  apiGet<SymbolOut[]>(`/symbols?name=${encodeURIComponent(name)}`);

/** FTS5 全文搜索（整词匹配）。limit 显式传 20（后端默认 200，cc B-1）。 */
export const searchSymbols = (
  query: string,
  limit = 20,
): Promise<SearchHitOut[]> =>
  apiGet<SearchHitOut[]>(
    `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );

/** 查询符号的直接调用者（按名匹配，cc S-2）。 */
export const getCallers = (symbolId: number): Promise<SymbolOut[]> =>
  apiGet<SymbolOut[]>(`/symbols/${symbolId}/callers`);

/** 查询符号的直接被调用者（含多候选，cc S-2）。 */
export const getCallees = (symbolId: number): Promise<SymbolOut[]> =>
  apiGet<SymbolOut[]>(`/symbols/${symbolId}/callees`);
