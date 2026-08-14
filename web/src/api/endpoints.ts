/**
 * 各 API 端点的 typed 调用函数（对齐 routes.py 的 7 个阶段 4 消费端点）。
 */

import { apiGet, apiPost } from "./client";
import type {
  FileContentOut,
  FileTreeOut,
  IndexResultOut,
  IndexStatusOut,
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
