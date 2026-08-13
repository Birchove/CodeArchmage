"""索引器 FTS5 全文搜索。

阶段 2 第九个 TDD 循环。用 FTS5 MATCH 查询搜索符号名。
FTS5 特殊字符用双引号包裹转义，避免查询注入。

设计依据：plans/stages/stage2_indexer.md（B1 修订）。
"""

from __future__ import annotations

import sqlite3

from code_archmage.indexer.queries import _row_to_symbol
from code_archmage.parser.models import Symbol


def search_fts(conn: sqlite3.Connection, query: str) -> list[Symbol]:
    """FTS5 全文搜索符号名。

    用双引号包裹查询字符串，将其作为 FTS5 phrase 处理，
    自动转义内部双引号（FTS5 规范："" 表示字面双引号）。

    Args:
        conn: 数据库连接
        query: 搜索关键词（符号名或片段）

    Returns:
        匹配的 Symbol 列表（空列表 = 无匹配）
    """
    # 转义 FTS5 特殊字符：用双引号包裹查询，内部双引号加倍
    escaped = query.replace('"', '""')
    fts_query = f'"{escaped}"'

    rows = conn.execute(
        """
        SELECT s.id, s.name, s.kind, s.file_path, s.line, s.col,
               s.end_line, s.signature, s.bases, s.decorators
        FROM symbols_fts f
        JOIN symbols s ON s.id = f.rowid
        WHERE symbols_fts MATCH ?
        ORDER BY s.name
        """,
        (fts_query,),
    ).fetchall()
    return [_row_to_symbol(r) for r in rows]
