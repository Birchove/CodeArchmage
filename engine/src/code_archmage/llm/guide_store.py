"""guides 存储层（Stage 7b 循环 1）。

按 (scope, path) 唯一的导读缓存：scope ∈ {project, module, file}。
input_hash 记录生成时输入上下文的哈希，重新索引后用于 stale 判断。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime

# 列序与 StoredGuide 字段序一致（构造时按位置解包）
_SELECT_COLUMNS = "scope, path, content_md, model, input_hash, created_at"


@dataclass(frozen=True)
class StoredGuide:
    """一条导读缓存记录。"""

    scope: str
    path: str
    content_md: str
    model: str
    input_hash: str
    created_at: str


def _now_iso() -> str:
    """当前 UTC 时间的 ISO8601 字符串。"""
    return datetime.now(UTC).isoformat()


def upsert_guide(
    conn: sqlite3.Connection,
    scope: str,
    path: str,
    content_md: str,
    model: str,
    input_hash: str,
) -> None:
    """写入或覆盖一条导读（同 scope+path 只留最新）。"""
    conn.execute(
        f"INSERT OR REPLACE INTO guides ({_SELECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)",
        (scope, path, content_md, model, input_hash, _now_iso()),
    )
    conn.commit()


def get_guide(conn: sqlite3.Connection, scope: str, path: str) -> StoredGuide | None:
    """读一条导读；未生成 → None。"""
    row = conn.execute(
        f"SELECT {_SELECT_COLUMNS} FROM guides WHERE scope = ? AND path = ?",
        (scope, path),
    ).fetchone()
    if row is None:
        return None
    return StoredGuide(*row)


def list_guides(conn: sqlite3.Connection) -> list[StoredGuide]:
    """列出所有导读条目。"""
    rows = conn.execute(f"SELECT {_SELECT_COLUMNS} FROM guides ORDER BY scope, path").fetchall()
    return [StoredGuide(*r) for r in rows]
