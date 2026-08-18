"""导读 LLM 上下文组装（Stage 7b 循环 3）。

三级导读的输入上下文，全部由符号表/文件系统确定性组装（不调 LLM）：
- 文件导读：小文件给完整源码；超长文件降级为签名清单（控 token）
- 模块导读：各文件签名 + 导入关系（不含函数体）；超文件数上限截断
- 项目导读：文件清单 + 统计 + 入口启发式标记
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

# 文件导读：超过此行数不给完整源码，降级为签名清单
_FILE_SOURCE_MAX_LINES = 500
# 模块导读：最多列多少个文件（按符号数排序取头部）
_MODULE_MAX_FILES = 15

# 入口文件启发式：文件名匹配
_ENTRY_FILENAMES = frozenset({"main.py", "cli.py", "app.py", "__main__.py", "manage.py", "run.py"})


def build_file_guide_context(conn: sqlite3.Connection, repo_root: Path, file_path: str) -> str:
    """文件级导读上下文。文件不在索引 → 空字符串。"""
    row = conn.execute("SELECT path FROM files WHERE path = ?", (file_path,)).fetchone()
    if row is None:
        return ""

    symbols = conn.execute(
        "SELECT name, kind, line, end_line, signature "
        "FROM symbols WHERE file_path = ? ORDER BY line",
        (file_path,),
    ).fetchall()

    source = _read_file(repo_root, file_path)
    line_count = len(source.splitlines()) if source else 0

    parts = [
        f"# 文件导读上下文：{file_path}",
        f"行数：{line_count}，符号：{len(symbols)} 个",
    ]

    if line_count <= _FILE_SOURCE_MAX_LINES and source:
        parts.append("## 源码")
        parts.append(source)
    else:
        parts.append("## 符号签名清单（文件较长，仅列签名）")
        parts.extend(
            f"- {kind} {signature}（第 {line}–{end_line} 行）"
            for name, kind, line, end_line, signature in symbols
        )

    return "\n\n".join(parts)


def build_module_guide_context(
    conn: sqlite3.Connection,
    repo_root: Path,
    module_path: str,
) -> str:
    """模块级导读上下文。模块下无文件 → 空字符串。"""
    prefix = module_path.rstrip("/") + "/"
    rows = conn.execute(
        "SELECT path FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path",
        (prefix.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%",),
    ).fetchall()
    paths = [r[0] for r in rows]
    if not paths:
        return ""

    # 按符号数排序，超上限截断
    counted: list[tuple[int, str]] = []
    for p in paths:
        n = conn.execute("SELECT count(*) FROM symbols WHERE file_path = ?", (p,)).fetchone()[0]
        counted.append((n, p))
    counted.sort(key=lambda x: (-x[0], x[1]))

    truncated = len(counted) > _MODULE_MAX_FILES
    selected = counted[:_MODULE_MAX_FILES]

    header = f"文件：{len(paths)} 个"
    if truncated:
        header += f"（仅列出符号最多的前 {_MODULE_MAX_FILES} 个）"
    parts = [f"# 模块导读上下文：{module_path}", header]
    if truncated:
        remaining = len(paths) - _MODULE_MAX_FILES
        parts.append(f"注：模块内文件数超过上限，其余 {remaining} 个文件已截断。")

    for _n, p in selected:
        parts.append(f"### {p}")
        imports = conn.execute(
            "SELECT module, imported_name FROM imports WHERE file_path = ? ORDER BY line",
            (p,),
        ).fetchall()
        if imports:
            parts.append(
                "导入：" + "、".join(sorted({f"{m}.{name}" if m else name for m, name in imports}))
            )
        syms = conn.execute(
            "SELECT kind, signature, line FROM symbols "
            "WHERE file_path = ? AND kind != 'variable' ORDER BY line",
            (p,),
        ).fetchall()
        parts.extend(f"- {kind} {signature}（第 {line} 行）" for kind, signature, line in syms)

    return "\n\n".join(parts)


def build_project_guide_context(
    conn: sqlite3.Connection,
    repo_root: Path,
) -> str:
    """项目级导读上下文。空仓库 → 空字符串。"""
    files = conn.execute("SELECT path FROM files ORDER BY path").fetchall()
    if not files:
        return ""

    symbol_total = conn.execute("SELECT count(*) FROM symbols").fetchone()[0]
    call_total = conn.execute("SELECT count(*) FROM calls").fetchone()[0]

    parts = [
        "# 项目导读上下文",
        f"文件：{len(files)} 个，符号：{symbol_total} 个，调用点：{call_total} 个",
        "",
        "## 文件清单",
    ]

    for (path,) in files:
        n = conn.execute("SELECT count(*) FROM symbols WHERE file_path = ?", (path,)).fetchone()[0]
        entry = " ← 入口" if _looks_like_entry(repo_root, path) else ""
        parts.append(f"- {path}（{n} 个符号）{entry}".rstrip())

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 私有辅助
# ---------------------------------------------------------------------------


def _read_file(repo_root: Path, file_path: str) -> str:
    """读文件内容（errors=replace）；失败 → 空字符串。"""
    try:
        return (repo_root / file_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _looks_like_entry(repo_root: Path, path: str) -> bool:
    """入口启发式：文件名匹配，或文件内含 __main__ 守卫。"""
    name = Path(path).name
    if name in _ENTRY_FILENAMES:
        return True
    return '__name__ == "__main__"' in _read_file(repo_root, path)
