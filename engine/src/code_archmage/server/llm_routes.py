"""LLM 相关 API 路由（Stage 6）。

端点：
  GET  /api/llm/config            → LLM 配置状态（不含 key）
  POST /api/chat                  → 流式 SSE 对话
  GET  /api/summaries/{symbol_id} → 摘要缓存读取
  POST /api/summaries             → 惰性摘要生成
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Generator
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from code_archmage.llm.config import ConfigLoadResult, LLMConfig, result_from_injected_config
from code_archmage.llm.context import build_context
from code_archmage.llm.gateway import GatewayError, chat_stream
from code_archmage.llm.prompts.chat_system import build_chat_system_prompt
from code_archmage.llm.summaries import SummaryResult, get_or_create
from code_archmage.server.models import (
    ChatRequest,
    LLMConfigOut,
    SummaryRequest,
    SummaryResponse,
)

llm_router = APIRouter()


def _llm_status(request: Request) -> ConfigLoadResult:
    status = getattr(request.app.state, "llm_status", None)
    if isinstance(status, ConfigLoadResult):
        return status
    return result_from_injected_config(getattr(request.app.state, "llm_config", None))


def _llm_unavailable(request: Request) -> HTTPException:
    return HTTPException(503, _llm_status(request).message)


# ---------------------------------------------------------------------------
# GET /api/llm/config
# ---------------------------------------------------------------------------


@llm_router.get("/api/llm/config", response_model=LLMConfigOut)
async def llm_config(request: Request) -> LLMConfigOut:
    """返回 LLM 配置状态。绝不含 api_key。"""
    status = _llm_status(request)
    cfg = status.config
    return LLMConfigOut(
        configured=cfg is not None,
        status=str(status.status),
        message=status.message,
        model=cfg.model if cfg is not None else None,
        env_path=str(status.env_path) if status.env_path is not None else None,
        missing_fields=list(status.missing_fields),
    )


# ---------------------------------------------------------------------------
# POST /api/chat → SSE
# ---------------------------------------------------------------------------


def _sse_line(data: object) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_messages(
    conn: sqlite3.Connection,
    request_body: ChatRequest,
    repo_root: Path,
    config: LLMConfig,
) -> list[dict[str, str]]:
    """组装 messages 数组（system prompt + history + 本次消息）。"""
    messages: list[dict[str, str]] = []

    # system prompt（含符号上下文）
    if request_body.symbol_id is not None:
        context = build_context(conn, request_body.symbol_id, repo_root=repo_root)
    else:
        context = ""
    system_prompt = build_chat_system_prompt(context)
    messages.append({"role": "system", "content": system_prompt})

    # 历史
    for msg in request_body.history:
        messages.append({"role": msg.role, "content": msg.content})

    # 本次
    messages.append({"role": "user", "content": request_body.message})
    return messages


def _stream_chat(
    db_path: Path,
    repo_root: Path,
    config: LLMConfig,
    body: ChatRequest,
) -> Generator[str, None, None]:
    """同步生成器：在工作线程内运行，yield SSE 行。"""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        msgs = _build_messages(conn, body, repo_root, config)
    finally:
        conn.close()

    try:
        for delta in chat_stream(msgs, config):
            yield _sse_line({"delta": delta})
    except GatewayError as e:
        yield _sse_line({"error": str(e)})

    yield "data: [DONE]\n\n"


@llm_router.post("/api/chat")
async def chat_endpoint(request: Request, body: ChatRequest) -> StreamingResponse:
    """流式 SSE 对话。未配置 LLM → 503。

    Starlette StreamingResponse 支持同步生成器（自动在线程池运行）。
    """
    cfg: LLMConfig | None = request.app.state.llm_config
    if cfg is None:
        raise _llm_unavailable(request)

    db_path: Path = request.app.state.db_path
    repo_root: Path = request.app.state.repo_root

    return StreamingResponse(
        _stream_chat(db_path, repo_root, cfg, body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# GET /api/summaries/{symbol_id}
# ---------------------------------------------------------------------------


def _query_summary(conn: sqlite3.Connection, symbol_id: int) -> SummaryResult | None:
    row = conn.execute(
        "SELECT summary_text, model FROM summaries WHERE symbol_id = ?",
        (symbol_id,),
    ).fetchone()
    if row is None:
        return None
    return SummaryResult(
        symbol_id=symbol_id,
        summary_text=row[0],
        model=row[1],
        cached=True,
    )


async def _run_in_thread(db_path: Path, func: object, *args: object) -> object:
    def _work() -> object:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            return func(conn, *args)  # type: ignore[operator]
        finally:
            conn.close()

    return await asyncio.to_thread(_work)


@llm_router.get("/api/summaries/{symbol_id}", response_model=SummaryResponse)
async def get_summary(symbol_id: int, request: Request) -> SummaryResponse:
    """摘要缓存读取。未配置 LLM → 503。无缓存 → 404。"""
    cfg: LLMConfig | None = request.app.state.llm_config
    if cfg is None:
        raise _llm_unavailable(request)

    result = await _run_in_thread(request.app.state.db_path, _query_summary, symbol_id)
    if result is None:
        raise HTTPException(404, "摘要未生成，请 POST /api/summaries 触发生成")

    r: SummaryResult = result  # type: ignore[assignment]
    return SummaryResponse(
        symbol_id=r.symbol_id,
        summary_text=r.summary_text,
        model=r.model,
        cached=r.cached,
    )


# ---------------------------------------------------------------------------
# POST /api/summaries
# ---------------------------------------------------------------------------


def _create_summary(
    conn: sqlite3.Connection,
    symbol_id: int,
    config: LLMConfig,
    repo_root: Path,
) -> SummaryResult:
    return get_or_create(conn, symbol_id, config, repo_root=repo_root)


@llm_router.post("/api/summaries", response_model=SummaryResponse)
async def create_summary(request: Request, body: SummaryRequest) -> SummaryResponse:
    """惰性摘要生成。未配置 LLM → 503。"""
    cfg: LLMConfig | None = request.app.state.llm_config
    if cfg is None:
        raise _llm_unavailable(request)

    repo_root: Path = request.app.state.repo_root
    result = await _run_in_thread(
        request.app.state.db_path, _create_summary, body.symbol_id, cfg, repo_root
    )
    r: SummaryResult = result  # type: ignore[assignment]
    return SummaryResponse(
        symbol_id=r.symbol_id,
        summary_text=r.summary_text,
        model=r.model,
        cached=r.cached,
    )
