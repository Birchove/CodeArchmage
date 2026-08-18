"""导读 API 路由（Stage 7b）。

端点：
  GET  /api/guides/tree      → 导读目录 + 状态（确定性，不碰 LLM）
  GET  /api/guides           → 读缓存（解析为块 + stale 判断）；未生成 → 404
  POST /api/guides/generate  → SSE 流式生成并落库

连接策略遵循 ADR-002：每请求在工作线程内开/关连接。
"""

from __future__ import annotations

import asyncio
import re
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from code_archmage.llm import guides as guide_pipeline
from code_archmage.llm.config import LLMConfig
from code_archmage.llm.guide_blocks import CodeBlock, parse_guide_markdown
from code_archmage.llm.guide_store import get_guide, list_guides
from code_archmage.server.models import (
    GuideBlockOut,
    GuideEntryOut,
    GuideGenerateRequest,
    GuideOut,
    GuideTreeOut,
)

guide_router = APIRouter()

_T = TypeVar("_T")

# 从导读 markdown 里预扫描 code 引用块提到的文件（只为这些文件计算行数）
_FILE_REF_RE = re.compile(r"```code\s+file=(\S+)")


def _run_in_thread(func: Callable[..., _T], *args: Any) -> Any:
    """在工作线程内跑同步函数（连接由 func 自行管理）。"""
    return asyncio.to_thread(func, *args)


def _conn_work(db_path: Path, func: Callable[[sqlite3.Connection], _T]) -> _T:
    """开连接 → 执行 → 关闭（工作线程内）。"""

    def _work() -> _T:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            return func(conn)
        finally:
            conn.close()

    return _work()


# ---------------------------------------------------------------------------
# GET /api/guides/tree
# ---------------------------------------------------------------------------


def _query_tree(conn: sqlite3.Connection, repo_root: Path) -> dict[str, Any]:
    """导读目录：条目来自索引，状态来自缓存比对。"""
    files = [r[0] for r in conn.execute("SELECT path FROM files ORDER BY path").fetchall()]
    modules = sorted({p.split("/")[0] for p in files if "/" in p})

    stored = {(g.scope, g.path): g for g in list_guides(conn)}

    def entry(scope: str, path: str) -> GuideEntryOut:
        g = stored.get((scope, path))
        if g is None:
            status = "none"
        elif guide_pipeline.is_stale(conn, repo_root, g):
            status = "stale"
        else:
            status = "cached"
        return GuideEntryOut(scope=scope, path=path, status=status)

    return GuideTreeOut(
        project=entry("project", ""),
        modules=[entry("module", m) for m in modules],
        files=[entry("file", f) for f in files],
    ).model_dump()


@guide_router.get("/api/guides/tree", response_model=GuideTreeOut)
async def guide_tree(request: Request) -> Any:
    """导读目录（确定性：来自索引 + 缓存状态，不花 token）。"""
    db_path: Path = request.app.state.db_path
    repo_root: Path = request.app.state.repo_root
    return await _run_in_thread(_conn_work, db_path, lambda conn: _query_tree(conn, repo_root))


# ---------------------------------------------------------------------------
# GET /api/guides
# ---------------------------------------------------------------------------


def _file_line_count(repo_root: Path, file_path: str) -> int:
    """文件行数（errors=replace，读失败按 0）。"""
    try:
        return len(
            (repo_root / file_path).read_text(encoding="utf-8", errors="replace").splitlines()
        )
    except OSError:
        return 0


def _query_guide(
    conn: sqlite3.Connection, repo_root: Path, scope: str, path: str
) -> dict[str, Any] | None:
    """读导读 + 解析块 + stale 判断。未生成 → None。"""
    guide = get_guide(conn, scope, path)
    if guide is None:
        return None

    # 只为 markdown 里实际引用的文件计算行数（控成本）
    valid_files = frozenset(r[0] for r in conn.execute("SELECT path FROM files").fetchall())
    referenced = set(_FILE_REF_RE.findall(guide.content_md))
    file_lengths = {f: _file_line_count(repo_root, f) for f in referenced if f in valid_files}

    blocks_out: list[dict[str, Any]] = []
    for block in parse_guide_markdown(guide.content_md, valid_files, file_lengths):
        if isinstance(block, CodeBlock):
            blocks_out.append(
                GuideBlockOut(
                    type="code",
                    file_path=block.file_path,
                    start_line=block.start_line,
                    end_line=block.end_line,
                    note=block.note,
                ).model_dump()
            )
        else:
            blocks_out.append(GuideBlockOut(type="text", text=block.text).model_dump())

    return GuideOut(
        scope=guide.scope,
        path=guide.path,
        content_md=guide.content_md,
        blocks=[GuideBlockOut(**b) for b in blocks_out],
        stale=guide_pipeline.is_stale(conn, repo_root, guide),
        model=guide.model,
    ).model_dump()


@guide_router.get("/api/guides", response_model=GuideOut)
async def read_guide(
    request: Request,
    scope: str = Query(...),
    path: str = Query(""),
) -> Any:
    """读一篇导读缓存。未生成 → 404。"""
    if scope not in guide_pipeline.SCOPES:
        raise HTTPException(400, f"无效的导读级别：{scope}")
    db_path: Path = request.app.state.db_path
    repo_root: Path = request.app.state.repo_root
    result = await _run_in_thread(
        _conn_work, db_path, lambda conn: _query_guide(conn, repo_root, scope, path)
    )
    if result is None:
        raise HTTPException(404, f"导读未生成：scope={scope}, path={path}")
    return result


# ---------------------------------------------------------------------------
# POST /api/guides/generate
# ---------------------------------------------------------------------------


def _target_exists(conn: sqlite3.Connection, scope: str, path: str) -> bool:
    """导读目标是否在索引里。project 总是存在（仓库本身）。"""
    if scope == "project":
        return True
    if scope == "file":
        return conn.execute("SELECT 1 FROM files WHERE path = ?", (path,)).fetchone() is not None
    # module：该前缀下至少有一个文件
    prefix = path.rstrip("/") + "/"
    return (
        conn.execute(
            "SELECT 1 FROM files WHERE path LIKE ? ESCAPE '\\' LIMIT 1",
            (prefix.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%",),
        ).fetchone()
        is not None
    )


@guide_router.post("/api/guides/generate")
async def generate_guide(request: Request, body: GuideGenerateRequest) -> StreamingResponse:
    """SSE 流式生成一篇导读并落库。未配置 LLM → 503。

    Starlette StreamingResponse 支持同步生成器（自动在线程池运行）。
    """
    if body.scope not in guide_pipeline.SCOPES:
        raise HTTPException(400, f"无效的导读级别：{body.scope}")

    cfg: LLMConfig | None = request.app.state.llm_config
    if cfg is None:
        from code_archmage.server.llm_routes import _llm_unavailable

        raise _llm_unavailable(request)

    db_path: Path = request.app.state.db_path
    repo_root: Path = request.app.state.repo_root

    # 前置校验（在 SSE 之前给出干净的 HTTP 错误码）
    def _precheck(conn: sqlite3.Connection) -> tuple[bool, str]:
        if not _target_exists(conn, body.scope, body.path):
            return False, "404"
        context = guide_pipeline._build_context(conn, repo_root, body.scope, body.path)
        if not context.strip():
            return False, "400"
        return True, "ok"

    ok, reason = await _run_in_thread(_conn_work, db_path, _precheck)
    if not ok:
        if reason == "404":
            raise HTTPException(404, f"导读目标不在索引里：scope={body.scope}, path={body.path}")
        raise HTTPException(400, "索引为空，没有内容可以生成导读")

    return StreamingResponse(
        guide_pipeline.generate_guide_stream(db_path, repo_root, cfg, body.scope, body.path),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
