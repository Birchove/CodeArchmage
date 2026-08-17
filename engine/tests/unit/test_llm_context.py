"""tests/unit/test_llm_context.py – 循环 2-4：build_context 确定性上下文组装。"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from code_archmage.llm.context import build_context

# ---------------------------------------------------------------------------
# Fixtures：内存 SQLite + 最小 schema
# ---------------------------------------------------------------------------


def _make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, indexed_at TEXT NOT NULL);
        CREATE TABLE symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, kind TEXT NOT NULL,
            file_path TEXT NOT NULL, line INTEGER NOT NULL, col INTEGER NOT NULL,
            end_line INTEGER NOT NULL, signature TEXT NOT NULL,
            bases TEXT NOT NULL, decorators TEXT NOT NULL
        );
        CREATE TABLE calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_id INTEGER, callee_name TEXT NOT NULL,
            callee_id INTEGER, file_path TEXT NOT NULL,
            line INTEGER NOT NULL, col INTEGER NOT NULL
        );
    """)
    return conn


def _insert_symbol(
    conn: sqlite3.Connection,
    *,
    name: str,
    kind: str,
    file_path: str,
    line: int = 1,
    end_line: int = 10,
    signature: str = "",
    bases: list[str] | None = None,
    decorators: list[str] | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO symbols(name, kind, file_path, line, col, end_line, signature, bases, decorators) "
        "VALUES (?,?,?,?,0,?,?,?,?)",
        (
            name,
            kind,
            file_path,
            line,
            end_line,
            signature,
            json.dumps(bases or []),
            json.dumps(decorators or []),
        ),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _insert_call(
    conn: sqlite3.Connection,
    *,
    caller_id: int,
    callee_name: str,
    callee_id: int | None = None,
    file_path: str = "src/a.py",
    line: int = 5,
) -> None:
    conn.execute(
        "INSERT INTO calls(caller_id, callee_name, callee_id, file_path, line, col) "
        "VALUES (?,?,?,?,?,0)",
        (caller_id, callee_name, callee_id, file_path, line),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# 循环 2：函数符号
# ---------------------------------------------------------------------------


class TestBuildContextFunction:
    def test_function_contains_name_and_signature(
        self, conn: sqlite3.Connection, tmp_path: Path
    ) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("def add(x, y):\n    return x + y\n")
        sid = _insert_symbol(
            conn,
            name="add",
            kind="function",
            file_path="src/a.py",
            line=1,
            end_line=2,
            signature="def add(x, y):",
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "add" in ctx
        assert "def add(x, y):" in ctx

    def test_function_contains_source_code(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("def add(x, y):\n    return x + y\n")
        sid = _insert_symbol(
            conn,
            name="add",
            kind="function",
            file_path="src/a.py",
            line=1,
            end_line=2,
            signature="def add(x, y):",
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "return x + y" in ctx

    def test_function_contains_callers(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("def add(x, y):\n    return x + y\n\ndef main():\n    add(1, 2)\n")
        sid = _insert_symbol(
            conn, name="add", kind="function", file_path="src/a.py", line=1, end_line=2
        )
        caller_id = _insert_symbol(
            conn, name="main", kind="function", file_path="src/a.py", line=4, end_line=5
        )
        _insert_call(conn, caller_id=caller_id, callee_name="add", callee_id=sid)
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "main" in ctx

    def test_function_contains_callees(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("def helper(): pass\ndef add(x, y):\n    return helper() + x + y\n")
        helper_id = _insert_symbol(
            conn,
            name="helper",
            kind="function",
            file_path="src/a.py",
            line=1,
            end_line=1,
            signature="def helper():",
        )
        sid = _insert_symbol(
            conn,
            name="add",
            kind="function",
            file_path="src/a.py",
            line=2,
            end_line=3,
            signature="def add(x, y):",
        )
        _insert_call(conn, caller_id=sid, callee_name="helper", callee_id=helper_id)
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "helper" in ctx

    def test_function_uses_xml_tags(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("def add(x, y):\n    return x + y\n")
        sid = _insert_symbol(
            conn,
            name="add",
            kind="function",
            file_path="src/a.py",
            line=1,
            end_line=2,
            signature="def add(x, y):",
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "<source_code>" in ctx
        assert "</source_code>" in ctx

    @pytest.fixture
    def conn(self) -> sqlite3.Connection:
        return _make_conn()


# ---------------------------------------------------------------------------
# 循环 3：类/变量符号
# ---------------------------------------------------------------------------


class TestBuildContextClass:
    def test_class_contains_bases(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("class Dog(Animal):\n    def bark(self): pass\n")
        sid = _insert_symbol(
            conn,
            name="Dog",
            kind="class",
            file_path="src/a.py",
            line=1,
            end_line=2,
            bases=["Animal"],
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "Animal" in ctx

    def test_class_contains_methods(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("class Dog(Animal):\n    def bark(self): pass\n")
        _insert_symbol(conn, name="Dog", kind="class", file_path="src/a.py", line=1, end_line=2)
        sid = _insert_symbol(
            conn,
            name="Dog",
            kind="class",
            file_path="src/a.py",
            line=1,
            end_line=2,
            bases=["Animal"],
        )
        _insert_symbol(
            conn,
            name="bark",
            kind="method",
            file_path="src/a.py",
            line=2,
            end_line=2,
            signature="def bark(self):",
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "bark" in ctx

    def test_class_source_code(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("class Dog(Animal):\n    def bark(self): pass\n")
        sid = _insert_symbol(
            conn, name="Dog", kind="class", file_path="src/a.py", line=1, end_line=2
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "class Dog" in ctx

    def test_class_members_excludes_top_level_functions(
        self, conn: sqlite3.Connection, tmp_path: Path
    ) -> None:
        """同文件顶层函数不应被误列为类成员（C-5 回归测试）。"""
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("class Dog:\n    def bark(self): pass\n\ndef standalone(): pass\n")
        class_id = _insert_symbol(
            conn, name="Dog", kind="class", file_path="src/a.py", line=1, end_line=2
        )
        _insert_symbol(
            conn,
            name="bark",
            kind="method",
            file_path="src/a.py",
            line=2,
            end_line=2,
            signature="def bark(self):",
        )
        _insert_symbol(
            conn,
            name="standalone",
            kind="function",
            file_path="src/a.py",
            line=4,
            end_line=4,
            signature="def standalone():",
        )
        ctx = build_context(conn, class_id, repo_root=tmp_path)
        # bark 是类成员，应出现
        assert "bark" in ctx
        # standalone 是顶层函数，不应出现在 <members> 中
        assert "standalone" not in ctx

    @pytest.fixture
    def conn(self) -> sqlite3.Connection:
        return _make_conn()


class TestBuildContextVariable:
    def test_variable_contains_source_line(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("MAX_RETRIES = 3\n")
        sid = _insert_symbol(
            conn, name="MAX_RETRIES", kind="variable", file_path="src/a.py", line=1, end_line=1
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "MAX_RETRIES" in ctx
        assert "3" in ctx

    @pytest.fixture
    def conn(self) -> sqlite3.Connection:
        return _make_conn()


# ---------------------------------------------------------------------------
# 循环 4：边界条件
# ---------------------------------------------------------------------------


class TestBuildContextEdgeCases:
    def test_nonexistent_symbol_returns_empty(
        self, conn: sqlite3.Connection, tmp_path: Path
    ) -> None:
        result = build_context(conn, 99999, repo_root=tmp_path)
        assert result == ""

    def test_file_read_failure_returns_placeholder(
        self, conn: sqlite3.Connection, tmp_path: Path
    ) -> None:
        """符号记录存在但文件已删除 → 占位提示，不崩溃。"""
        sid = _insert_symbol(
            conn, name="missing_func", kind="function", file_path="src/gone.py", line=1, end_line=5
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert ctx != ""  # 有占位内容
        assert "missing_func" in ctx  # 至少包含符号名

    def test_no_callers_still_works(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        py = tmp_path / "src" / "a.py"
        py.parent.mkdir()
        py.write_text("def orphan(): pass\n")
        sid = _insert_symbol(
            conn, name="orphan", kind="function", file_path="src/a.py", line=1, end_line=1
        )
        ctx = build_context(conn, sid, repo_root=tmp_path)
        assert "orphan" in ctx

    @pytest.fixture
    def conn(self) -> sqlite3.Connection:
        return _make_conn()
