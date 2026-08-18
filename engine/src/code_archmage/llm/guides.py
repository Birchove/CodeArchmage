"""导读生成管线（Stage 7b）。

三级导读（项目/模块/文件）：确定性上下文组装 → LLM 流式生成 → 落库。
input_hash（上下文哈希）随内容落库，重新索引后据此判断 stale。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Generator
from pathlib import Path

from code_archmage.llm.config import LLMConfig
from code_archmage.llm.gateway import GatewayError, chat_stream
from code_archmage.llm.guide_context import (
    build_file_guide_context,
    build_module_guide_context,
    build_project_guide_context,
)
from code_archmage.llm.guide_store import StoredGuide, upsert_guide
from code_archmage.llm.prompts.guide import (
    build_file_guide_prompt,
    build_module_guide_prompt,
    build_project_guide_prompt,
)

SCOPES = ("project", "module", "file")


def _sse_line(data: object) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_context(conn: sqlite3.Connection, repo_root: Path, scope: str, path: str) -> str:
    """按级别组装确定性上下文（不调 LLM）。"""
    if scope == "project":
        return build_project_guide_context(conn, repo_root)
    if scope == "module":
        return build_module_guide_context(conn, repo_root, path)
    if scope == "file":
        return build_file_guide_context(conn, repo_root, path)
    return ""


def _build_prompt(scope: str, context: str) -> str:
    """按级别选择 prompt 模板。"""
    if scope == "project":
        return build_project_guide_prompt(context)
    if scope == "module":
        return build_module_guide_prompt(context)
    return build_file_guide_prompt(context)


def _context_hash(context: str) -> str:
    """上下文内容哈希（stale 判断依据）。"""
    return hashlib.sha256(context.encode("utf-8")).hexdigest()


def is_stale(conn: sqlite3.Connection, repo_root: Path, guide: StoredGuide) -> bool:
    """导读是否过期：当前上下文哈希与生成时的 input_hash 不一致。"""
    ctx = _build_context(conn, repo_root, guide.scope, guide.path)
    return _context_hash(ctx) != guide.input_hash


def generate_guide_stream(
    db_path: Path,
    repo_root: Path,
    config: LLMConfig,
    scope: str,
    path: str,
) -> Generator[str, None, None]:
    """流式生成一篇导读：yield SSE 行；成功后落库。

    与 chat 的 SSE 协议一致：data 行 + [DONE]；网关错误以行内 error 返回。
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        context = _build_context(conn, repo_root, scope, path)
        input_hash = _context_hash(context)
        messages = [{"role": "user", "content": _build_prompt(scope, context)}]
    finally:
        conn.close()

    chunks: list[str] = []
    failed = False
    try:
        for delta in chat_stream(messages, config):
            chunks.append(delta)
            yield _sse_line({"content": delta})
    except GatewayError as e:
        failed = True
        yield _sse_line({"error": str(e)})

    # 先落库再发 [DONE]：保证客户端看到 [DONE] 时导读已持久化，
    # 避免「看到完成→立刻跳走→服务端还没落库」的竞态丢数据。
    if not failed and chunks:
        content_md = "".join(chunks)
        conn = sqlite3.connect(str(db_path))
        try:
            upsert_guide(conn, scope, path, content_md, config.model, input_hash)
        finally:
            conn.close()

    yield "data: [DONE]\n\n"
