"""索引器写入层：把解析结果持久化到 SQLite。

设计原则（ADR-002）：
- 纯同步函数，输入 (conn, repo_root, parse_result)
- 路径规范化为相对仓库根的 POSIX 路径
- 单文件写入用事务包裹（原子性）
- 先删后写：重新索引时先清除旧数据，避免孤儿（S1 修订）
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from code_archmage.parser.models import Call, Import, ParseResult, Symbol
from code_archmage.parser.parser import parse

# 目录索引时跳过的目录名
_SKIP_DIRS = frozenset({"__pycache__", ".venv", "venv", ".git", "node_modules"})


def _normalize_path(file_path: str | Path, repo_root: str | Path) -> str:
    """将文件路径规范化为相对仓库根的 POSIX 路径。

    例：/abs/repo/src/main.py + repo_root=/abs/repo → "src/main.py"
    """
    rel = Path(file_path).relative_to(repo_root)
    return rel.as_posix()


def _file_hash(file_path: str | Path) -> str:
    """计算文件内容的 SHA-256。"""
    return hashlib.sha256(Path(file_path).read_bytes()).hexdigest()


def _now_iso() -> str:
    """当前 UTC 时间的 ISO8601 字符串。"""
    return datetime.now(UTC).isoformat()


def _delete_file_data(conn: sqlite3.Connection, file_path: str) -> None:
    """删除指定文件的所有索引数据（symbols / calls / imports / files）。

    symbols 的 FTS 触发器会自动清理 symbols_fts。
    用于先删后写（S1 修订）和孤儿清理。
    """
    conn.execute("DELETE FROM symbols WHERE file_path = ?", (file_path,))
    conn.execute("DELETE FROM calls WHERE file_path = ?", (file_path,))
    conn.execute("DELETE FROM imports WHERE file_path = ?", (file_path,))
    conn.execute("DELETE FROM files WHERE path = ?", (file_path,))


def _iter_python_files(repo_root: str | Path) -> list[Path]:
    """遍历仓库下所有 .py 文件，跳过 __pycache__ / .venv / venv 等。"""
    root = Path(repo_root)
    results: list[Path] = []
    for path in root.rglob("*.py"):
        # 检查路径中是否包含需跳过的目录
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        results.append(path)
    return results


def _insert_symbol(conn: sqlite3.Connection, symbol: Symbol, file_path: str) -> None:
    """插入单个符号记录。"""
    conn.execute(
        """
        INSERT INTO symbols
            (name, kind, file_path, line, col, end_line, signature, bases, decorators)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol.name,
            str(symbol.kind),
            file_path,
            symbol.line,
            symbol.col,
            symbol.end_line,
            symbol.signature,
            json.dumps(list(symbol.bases)),
            json.dumps(list(symbol.decorators)),
        ),
    )


def _insert_call(conn: sqlite3.Connection, call: Call, file_path: str) -> None:
    """插入单个调用记录（caller_id / callee_id 暂留 NULL，由 resolver 填充）。"""
    conn.execute(
        """
        INSERT INTO calls (caller_id, callee_name, callee_id, file_path, line, col)
        VALUES (NULL, ?, NULL, ?, ?, ?)
        """,
        (call.callee_name, file_path, call.line, call.col),
    )


def _insert_import(conn: sqlite3.Connection, imp: Import, file_path: str) -> None:
    """插入单个导入记录。"""
    conn.execute(
        """
        INSERT INTO imports (file_path, module, imported_name, alias, level, line)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (file_path, imp.module, imp.imported_name, imp.alias, imp.level, imp.line),
    )


def index_file(
    conn: sqlite3.Connection,
    repo_root: str | Path,
    parse_result: ParseResult,
) -> None:
    """索引单个文件的解析结果到数据库（先删后写，支持重新索引）。

    写入 files / symbols / calls / imports 四张表。
    caller_id / callee_id 暂留 NULL，由 resolver 在循环 4-5 填充。
    整个写入在单个事务内（原子性）。重新索引时先删旧数据（S1 修订）。

    Args:
        conn: 数据库连接
        repo_root: 仓库根目录（用于路径规范化）
        parse_result: 解析器输出
    """
    rel_path = _normalize_path(parse_result.file_path, repo_root)
    file_hash = _file_hash(parse_result.file_path)
    indexed_at = _now_iso()

    try:
        conn.execute("BEGIN")
        # 先删后写：清除该文件的旧数据（重新索引时不留孤儿）
        _delete_file_data(conn, rel_path)
        # files 表
        conn.execute(
            "INSERT INTO files (path, hash, indexed_at) VALUES (?, ?, ?)",
            (rel_path, file_hash, indexed_at),
        )
        # symbols 表
        for symbol in parse_result.symbols:
            _insert_symbol(conn, symbol, rel_path)
        # calls 表
        for call in parse_result.calls:
            _insert_call(conn, call, rel_path)
        # imports 表
        for imp in parse_result.imports:
            _insert_import(conn, imp, rel_path)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def index_directory(
    conn: sqlite3.Connection,
    repo_root: str | Path,
) -> None:
    """索引整个目录（增量索引 + 先删后写 + 孤儿清理）。

    流程：
    1. 遍历所有 .py 文件（跳过 __pycache__ / .venv 等）
    2. 按 hash 增量：hash 相同跳过，hash 变化或新文件 → 先删后写
    3. 清理孤儿：DB 中有但磁盘上已删除的文件

    不自动跑 resolver（调用方按需执行 assign_callers + resolve_callees）。

    Args:
        conn: 数据库连接
        repo_root: 仓库根目录
    """
    root = Path(repo_root)
    disk_files = _iter_python_files(root)
    disk_rel_paths: set[str] = set()

    for py_file in disk_files:
        rel_path = _normalize_path(py_file, root)
        disk_rel_paths.add(rel_path)
        file_hash = _file_hash(py_file)

        # 增量检查：hash 相同则跳过
        existing = conn.execute("SELECT hash FROM files WHERE path = ?", (rel_path,)).fetchone()
        if existing and existing[0] == file_hash:
            continue

        # hash 变化或新文件 → 解析并索引（index_file 内部先删后写）
        result = parse(py_file)
        index_file(conn, root, result)

    # 孤儿清理：DB 中有但磁盘上已删除的文件
    db_files = conn.execute("SELECT path FROM files").fetchall()
    for (path,) in db_files:
        if path not in disk_rel_paths:
            try:
                conn.execute("BEGIN")
                _delete_file_data(conn, path)
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
