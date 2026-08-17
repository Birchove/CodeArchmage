"""Pydantic 响应模型（API 契约）。

前后端共享的 JSON schema。FastAPI 据此自动生成 OpenAPI 文档。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SymbolOut(BaseModel):
    """符号（函数 / 类 / 方法等）。"""

    id: int
    name: str
    kind: str
    file_path: str
    line: int
    col: int
    end_line: int
    signature: str
    bases: list[str]
    decorators: list[str]


class CallOut(BaseModel):
    """调用点（S-1：让前端能取到调用位置 + resolver 填的 callee_id）。"""

    callee_name: str
    callee_id: int | None
    line: int
    col: int


class ReferenceOut(BaseModel):
    """引用位置（调用点 / 导入点等）。"""

    file_path: str
    line: int
    col: int
    kind: str


class SearchHitOut(BaseModel):
    """全文搜索命中。"""

    symbol_id: int
    name: str
    kind: str
    file_path: str
    line: int
    snippet: str


class FileContentOut(BaseModel):
    """文件内容 + 符号大纲 + 调用点。"""

    path: str
    content: str
    language: str
    symbols: list[SymbolOut]
    calls: list[CallOut]


class FileTreeOut(BaseModel):
    """已索引文件路径列表（扁平）。"""

    paths: list[str]


class IndexResultOut(BaseModel):
    """索引触发结果。"""

    files_total: int
    symbols_total: int
    calls_total: int
    duration_ms: int


class IndexStatusOut(BaseModel):
    """索引库状态。"""

    file_count: int
    symbol_count: int
    schema_version: str
    repo_root: str
    db_path: str


# ---------------------------------------------------------------------------
# Stage 6：LLM 对话 + 摘要相关模型
# ---------------------------------------------------------------------------


class LLMConfigOut(BaseModel):
    """LLM 配置状态（绝不含 api_key）。"""

    configured: bool
    status: str
    message: str
    model: str | None = None
    env_path: str | None = None
    missing_fields: list[str] = Field(default_factory=list)


class ChatMessage(BaseModel):
    """对话历史消息。"""

    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    """对话请求。"""

    message: str
    symbol_id: int | None = None
    history: list[ChatMessage] = []


class SummaryResponse(BaseModel):
    """摘要响应。"""

    symbol_id: int
    summary_text: str
    model: str
    cached: bool


class SummaryRequest(BaseModel):
    """摘要生成请求。"""

    symbol_id: int
