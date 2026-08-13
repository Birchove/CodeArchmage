"""索引器 resolver：跨文件关系推断。

循环 4：assign_callers —— 调用点落在哪个函数的行范围内（最内层规则）
循环 5：resolve_callees —— 按名称匹配定义（仅全库唯一同名才填充 callee_id）

设计依据：plans/stages/stage2_indexer.md（S2/S3 修订）。
"""

from __future__ import annotations

import sqlite3


def assign_callers(conn: sqlite3.Connection) -> None:
    """推断每个调用点的 caller（最内层 function 规则）。

    规则（S2 修订）：
    - 遍历所有调用点，找同文件内行范围 [line, end_line] 包含该调用的 function 符号
    - 跳过 class 符号（类范围不作为 caller）
    - 取最内层（end_line - line 最小，即范围最窄的函数）
    - 无包含函数 → caller_id = NULL（模块级调用）

    必须在 index_file 之后调用（calls 表已有数据）。
    """
    calls = conn.execute("SELECT id, file_path, line FROM calls").fetchall()

    for call_id, file_path, call_line in calls:
        # 找同文件内、行范围包含调用行的 function 符号
        candidates = conn.execute(
            """
            SELECT id, line, end_line
            FROM symbols
            WHERE kind = 'function'
              AND file_path = ?
              AND line <= ?
              AND end_line >= ?
            """,
            (file_path, call_line, call_line),
        ).fetchall()

        if candidates:
            # 最内层 = 范围最窄 = (end_line - line) 最小
            best = min(candidates, key=lambda c: c[2] - c[1])
            conn.execute(
                "UPDATE calls SET caller_id = ? WHERE id = ?",
                (best[0], call_id),
            )
        # else: 模块级调用，caller_id 保持 NULL

    conn.commit()


def resolve_callees(conn: sqlite3.Connection) -> None:
    """按名称保守匹配 callee（仅全库唯一同名才填充 callee_id）。

    规则（S3 修订）：
    - 遍历所有调用点，按 callee_name 查 symbols.name
    - 仅当全库唯一同名定义时，填充 callee_id
    - 多候选（同名 > 1）或无定义 → callee_id = NULL
    - 多候选的候选列表由 find_callees 查询时实时 JOIN 返回

    必须在 index_file 之后调用（calls + symbols 表已有数据）。
    每次调用先清空所有 callee_id，避免增量索引后陈旧值残留（B1 修复）。
    """
    # 先清空所有 callee_id（避免增量场景下旧值残留）
    conn.execute("UPDATE calls SET callee_id = NULL")

    calls = conn.execute("SELECT id, callee_name FROM calls").fetchall()

    for call_id, callee_name in calls:
        matches = conn.execute(
            "SELECT id FROM symbols WHERE name = ?",
            (callee_name,),
        ).fetchall()

        if len(matches) == 1:
            conn.execute(
                "UPDATE calls SET callee_id = ? WHERE id = ?",
                (matches[0][0], call_id),
            )
        # else: 多候选或无定义，callee_id 保持 NULL

    conn.commit()
