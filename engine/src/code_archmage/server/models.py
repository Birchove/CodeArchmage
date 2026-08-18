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
    """索引触发结果。

    Stage 7a A-5：files_updated / files_skipped 让前端展示增量统计
    （"更新 X / 跳过 Y"），避免用户误以为每次都全量重建。
    """

    files_total: int
    symbols_total: int
    calls_total: int
    duration_ms: int
    files_updated: int
    files_skipped: int


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


# ---------------------------------------------------------------------------
# Stage 7b：导读（Guides）相关模型
# ---------------------------------------------------------------------------


class GuideEntryOut(BaseModel):
    """导读目录中的一个条目及其状态。"""

    scope: str  # "project" | "module" | "file"
    path: str  # 项目导读为 ""
    status: str  # "none" | "cached" | "stale"


class GuideTreeOut(BaseModel):
    """导读目录（确定性：来自索引，不花 token）。"""

    project: GuideEntryOut
    modules: list[GuideEntryOut]
    files: list[GuideEntryOut]


class GuideBlockOut(BaseModel):
    """导读块。type=text 时用 text；type=code 时用 file_path/start_line/end_line。"""

    type: str  # "text" | "code"
    text: str | None = None
    file_path: str | None = None
    start_line: int | None = None
    end_line: int | None = None
    note: str | None = None


class GuideOut(BaseModel):
    """一篇导读（解析为块后的形态 + stale 标记）。"""

    scope: str
    path: str
    content_md: str
    blocks: list[GuideBlockOut]
    stale: bool
    model: str


class GuideGenerateRequest(BaseModel):
    """导读生成请求。"""

    scope: str  # "project" | "module" | "file"
    path: str  # 项目导读为 ""
