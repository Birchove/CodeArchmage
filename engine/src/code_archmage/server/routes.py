"""API 路由。

所有 /api 端点集中在此。连接策略遵循 ADR-002：每请求在工作线程内
开/关自己的连接，不在 asyncio 事件循环线程开连接。
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from fastapi import APIRouter, HTTPException, Query, Request

from code_archmage.indexer.queries import find_references
from code_archmage.indexer.resolver import assign_callers, resolve_callees
from code_archmage.indexer.writer import index_directory
from code_archmage.server.models import (
    CallOut,
    FileContentOut,
    FileTreeOut,
    IndexResultOut,
    IndexStatusOut,
    ReferenceOut,
    SearchHitOut,
    SymbolOut,
)
from code_archmage.server.security import PathEscapeError, resolve_path

router = APIRouter()

_T = TypeVar("_T")


async def _run_in_thread(db_path: Path, func: Callable[..., _T], *args: Any) -> _T:
    """在工作线程内开连接 → 执行同步查询 → 关闭连接。

    遵循 ADR-002（每工作单元一个连接）。连接生命周期完全在工作线程内，
    不跨线程传递。OperationalError（locked/busy）统一转 503（B-8）。
    泛型 _T 让 mypy 能推断返回类型，避免 Any 污染路由签名。
    """

    def _work() -> Any:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            return func(conn, *args)
        finally:
            conn.close()

    try:
        return await asyncio.to_thread(_work)
    except sqlite3.OperationalError as e:
        raise HTTPException(503, f"数据库暂时不可用，请重试：{e}") from e


def _do_index(repo_root: Path, db_path: Path) -> IndexResultOut:
    """在工作线程内执行全量索引（同步）。"""
    start = time.monotonic()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        index_directory(conn, repo_root)
        assign_callers(conn)
        resolve_callees(conn)
        files_total = conn.execute("SELECT count(*) FROM files").fetchone()[0]
        symbols_total = conn.execute("SELECT count(*) FROM symbols").fetchone()[0]
        calls_total = conn.execute("SELECT count(*) FROM calls").fetchone()[0]
    finally:
        conn.close()
    duration_ms = int((time.monotonic() - start) * 1000)
    return IndexResultOut(
        files_total=files_total,
        symbols_total=symbols_total,
        calls_total=calls_total,
        duration_ms=duration_ms,
    )


@router.get("/api/health")
async def health() -> dict[str, str]:
    """健康检查。"""
    return {"status": "ok"}


@router.post("/api/index", response_model=IndexResultOut)
async def trigger_index(request: Request) -> IndexResultOut:
    """触发索引（同步 + 互斥，仓库根固定）。

    B-1: 并发互斥——index_lock 防止双击双跑，第二个请求返回 409。
    """
    app = request.app
    if not app.state.index_lock.acquire(blocking=False):
        raise HTTPException(409, "索引正在进行中，请稍后重试")
    try:
        repo_root: Path = app.state.repo_root
        db_path: Path = app.state.db_path
        return await asyncio.to_thread(_do_index, repo_root, db_path)
    finally:
        app.state.index_lock.release()


def _query_status(conn: sqlite3.Connection) -> tuple[int, int, str]:
    """查询索引库统计（在工作线程内调用）。"""
    file_count = conn.execute("SELECT count(*) FROM files").fetchone()[0]
    symbol_count = conn.execute("SELECT count(*) FROM symbols").fetchone()[0]
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    schema_version = row[0] if row else "unknown"
    return file_count, symbol_count, schema_version


@router.get("/api/index/status", response_model=IndexStatusOut)
async def index_status(request: Request) -> IndexStatusOut:
    """索引库状态（文件数、符号数、schema 版本）。"""
    app = request.app
    db_path: Path = app.state.db_path
    file_count, symbol_count, schema_version = await _run_in_thread(db_path, _query_status)
    return IndexStatusOut(
        file_count=file_count,
        symbol_count=symbol_count,
        schema_version=schema_version,
        repo_root=str(app.state.repo_root),
        db_path=str(db_path),
    )


def _query_file_tree(conn: sqlite3.Connection) -> list[str]:
    """查询所有已索引文件路径（有序）。"""
    rows = conn.execute("SELECT path FROM files ORDER BY path").fetchall()
    return [r[0] for r in rows]


@router.get("/api/files/tree", response_model=FileTreeOut)
async def file_tree(request: Request) -> FileTreeOut:
    """已索引的 .py 文件路径列表（扁平，前端构建嵌套树）。"""
    paths = await _run_in_thread(request.app.state.db_path, _query_file_tree)
    return FileTreeOut(paths=paths)


def _row_to_symbol(row: sqlite3.Row) -> SymbolOut:
    """把 symbols 表行转 SymbolOut（bases/decorators 是 JSON 字符串）。"""
    return SymbolOut(
        id=row[0],
        name=row[1],
        kind=row[2],
        file_path=row[3],
        line=row[4],
        col=row[5],
        end_line=row[6],
        signature=row[7],
        bases=json.loads(row[8]),
        decorators=json.loads(row[9]),
    )


def _query_file_symbols(conn: sqlite3.Connection, rel_path: str) -> list[SymbolOut]:
    """查询指定文件的符号大纲（按行排序）。"""
    rows = conn.execute(
        "SELECT id, name, kind, file_path, line, col, end_line, signature, bases, decorators "
        "FROM symbols WHERE file_path = ? ORDER BY line",
        (rel_path,),
    ).fetchall()
    return [_row_to_symbol(r) for r in rows]


def _query_file_calls(conn: sqlite3.Connection, rel_path: str) -> list[CallOut]:
    """查询指定文件的调用点（S-1，按行+列排序）。"""
    rows = conn.execute(
        "SELECT callee_name, callee_id, line, col FROM calls "
        "WHERE file_path = ? ORDER BY line, col",
        (rel_path,),
    ).fetchall()
    return [CallOut(callee_name=r[0], callee_id=r[1], line=r[2], col=r[3]) for r in rows]


@router.get("/api/files/{file_path:path}", response_model=FileContentOut)
async def file_content(file_path: str, request: Request) -> FileContentOut:
    """文件内容 + 符号大纲。

    安全硬规则 2-3：resolve_path 沙箱检查，路径逃逸/symlink 逃逸 → 403。
    """
    app = request.app
    repo_root: Path = app.state.repo_root
    db_path: Path = app.state.db_path

    # 路径沙箱
    try:
        abs_path = resolve_path(repo_root, file_path)
    except PathEscapeError as e:
        raise HTTPException(403, str(e)) from e

    # 存在性 + 类型检查
    if not abs_path.exists():
        raise HTTPException(404, f"文件不存在：{file_path}")
    if abs_path.is_dir():
        raise HTTPException(400, f"路径指向目录，不是文件：{file_path}")

    # 读内容（cc S-1：errors="replace" 避免非 UTF-8 文件裸 500）
    content = abs_path.read_text(encoding="utf-8", errors="replace")

    # 规范化为索引时的 POSIX 相对路径，再查符号 + 调用点
    rel = abs_path.relative_to(repo_root.resolve()).as_posix()
    symbols = await _run_in_thread(db_path, _query_file_symbols, rel)
    calls = await _run_in_thread(db_path, _query_file_calls, rel)

    return FileContentOut(
        path=rel,
        content=content,
        language="python",
        symbols=symbols,
        calls=calls,
    )


# 符号查询 SQL（routes 层直接查，因 SymbolOut 需要 id，而 indexer.Symbol 无 id 字段）
_SQL_SYMBOL_BY_ID = (
    "SELECT id, name, kind, file_path, line, col, end_line, signature, bases, decorators "
    "FROM symbols WHERE id = ?"
)
_SQL_SYMBOL_BY_NAME = (
    "SELECT id, name, kind, file_path, line, col, end_line, signature, bases, decorators "
    "FROM symbols WHERE name = ? ORDER BY file_path, line"
)


def _query_symbol_by_id(conn: sqlite3.Connection, symbol_id: int) -> SymbolOut | None:
    """按 id 查单个符号（工作线程内调用）。"""
    row = conn.execute(_SQL_SYMBOL_BY_ID, (symbol_id,)).fetchone()
    return _row_to_symbol(row) if row else None


def _query_symbols_by_name(conn: sqlite3.Connection, name: str) -> list[SymbolOut]:
    """按名称查符号定义列表（工作线程内调用）。"""
    rows = conn.execute(_SQL_SYMBOL_BY_NAME, (name,)).fetchall()
    return [_row_to_symbol(r) for r in rows]


@router.get("/api/symbols/{symbol_id}", response_model=SymbolOut)
async def get_symbol(symbol_id: int, request: Request) -> SymbolOut:
    """符号详情（含定义位置、bases、decorators）。"""
    result = await _run_in_thread(request.app.state.db_path, _query_symbol_by_id, symbol_id)
    if result is None:
        raise HTTPException(404, f"符号不存在：id={symbol_id}")
    return result


@router.get("/api/symbols", response_model=list[SymbolOut])
async def search_symbols(name: str, request: Request) -> list[SymbolOut]:
    """按名称查符号定义（候选列表）。"""
    return await _run_in_thread(request.app.state.db_path, _query_symbols_by_name, name)


def _query_references(conn: sqlite3.Connection, symbol_id: int) -> list[ReferenceOut]:
    """查符号引用（调用 + 导入），转 ReferenceOut。"""
    refs = find_references(conn, symbol_id)
    return [ReferenceOut(file_path=r.file_path, line=r.line, col=r.col, kind=r.kind) for r in refs]


# 调用者查询 SQL（JOIN calls，需要 callee_name 先查 symbol name）
_SQL_CALLERS = (
    "SELECT DISTINCT s.id, s.name, s.kind, s.file_path, s.line, s.col, "
    "s.end_line, s.signature, s.bases, s.decorators "
    "FROM symbols s JOIN calls c ON c.caller_id = s.id "
    "WHERE c.callee_name = ? ORDER BY s.file_path, s.line"
)


def _query_callers(conn: sqlite3.Connection, symbol_id: int) -> list[SymbolOut]:
    """查调用者（先取 name，再 JOIN calls）。"""
    row = conn.execute("SELECT name FROM symbols WHERE id = ?", (symbol_id,)).fetchone()
    if row is None:
        return []
    rows = conn.execute(_SQL_CALLERS, (row[0],)).fetchall()
    return [_row_to_symbol(r) for r in rows]


def _query_callees(conn: sqlite3.Connection, symbol_id: int) -> list[SymbolOut]:
    """查被调用者（多候选 + 去重，逻辑同 indexer.find_callees 但返回含 id 的 SymbolOut）。"""
    calls = conn.execute(
        "SELECT callee_name, callee_id FROM calls WHERE caller_id = ?", (symbol_id,)
    ).fetchall()
    result: list[SymbolOut] = []
    seen: set[int] = set()
    for callee_name, callee_id in calls:
        if callee_id is not None:
            rows = conn.execute(_SQL_SYMBOL_BY_ID, (callee_id,)).fetchall()
        else:
            rows = conn.execute(_SQL_SYMBOL_BY_NAME, (callee_name,)).fetchall()
        for r in rows:
            if r[0] not in seen:
                seen.add(r[0])
                result.append(_row_to_symbol(r))
    return result


@router.get("/api/symbols/{symbol_id}/references", response_model=list[ReferenceOut])
async def symbol_references(
    symbol_id: int,
    request: Request,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[ReferenceOut]:
    """符号引用列表（调用 + 导入），limit 截断（O-1，cc S-2：ge=1 防负数绕过）。"""
    refs = await _run_in_thread(request.app.state.db_path, _query_references, symbol_id)
    return refs[:limit]


@router.get("/api/symbols/{symbol_id}/callers", response_model=list[SymbolOut])
async def symbol_callers(symbol_id: int, request: Request) -> list[SymbolOut]:
    """调用者列表。"""
    return await _run_in_thread(request.app.state.db_path, _query_callers, symbol_id)


@router.get("/api/symbols/{symbol_id}/callees", response_model=list[SymbolOut])
async def symbol_callees(symbol_id: int, request: Request) -> list[SymbolOut]:
    """被调用者列表（含多候选，去重）。"""
    return await _run_in_thread(request.app.state.db_path, _query_callees, symbol_id)


def _query_search(conn: sqlite3.Connection, query: str, limit: int) -> list[SearchHitOut]:
    """FTS5 全文搜索（双引号转义，SQL 层 limit）。"""
    escaped = query.replace('"', '""')
    fts_query = f'"{escaped}"'
    rows = conn.execute(
        """
        SELECT s.id, s.name, s.kind, s.file_path, s.line, s.signature
        FROM symbols_fts f JOIN symbols s ON s.id = f.rowid
        WHERE symbols_fts MATCH ?
        ORDER BY s.name
        LIMIT ?
        """,
        (fts_query, limit),
    ).fetchall()
    return [
        SearchHitOut(
            symbol_id=r[0],
            name=r[1],
            kind=r[2],
            file_path=r[3],
            line=r[4],
            snippet=r[5],
        )
        for r in rows
    ]


@router.get("/api/search", response_model=list[SearchHitOut])
async def search(
    request: Request,
    q: str,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[SearchHitOut]:
    """FTS5 全文搜索符号名。空 q → 400，limit 截断（O-1，cc S-2：ge=1 防负数绕过）。"""
    if not q.strip():
        raise HTTPException(400, "搜索关键词不能为空")
    return await _run_in_thread(request.app.state.db_path, _query_search, q, limit)
