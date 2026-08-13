"""索引器查询接口：定义 / 引用 / 调用者 / 被调用者。

阶段 2 第七、八个 TDD 循环。纯函数风格，输入 (conn, 参数) → 输出 dataclass。
用 :memory: 测试，无副作用。

设计依据：plans/stages/stage2_indexer.md。
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from code_archmage.parser.models import Symbol, SymbolKind


@dataclass(frozen=True)
class Reference:
    """一个引用点（调用或导入）。

    Attributes:
        file_path: 引用所在文件
        line: 引用行（1-based）
        col: 引用列（0-based）
        kind: 引用类型："call" 或 "import"
    """

    file_path: str
    line: int
    col: int
    kind: str


def _row_to_symbol(row: tuple[Any, ...]) -> Symbol:
    """将 DB 行转换为 Symbol 对象（bases / decorators 从 JSON 还原）。"""
    (
        _id,
        name,
        kind_str,
        file_path,
        line,
        col,
        end_line,
        signature,
        bases_json,
        decorators_json,
    ) = row
    return Symbol(
        name=name,
        kind=SymbolKind(kind_str),
        file_path=file_path,
        line=line,
        col=col,
        end_line=end_line,
        signature=signature,
        bases=tuple(json.loads(bases_json)),
        decorators=tuple(json.loads(decorators_json)),
    )


_QUERY_SYMBOL_ALL = """
    SELECT id, name, kind, file_path, line, col, end_line, signature, bases, decorators
    FROM symbols
"""


def find_definition(conn: sqlite3.Connection, name: str) -> list[Symbol]:
    """按名称查符号定义（可能多个，如跨文件同名）。

    Args:
        conn: 数据库连接
        name: 符号名

    Returns:
        匹配的 Symbol 列表（空列表 = 无定义）
    """
    rows = conn.execute(
        f"{_QUERY_SYMBOL_ALL} WHERE name = ? ORDER BY file_path, line",
        (name,),
    ).fetchall()
    return [_row_to_symbol(r) for r in rows]


def find_references(conn: sqlite3.Connection, symbol_id: int) -> list[Reference]:
    """查符号的引用点（调用 + 导入）。

    引用范围（B3 修订）：
    - 调用点：calls.callee_id = symbol_id
    - 导入点：imports.imported_name = symbol.name

    Args:
        conn: 数据库连接
        symbol_id: 符号 id

    Returns:
        Reference 列表（空列表 = 无引用）
    """
    # 取符号名（用于匹配导入）
    row = conn.execute("SELECT name FROM symbols WHERE id = ?", (symbol_id,)).fetchone()
    if row is None:
        return []
    symbol_name = row[0]

    references: list[Reference] = []

    # 调用引用
    call_rows = conn.execute(
        "SELECT file_path, line, col FROM calls WHERE callee_id = ?",
        (symbol_id,),
    ).fetchall()
    for file_path, line, col in call_rows:
        references.append(Reference(file_path=file_path, line=line, col=col, kind="call"))

    # 导入引用
    import_rows = conn.execute(
        "SELECT file_path, line FROM imports WHERE imported_name = ?",
        (symbol_name,),
    ).fetchall()
    for file_path, line in import_rows:
        references.append(Reference(file_path=file_path, line=line, col=0, kind="import"))

    return references


def find_callers(conn: sqlite3.Connection, name: str) -> list[Symbol]:
    """查调用指定名称的符号（调用者）。

    Args:
        conn: 数据库连接
        name: 被调用的名称（callee_name）

    Returns:
        调用者 Symbol 列表（去重）
    """
    rows = conn.execute(
        """
        SELECT DISTINCT
            s.id, s.name, s.kind, s.file_path, s.line, s.col,
            s.end_line, s.signature, s.bases, s.decorators
        FROM symbols s
        JOIN calls c ON c.caller_id = s.id
        WHERE c.callee_name = ?
        ORDER BY s.file_path, s.line
        """,
        (name,),
    ).fetchall()
    return [_row_to_symbol(r) for r in rows]


def find_callees(conn: sqlite3.Connection, symbol_id: int) -> list[Symbol]:
    """查被指定符号调用的所有符号（被调用者，含多候选，去重）。

    多候选处理（S3 修订）：
    - callee_id 有值 → 直接返回该符号
    - callee_id = NULL → 按 callee_name 查所有同名定义（可能多个）

    去重（B4 修复）：同一目标被调用多次只返回一次（按 symbol id 去重）。

    Args:
        conn: 数据库连接
        symbol_id: 调用者符号 id

    Returns:
        被调用者 Symbol 列表（去重，可能含同名多候选）
    """
    # 取该符号的所有调用
    calls = conn.execute(
        "SELECT callee_name, callee_id FROM calls WHERE caller_id = ?",
        (symbol_id,),
    ).fetchall()

    callees: list[Symbol] = []
    seen_ids: set[int] = set()
    for callee_name, callee_id in calls:
        if callee_id is not None:
            # 已解析：直接取
            rows = conn.execute(f"{_QUERY_SYMBOL_ALL} WHERE id = ?", (callee_id,)).fetchall()
        else:
            # 未解析：按名称查所有候选
            rows = conn.execute(f"{_QUERY_SYMBOL_ALL} WHERE name = ?", (callee_name,)).fetchall()
        for r in rows:
            if r[0] not in seen_ids:
                seen_ids.add(r[0])
                callees.append(_row_to_symbol(r))

    return callees
