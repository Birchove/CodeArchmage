"""LLM 确定性上下文组装。

build_context(conn, symbol_id, repo_root) 是纯函数：
- 从 symbols / calls 表 SQL 查询，不调 HTTP
- 从文件系统读取源码行
- 返回 XML 标签分隔的 Markdown 字符串（抗 LLM 注入歧义）

符号类型：
  function / method → 签名 + 源码 + 直接 callers + 直接 callees
  class             → 签名 + 源码 + bases + 同文件同类成员
  variable          → 名称 + 源码行
  其他              → 仅名称 + 源码行
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path


def build_context(
    conn: sqlite3.Connection,
    symbol_id: int,
    repo_root: Path,
) -> str:
    """组装 LLM 上下文。

    Args:
        conn:      已建立的 SQLite 连接（调用方管理生命周期）。
        symbol_id: 目标符号 id。
        repo_root: 仓库根目录（用于读取源码文件）。

    Returns:
        字符串上下文，供 LLM system prompt 使用；
        symbol_id 不存在时返回空字符串。
    """
    row = conn.execute(
        "SELECT id, name, kind, file_path, line, end_line, signature, bases, decorators "
        "FROM symbols WHERE id = ?",
        (symbol_id,),
    ).fetchone()
    if row is None:
        return ""

    sym_id: int = row[0]
    name: str = row[1]
    kind: str = row[2]
    file_path: str = row[3]
    line: int = row[4]
    end_line: int = row[5]
    signature: str = row[6]
    bases: list[str] = json.loads(row[7])

    parts: list[str] = []
    parts.append(f"# 符号：{name}（{kind}）")
    parts.append(f"# 文件：{file_path}（第 {line}–{end_line} 行）")

    # --- 源码读取 ---
    source = _read_lines(repo_root, file_path, line, end_line)
    if source:
        parts.append(f"<source_code>\n{source}\n</source_code>")
    else:
        parts.append(f"<source_code>\n# （文件暂时无法读取：{file_path}）\n# 符号：{name}\n</source_code>")

    # --- 按 kind 组装额外上下文 ---
    if kind in ("function", "method"):
        _append_callers(conn, parts, name)
        _append_callees(conn, parts, sym_id)
    elif kind == "class":
        if bases:
            parts.append("<bases>\n" + "\n".join(f"- {b}" for b in bases) + "\n</bases>")
        _append_members(conn, parts, file_path, name, line, end_line)

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# 私有辅助
# ---------------------------------------------------------------------------


def _read_lines(repo_root: Path, file_path: str, line: int, end_line: int) -> str:
    """读取文件的 [line, end_line] 行（1-indexed，含两端）。
    文件不存在或读取失败 → 返回空字符串（不抛异常）。
    """
    abs_path = repo_root / file_path
    try:
        text = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    lines = text.splitlines()
    start = max(0, line - 1)
    stop = min(len(lines), end_line)
    return "\n".join(lines[start:stop])


def _append_callers(
    conn: sqlite3.Connection, parts: list[str], callee_name: str
) -> None:
    """追加直接 caller 列表。"""
    rows = conn.execute(
        "SELECT DISTINCT s.name, s.file_path, c.line "
        "FROM symbols s JOIN calls c ON c.caller_id = s.id "
        "WHERE c.callee_name = ? "
        "ORDER BY s.file_path, c.line",
        (callee_name,),
    ).fetchall()
    if not rows:
        return
    lines = [f"- {r[0]}（{r[1]}:{r[2]}）" for r in rows]
    parts.append("<callers>\n" + "\n".join(lines) + "\n</callers>")


def _append_callees(
    conn: sqlite3.Connection, parts: list[str], caller_id: int
) -> None:
    """追加直接 callee 列表（名称 + 签名）。"""
    rows = conn.execute(
        "SELECT DISTINCT c.callee_name, s.signature "
        "FROM calls c LEFT JOIN symbols s ON s.id = c.callee_id "
        "WHERE c.caller_id = ? "
        "ORDER BY c.callee_name",
        (caller_id,),
    ).fetchall()
    if not rows:
        return
    lines: list[str] = []
    for callee_name, sig in rows:
        if sig:
            lines.append(f"- {callee_name}：{sig}")
        else:
            lines.append(f"- {callee_name}")
    parts.append("<callees>\n" + "\n".join(lines) + "\n</callees>")


def _append_members(
    conn: sqlite3.Connection,
    parts: list[str],
    file_path: str,
    class_name: str,
    class_line: int,
    class_end_line: int,
) -> None:
    """追加属于该类的成员方法（行落在类的 [class_line, class_end_line] 区间内）。"""
    rows = conn.execute(
        "SELECT name, signature FROM symbols "
        "WHERE file_path = ? AND kind IN ('method', 'function') "
        "AND name != ? AND line >= ? AND line <= ? "
        "ORDER BY line",
        (file_path, class_name, class_line, class_end_line),
    ).fetchall()
    if not rows:
        return
    lines = []
    for member_name, sig in rows:
        if sig:
            lines.append(f"- {member_name}：{sig}")
        else:
            lines.append(f"- {member_name}")
    parts.append("<members>\n" + "\n".join(lines) + "\n</members>")
